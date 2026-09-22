import JSZip from 'jszip';
import { FlutterGeneratorService } from './flutter.service';

export interface UMLAttribute {
  id?: string;
  name: string;
  type: string;
  visibility?: string;
  isPrimaryKey?: boolean;
}

export interface UMLMethod {
  id?: string;
  name: string;
  returnType?: string;
  visibility?: string;
  params?: any[];
}

export interface UMLNode {
  id: string;
  name: string;
  stereotype?: string;
  attributes: UMLAttribute[];
  methods?: UMLMethod[];
}

export interface UMLConnector {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  label?: string;
  associationClassNodeId?: string;
}

export class SpringBootGeneratorService {

  private static sanitizeJavaName(str: string): string {
    if (!str) return 'EntityName';
    const cleaned = str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '');
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private static sanitizeFieldName(str: string): string {
    if (!str) return 'atributo';
    const cleaned = str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '');
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  }

  private static toTableName(name: string): string {
    const snake = name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .trim();
    return snake.endsWith('s') ? snake : `${snake}s`;
  }

  private static toSnakeSingular(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }

  private static pluralizeField(name: string): string {
    return name.endsWith('s') ? name : `${name}s`;
  }

  /**
   * Determina cuál de los dos extremos de un conector 1-a-muchos es el lado "muchos" (el que
   * debe llevar la FK / @ManyToOne), en vez de asumir que siempre es el nodo "source" del
   * conector (que solo refleja desde qué clase se arrastró la línea en el canvas, no la
   * cardinalidad real). Prioriza la multiplicidad escrita en el diagrama; si no hay ninguna y
   * el conector es Composición/Agregación, usa la convención del rombo: el rombo SIEMPRE se
   * dibuja en el extremo "target" (ver getDiamondPoints/getTargetEndpoint en
   * canvas.component.ts), así que ese lado es el "1" y la cola (source) es el lado "muchos".
   * Devuelve null cuando no se puede determinar (Asociación simple sin multiplicidad
   * declarada), y el llamador cae al comportamiento previo (source = muchos) como último recurso.
   */
  private static determineManySideNodeId(conn: UMLConnector): string | null {
    const srcMult = (conn.sourceMultiplicity || '').replace(/\+/g, '').trim();
    const tgtMult = (conn.targetMultiplicity || '').replace(/\+/g, '').trim();
    const srcHasMany = srcMult.includes('*');
    const tgtHasMany = tgtMult.includes('*');

    if (srcHasMany && !tgtHasMany) return conn.sourceNodeId;
    if (tgtHasMany && !srcHasMany) return conn.targetNodeId;

    if (srcMult === '' && tgtMult === '' && (conn.type === 'Composition' || conn.type === 'Aggregation')) {
      return conn.sourceNodeId;
    }

    return null;
  }

  /**
   * Para relaciones 1-a-1, determina qué extremo debe llevar la FK: el lado marcado como
   * opcional ("0..1") referencia al lado obligatorio ("1"), que es la convención estándar en
   * JPA/Hibernate. Devuelve null si es ambiguo (ambos extremos iguales, p. ej. "1"/"1"), y el
   * llamador cae al comportamiento previo (source = dueño) como último recurso.
   */
  private static determineOneToOneOwningNodeId(conn: UMLConnector): string | null {
    const srcMult = (conn.sourceMultiplicity || '').replace(/\+/g, '').trim();
    const tgtMult = (conn.targetMultiplicity || '').replace(/\+/g, '').trim();
    const srcOptional = srcMult.startsWith('0');
    const tgtOptional = tgtMult.startsWith('0');

    if (srcOptional && !tgtOptional) return conn.sourceNodeId;
    if (tgtOptional && !srcOptional) return conn.targetNodeId;
    return null;
  }

  private static mapToJavaType(typeStr: string): string {
    const t = (typeStr || 'String').toLowerCase().trim();
    if (t === 'int' || t === 'integer') return 'Integer';
    if (t === 'long' || t === 'id') return 'Long';
    if (t === 'double' || t === 'float' || t === 'decimal' || t === 'number') return 'Double';
    if (t === 'boolean' || t === 'bool') return 'Boolean';
    if (t === 'char' || t === 'character') return 'String';
    if (t === 'date' || t === 'datetime' || t === 'timestamp') return 'java.time.LocalDateTime';
    return 'String';
  }

  private static javaTypeToPg(javaType: string): string {
    if (javaType === 'Integer') return 'INTEGER';
    if (javaType === 'Long') return 'BIGINT';
    if (javaType === 'Double') return 'DOUBLE PRECISION';
    if (javaType === 'Boolean') return 'BOOLEAN';
    if (javaType.includes('LocalDateTime')) return 'TIMESTAMP';
    return 'VARCHAR(255)';
  }

  /**
   * Obtiene los datos de la clave primaria (PK) principal de un nodo UML.
   */
  private static getNodePrimaryKey(node: UMLNode): { name: string; type: string } {
    const attrs = node.attributes || [];
    // 1. Atributo explícitamente marcado como PK
    const pkAttr = attrs.find((a) => a.isPrimaryKey);
    if (pkAttr) {
      return {
        name: this.sanitizeFieldName(pkAttr.name),
        type: this.mapToJavaType(pkAttr.type),
      };
    }
    // 2. Atributo cuyo nombre contenga 'id' o 'pk'
    const idAttr = attrs.find((a) => a.name.toLowerCase().startsWith('id') || a.name.toLowerCase().endsWith('id'));
    if (idAttr) {
      return {
        name: this.sanitizeFieldName(idAttr.name),
        type: this.mapToJavaType(idAttr.type),
      };
    }
    // 3. Primer atributo del nodo si existe
    if (attrs.length > 0) {
      return {
        name: this.sanitizeFieldName(attrs[0].name),
        type: this.mapToJavaType(attrs[0].type),
      };
    }
    // 4. Default fallback
    return {
      name: `id_${this.sanitizeFieldName(node.name)}`,
      type: 'Long',
    };
  }

  /**
   * Genera el JSON Canónico estandarizado del diagrama de clases.
   */
  public static generateCanonicalJson(
    nodes: UMLNode[],
    connectors: UMLConnector[],
    projectName: string = 'BackendGenerado'
  ): object {
    const nodeMap = new Map<string, UMLNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    const validNodes = nodes.filter((n) => n.stereotype !== 'Package');

    // Herencia (Inheritance) e implementación de interfaces (Implementation) son relaciones
    // estructurales (extends/implements en Java), no campos JPA, así que se resuelven aparte.
    const childToParentId = new Map<string, string>();
    const parentIdsWithChildren = new Set<string>();
    const implementsByNodeId = new Map<string, string[]>();
    connectors.forEach((c) => {
      if (c.type === 'Inheritance') {
        childToParentId.set(c.sourceNodeId, c.targetNodeId);
        parentIdsWithChildren.add(c.targetNodeId);
      } else if (c.type === 'Implementation') {
        const iface = nodeMap.get(c.targetNodeId);
        if (iface) {
          const arr = implementsByNodeId.get(c.sourceNodeId) || [];
          arr.push(this.sanitizeJavaName(iface.name));
          implementsByNodeId.set(c.sourceNodeId, arr);
        }
      }
    });

    // Detectar, de una sola vez, qué nodos son Clases de Asociación y a qué conector (el que
    // une a las dos entidades "reales") está enlazada cada una. Se reutiliza tanto para
    // construir sus atributos/relaciones como para evitar generar ADEMÁS una relación
    // Many-to-Many/One-to-Many directa entre esas dos entidades por el mismo conector
    // (antes ambos mecanismos convivían sin reconciliarse).
    const findAssocConnector = (assocNode: UMLNode) =>
      connectors.find(
        (c) =>
          c.associationClassNodeId === assocNode.id ||
          c.type === 'AssociationClass' ||
          (nodeMap.get(c.sourceNodeId) && nodeMap.get(c.targetNodeId) &&
            (`${nodeMap.get(c.sourceNodeId)?.name}_${nodeMap.get(c.targetNodeId)?.name}`.toLowerCase() === assocNode.name.toLowerCase() ||
              `${nodeMap.get(c.targetNodeId)?.name}_${nodeMap.get(c.sourceNodeId)?.name}`.toLowerCase() === assocNode.name.toLowerCase()))
      );

    const assocConnByNodeId = new Map<string, UMLConnector>();
    const connectorIdsConsumedByAssocClass = new Set<string>();
    validNodes.forEach((n) => {
      const isAssoc =
        n.stereotype === 'AssociationClass' ||
        connectors.some(
          (c) =>
            c.associationClassNodeId === n.id ||
            (c.type === 'AssociationClass' &&
              (`${nodeMap.get(c.sourceNodeId)?.name}_${nodeMap.get(c.targetNodeId)?.name}`.toLowerCase() === n.name.toLowerCase() ||
                `${nodeMap.get(c.targetNodeId)?.name}_${nodeMap.get(c.sourceNodeId)?.name}`.toLowerCase() === n.name.toLowerCase()))
        );
      if (!isAssoc) return;
      const assocConn = findAssocConnector(n);
      if (assocConn) {
        assocConnByNodeId.set(n.id, assocConn);
        connectorIdsConsumedByAssocClass.add(assocConn.id);
      }
    });

    // Mapeo inicial de entidades
    const entities = validNodes.map((node) => {
      const className = this.sanitizeJavaName(node.name);
      const tableName = this.toTableName(className);

      const isAssocClass = assocConnByNodeId.has(node.id) || node.stereotype === 'AssociationClass';

      const parentNodeId = childToParentId.get(node.id) || null;
      const isInheritanceChild = !!parentNodeId;
      const isInterfaceStereotype = node.stereotype === 'Interface';

      let attributes: any[] = [];
      const assocRelationships: any[] = [];

      if (isAssocClass) {
        const assocConn = assocConnByNodeId.get(node.id);

        if (assocConn) {
          const sourceNode = nodeMap.get(assocConn.sourceNodeId);
          const targetNode = nodeMap.get(assocConn.targetNodeId);

          if (sourceNode && targetNode) {
            const sourcePk = this.getNodePrimaryKey(sourceNode);
            const targetPk = this.getNodePrimaryKey(targetNode);
            const sourceEntityClass = this.sanitizeJavaName(sourceNode.name);
            const targetEntityClass = this.sanitizeJavaName(targetNode.name);

            // Agregar la PK del origen como PK y FK
            attributes.push({
              name: sourcePk.name,
              type: sourcePk.type,
              isPrimaryKey: true,
              isForeignKey: true,
              foreignKeyEntity: sourceEntityClass,
            });

            // Agregar la PK del destino como PK y FK
            attributes.push({
              name: targetPk.name,
              type: targetPk.type,
              isPrimaryKey: true,
              isForeignKey: true,
              foreignKeyEntity: targetEntityClass,
            });

            // Referencias @ManyToOne + @MapsId hacia cada entidad relacionada, usando el mismo
            // nombre de campo que su respectiva PK dentro de la clave compuesta (@EmbeddedId),
            // para que generateEntityJava pueda generar un @EmbeddedId real en vez de dos @Id sueltos.
            assocRelationships.push({
              type: 'MANY_TO_ONE',
              mapsId: true,
              targetEntity: sourceEntityClass,
              fieldName: this.sanitizeFieldName(sourceEntityClass),
              idField: sourcePk.name,
              joinColumn: sourcePk.name,
            });
            assocRelationships.push({
              type: 'MANY_TO_ONE',
              mapsId: true,
              targetEntity: targetEntityClass,
              fieldName: this.sanitizeFieldName(targetEntityClass),
              idField: targetPk.name,
              joinColumn: targetPk.name,
            });
          }
        }

        // Agregar los atributos propios definidos por el usuario en la Clase de Asociación
        (node.attributes || []).forEach((attr) => {
          const sanitizedAttr = this.sanitizeFieldName(attr.name);
          if (!attributes.some((a) => a.name === sanitizedAttr)) {
            attributes.push({
              name: sanitizedAttr,
              type: this.mapToJavaType(attr.type),
              isPrimaryKey: false,
            });
          }
        });

      } else {
        // Entidad normal
        attributes = (node.attributes || []).map((attr) => {
          const isPk = attr.isPrimaryKey || attr.name.toLowerCase().startsWith('id_') || attr.name.toLowerCase() === 'id';
          return {
            name: this.sanitizeFieldName(attr.name),
            type: this.mapToJavaType(attr.type),
            isPrimaryKey: isPk,
          };
        });

        // Si no tiene clave primaria explícita, agregar 'id' por defecto.
        // Excepción: las clases hijas de herencia NO reciben su propio id (heredan la PK del
        // padre en la estrategia SINGLE_TABLE), y las interfaces no se persisten.
        if (!attributes.some((a) => a.isPrimaryKey) && !isInheritanceChild && !isInterfaceStereotype) {
          attributes.unshift({
            name: `id_${this.sanitizeFieldName(node.name)}`,
            type: 'Long',
            isPrimaryKey: true,
          });
        }
      }

      // Procesar Relaciones JPA reales (Many-to-One / One-to-Many / Many-to-Many / One-to-One)
      // para esta Entidad. Inheritance e Implementation NO generan campos aquí: se resuelven
      // como extends/implements usando childToParentId/implementsByNodeId (calculados arriba).
      const relationships: any[] = [...assocRelationships];
      connectors.forEach((conn) => {
        // Estas ya se manejan aparte; y Dependency es solo una referencia de uso, no persistencia.
        if (conn.type === 'Inheritance' || conn.type === 'Implementation' || conn.type === 'Dependency') return;

        // Este conector ya quedó modelado por una Clase de Asociación (arriba, vía @MapsId):
        // no generar además un Many-to-Many/One-to-Many directo para el mismo par de clases.
        if (connectorIdsConsumedByAssocClass.has(conn.id)) return;

        const sourceNode = nodeMap.get(conn.sourceNodeId);
        const targetNode = nodeMap.get(conn.targetNodeId);
        if (!sourceNode || !targetNode) return;

        const sourceClass = this.sanitizeJavaName(sourceNode.name);
        const targetClass = this.sanitizeJavaName(targetNode.name);

        if (isAssocClass) {
          // La Clase de Asociación ya recibió sus dos FKs compuestas + @ManyToOne/@MapsId
          // (arriba, vía assocRelationships); un conector "suelto" que además la toque (p. ej.
          // la línea punteada de enlace en el diagrama) no debe generar una relación adicional.
          return;
        }

        const srcMult = conn.sourceMultiplicity || '';
        const tgtMult = conn.targetMultiplicity || '';
        const isManyToMany = srcMult.includes('*') && tgtMult.includes('*');

        // Lado "muchos" real (ver determineManySideNodeId): null si no se pudo determinar,
        // en cuyo caso se cae al comportamiento previo (source = muchos) como último recurso.
        const manySideNodeId = isManyToMany ? null : this.determineManySideNodeId(conn);
        const effectiveManySideNodeId = manySideNodeId || conn.sourceNodeId;

        // Relación 1 a 1: no es Many-to-Many y no se pudo determinar un lado "muchos" (ni por
        // multiplicidad explícita ni por convención de rombo), pero ambos extremos SÍ declaran
        // cardinalidad explícita (p. ej. "+1"/"+1" o "1"/"0..1").
        const isOneToOne =
          !isManyToMany && !manySideNodeId && srcMult.trim() !== '' && tgtMult.trim() !== '';
        const oneToOneOwningNodeId = isOneToOne
          ? (this.determineOneToOneOwningNodeId(conn) || conn.sourceNodeId)
          : null;

        const cascade =
          conn.type === 'Composition'
            ? 'CascadeType.ALL, orphanRemoval = true'
            : conn.type === 'Aggregation'
              ? '{CascadeType.PERSIST, CascadeType.MERGE}'
              : null;
        // Composición implica que la parte no puede existir sin el todo ("1..*"): la FK del
        // lado "muchos" queda obligatoria. Agregación/Asociación simple la dejan opcional.
        const nullableFk = conn.type !== 'Composition';

        const isThisSource = conn.sourceNodeId === node.id;
        const isThisTarget = conn.targetNodeId === node.id;
        if (!isThisSource && !isThisTarget) return;
        const otherClass = isThisSource ? targetClass : sourceClass;

        if (isManyToMany) {
          if (isThisSource) {
            relationships.push({
              type: 'MANY_TO_MANY',
              owning: true,
              targetEntity: otherClass,
              fieldName: this.pluralizeField(this.sanitizeFieldName(otherClass)),
              joinTable: `${tableName}_${this.toTableName(otherClass)}`,
              joinColumn: `${this.toSnakeSingular(className)}_id`,
              inverseJoinColumn: `${this.toSnakeSingular(otherClass)}_id`,
            });
          } else {
            relationships.push({
              type: 'MANY_TO_MANY',
              owning: false,
              targetEntity: otherClass,
              fieldName: this.pluralizeField(this.sanitizeFieldName(otherClass)),
              mappedBy: this.pluralizeField(this.sanitizeFieldName(className)),
            });
          }
        } else if (isOneToOne) {
          if (node.id === oneToOneOwningNodeId) {
            relationships.push({
              type: 'ONE_TO_ONE',
              owning: true,
              targetEntity: otherClass,
              fieldName: this.sanitizeFieldName(otherClass),
              joinColumn: `${this.toSnakeSingular(otherClass)}_id`,
            });
          } else {
            relationships.push({
              type: 'ONE_TO_ONE',
              owning: false,
              targetEntity: otherClass,
              fieldName: this.sanitizeFieldName(otherClass),
              mappedBy: this.sanitizeFieldName(className),
            });
          }
        } else if (node.id === effectiveManySideNodeId) {
          relationships.push({
            type: 'MANY_TO_ONE',
            targetEntity: otherClass,
            fieldName: this.sanitizeFieldName(otherClass),
            joinColumn: `${this.toSnakeSingular(otherClass)}_id`,
            nullable: nullableFk,
          });
        } else {
          relationships.push({
            type: 'ONE_TO_MANY',
            targetEntity: otherClass,
            fieldName: this.pluralizeField(this.sanitizeFieldName(otherClass)),
            mappedBy: this.sanitizeFieldName(className),
            cascade,
          });
        }
      });

      const parentClass = parentNodeId ? this.sanitizeJavaName(nodeMap.get(parentNodeId)?.name || '') : null;

      return {
        className,
        tableName,
        stereotype: node.stereotype || (isAssocClass ? 'AssociationClass' : 'Class'),
        isAssociationClass: isAssocClass,
        // Las Clases de Asociación tienen PK compuesta -> se modelan con @EmbeddedId usando
        // esta clase auxiliar (ver generateAssocClassIdJava), en vez de dos @Id sueltos.
        idClassName: isAssocClass ? `${className}Id` : null,
        isInterfaceStereotype,
        parentClass,
        isInheritanceChild,
        isInheritanceRoot: parentIdsWithChildren.has(node.id) && !parentNodeId,
        implementsInterfaces: implementsByNodeId.get(node.id) || [],
        attributes,
        relationships,
      };
    });

    // PK "efectiva" de cada entidad: la propia si la tiene, o si no (hija de herencia
    // SINGLE_TABLE) la de su ancestro raíz. Repository/Service/Controller la usan para
    // tipar @PathVariable e invocar el setter correcto, ya que las hijas no declaran @Id propio.
    const entityByClassName = new Map(entities.map((e: any) => [e.className, e]));
    entities.forEach((e: any) => {
      if (e.isAssociationClass) {
        // La PK real es la clase @EmbeddedId compuesta, no un único atributo escalar.
        e.effectivePk = { name: 'id', type: e.idClassName };
        return;
      }
      let ancestor = e;
      while (ancestor.isInheritanceChild && ancestor.parentClass && entityByClassName.has(ancestor.parentClass)) {
        ancestor = entityByClassName.get(ancestor.parentClass);
      }
      const pk = (ancestor.attributes || []).find((a: any) => a.isPrimaryKey);
      e.effectivePk = pk ? { name: pk.name, type: pk.type } : { name: 'id', type: 'Long' };
    });

    return {
      projectName: this.sanitizeJavaName(projectName),
      database: 'PostgreSQL',
      generatedAt: new Date().toISOString(),
      entities,
    };
  }

  /**
   * Genera un buffer de archivo ZIP con todo el proyecto Spring Boot compilable y listo.
   */
  public static async generateSpringBootZip(
    nodes: UMLNode[],
    connectors: UMLConnector[],
    projectName: string = 'ExamenBackend'
  ): Promise<Buffer> {
    const zip = new JSZip();
    const cleanProjectName = this.sanitizeJavaName(projectName);
    // Un único folder de proyecto en el zip, con `backend/` (Spring Boot) y `flutter_app/`
    // (app Flutter con CRUD + agente de IA local) como carpetas hermanas.
    const projectRoot = zip.folder(cleanProjectName.toLowerCase())!;
    const rootFolder = projectRoot.folder('backend')!;

    const canonicalJson = this.generateCanonicalJson(nodes, connectors, cleanProjectName) as any;
    const entities = canonicalJson.entities as any[];

    // 1. pom.xml
    rootFolder.file('pom.xml', this.generatePomXml(cleanProjectName));

    // 2. application.properties & schema.sql
    const resFolder = rootFolder.folder('src/main/resources')!;
    resFolder.file('application.properties', this.generateApplicationProperties(cleanProjectName));
    resFolder.file('schema.sql', this.generateSchemaSql(entities));

    // 3. Java Source Files
    const javaFolder = rootFolder.folder('src/main/java/com/examen/backend')!;

    // Application.java
    javaFolder.file('Application.java', this.generateApplicationJava());

    const modelFolder = javaFolder.folder('model')!;
    const repoFolder = javaFolder.folder('repository')!;
    const serviceFolder = javaFolder.folder('service')!;
    const controllerFolder = javaFolder.folder('controller')!;

    // For each entity, generate Model, Repo, Service, Controller.
    // Las entidades con stereotype 'Interface' solo generan el archivo de modelo (interface Java);
    // no se persisten, así que no tienen Repository/Service/Controller CRUD.
    entities.forEach((ent: any) => {
      modelFolder.file(`${ent.className}.java`, this.generateEntityJava(ent));
      if (ent.isAssociationClass) {
        modelFolder.file(`${ent.idClassName}.java`, this.generateAssocClassIdJava(ent));
      }
      if (ent.isInterfaceStereotype) return;
      repoFolder.file(`${ent.className}Repository.java`, this.generateRepositoryJava(ent));
      serviceFolder.file(`${ent.className}Service.java`, this.generateServiceJava(ent));
      controllerFolder.file(`${ent.className}Controller.java`, this.generateControllerJava(ent));
    });

    // 4. Controlador de Asistente IA para Flutter / Postman
    const aiFolder = javaFolder.folder('ai')!;
    aiFolder.file('AiAssistantController.java', this.generateAiAssistantController(entities));

    // 5. App Flutter (CRUD contra este mismo backend + agente de chat/voz con IA local)
    FlutterGeneratorService.addFlutterAppToZip(projectRoot, 'flutter_app', entities, cleanProjectName);

    // Generar el Buffer del ZIP
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private static generatePomXml(projectName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.3</version>
        <relativePath/>
    </parent>
    <groupId>com.examen</groupId>
    <artifactId>${projectName.toLowerCase()}</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <name>${projectName}</name>
    <description>Backend Spring Boot + PostgreSQL generado automaticamente desde ClassForge</description>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
  }

  private static generateApplicationProperties(projectName: string): string {
    return `# Spring Boot Properties - PostgreSQL Configuration
spring.application.name=${projectName}

# Configuración de Base de Datos PostgreSQL
spring.datasource.url=\${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/${projectName.toLowerCase()}_db}
spring.datasource.username=\${SPRING_DATASOURCE_USERNAME:postgres}
spring.datasource.password=\${SPRING_DATASOURCE_PASSWORD:postgres}
spring.datasource.driver-class-name=org.postgresql.Driver

# JPA / Hibernate Settings
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true
spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect

# CORS Configuration
server.port=8080
`;
  }

  private static generateSchemaSql(entities: any[]): string {
    let sql = `-- Script DDL PostgreSQL para ${entities.length} entidades\n\n`;
    const joinTablesSql: string[] = [];

    // Tipo de PK real de cada entidad, para tipar correctamente las columnas FK.
    const pkTypeByClassName = new Map<string, string>();
    entities.forEach((e) => {
      const pk = (e.attributes || []).find((a: any) => a.isPrimaryKey);
      pkTypeByClassName.set(e.className, pk ? pk.type : 'Long');
    });

    // Añade las columnas/atributos y FKs de `ent` a `cols`/`fkConstraints`, usando `physicalTableName`
    // como tabla dueña de las FKs (la raíz, cuando `ent` es una hija de herencia SINGLE_TABLE).
    const appendEntityColumns = (ent: any, physicalTableName: string, cols: string[], pkNames: string[], fkConstraints: string[]) => {
      ent.attributes.forEach((attr: any) => {
        if (attr.isPrimaryKey) pkNames.push(attr.name);
        cols.push(`  ${attr.name} ${this.javaTypeToPg(attr.type)}`);
      });

      if (ent.isAssociationClass) {
        // Las columnas PK/FK compuestas ya se agregaron arriba (son atributos planos); solo
        // falta declarar sus FOREIGN KEY hacia cada entidad relacionada.
        (ent.attributes || []).forEach((attr: any) => {
          if (attr.isForeignKey && attr.foreignKeyEntity) {
            fkConstraints.push(`  FOREIGN KEY (${attr.name}) REFERENCES ${this.toTableName(attr.foreignKeyEntity)}`);
          }
        });
        return;
      }

      (ent.relationships || []).forEach((rel: any) => {
        if (rel.type === 'MANY_TO_ONE' || (rel.type === 'ONE_TO_ONE' && rel.owning)) {
          const targetTable = this.toTableName(rel.targetEntity);
          const fkType = this.javaTypeToPg(pkTypeByClassName.get(rel.targetEntity) || 'Long');
          const uniqueSql = rel.type === 'ONE_TO_ONE' ? ' UNIQUE' : '';
          cols.push(`  ${rel.joinColumn} ${fkType}${uniqueSql}`);
          fkConstraints.push(`  FOREIGN KEY (${rel.joinColumn}) REFERENCES ${targetTable}`);
        } else if (rel.type === 'MANY_TO_MANY' && rel.owning) {
          const targetTable = this.toTableName(rel.targetEntity);
          const ownFkType = this.javaTypeToPg(pkTypeByClassName.get(ent.className) || 'Long');
          const targetFkType = this.javaTypeToPg(pkTypeByClassName.get(rel.targetEntity) || 'Long');
          joinTablesSql.push(
            `CREATE TABLE IF NOT EXISTS ${rel.joinTable} (\n` +
            `  ${rel.joinColumn} ${ownFkType} NOT NULL,\n` +
            `  ${rel.inverseJoinColumn} ${targetFkType} NOT NULL,\n` +
            `  PRIMARY KEY (${rel.joinColumn}, ${rel.inverseJoinColumn}),\n` +
            `  FOREIGN KEY (${rel.joinColumn}) REFERENCES ${physicalTableName},\n` +
            `  FOREIGN KEY (${rel.inverseJoinColumn}) REFERENCES ${targetTable}\n` +
            `);\n`
          );
        }
      });
    };

    entities.forEach((ent) => {
      // Las interfaces no se persisten, y las hijas de herencia SINGLE_TABLE comparten la
      // tabla física de su raíz (se pliegan ahí más abajo), así que no tienen tabla propia.
      if (ent.isInterfaceStereotype || ent.isInheritanceChild) return;

      const cols: string[] = [];
      const pkNames: string[] = [];
      const fkConstraints: string[] = [];

      appendEntityColumns(ent, ent.tableName, cols, pkNames, fkConstraints);

      if (ent.isInheritanceRoot) {
        cols.push(`  dtype VARCHAR(31)`);
        entities
          .filter((e) => e.parentClass === ent.className)
          .forEach((child) => appendEntityColumns(child, ent.tableName, cols, pkNames, fkConstraints));
      }

      if (pkNames.length > 0) {
        cols.push(`  PRIMARY KEY (${pkNames.join(', ')})`);
      }

      sql += `CREATE TABLE IF NOT EXISTS ${ent.tableName} (\n` + cols.concat(fkConstraints).join(',\n') + '\n);\n\n';
    });

    return sql + joinTablesSql.join('\n');
  }

  private static generateApplicationJava(): string {
    return `package com.examen.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
        System.out.println("🚀 Backend Spring Boot + PostgreSQL iniciado correctamente.");
    }
}
`;
  }

  private static generateEntityJava(ent: any): string {
    const className = ent.className;

    // Un nodo con stereotype 'Interface' es un contrato, no una entidad persistida:
    // se genera como `interface` Java plano (sin @Entity/JPA) en vez de forzar una tabla.
    if (ent.isInterfaceStereotype) {
      let ifaceCode = `package com.examen.backend.model;

public interface ${className} {
`;
      (ent.attributes || []).forEach((attr: any) => {
        const capitalized = attr.name.charAt(0).toUpperCase() + attr.name.slice(1);
        ifaceCode += `    ${attr.type} get${capitalized}();\n`;
      });
      ifaceCode += `}\n`;
      return ifaceCode;
    }

    const extendsClause = ent.parentClass ? ` extends ${ent.parentClass}` : '';
    const implementsClause = ent.implementsInterfaces && ent.implementsInterfaces.length > 0
      ? ` implements ${ent.implementsInterfaces.join(', ')}`
      : '';
    const inheritanceAnnotations = ent.isInheritanceRoot
      ? `@Inheritance(strategy = InheritanceType.SINGLE_TABLE)\n@DiscriminatorColumn(name = "dtype")\n`
      : '';
    const discriminatorAnnotation = (ent.isInheritanceRoot || ent.isInheritanceChild)
      ? `@DiscriminatorValue("${className}")\n`
      : '';

    // En herencia SINGLE_TABLE solo la raíz declara la tabla física; las hijas comparten esa
    // misma tabla implícitamente y no deben repetir @Table.
    const tableAnnotation = ent.isInheritanceChild ? '' : `@Table(name = "${ent.tableName}")\n`;

    let code = `package com.examen.backend.model;

import jakarta.persistence.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import lombok.*;
import java.util.*;

@Entity
${tableAnnotation}${inheritanceAnnotations}${discriminatorAnnotation}@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ${className}${extendsClause}${implementsClause} {

`;

    const pkAttrs = ent.attributes.filter((a: any) => a.isPrimaryKey);

    if (ent.isAssociationClass) {
      // Clave compuesta real vía @EmbeddedId (ver generateAssocClassIdJava), en vez de dos
      // @Id sueltos (inválido en JPA/Hibernate: una entidad no puede tener más de un @Id sin
      // @EmbeddedId/@IdClass). @JsonUnwrapped mantiene el JSON plano (id_usuario, id_ventas
      // al nivel superior, igual que en schema.sql) en vez de anidarlo bajo "id".
      code += `    @EmbeddedId\n    @JsonUnwrapped\n    private ${ent.idClassName} id;\n\n`;
    }

    ent.attributes.forEach((attr: any) => {
      if (ent.isAssociationClass && attr.isPrimaryKey) return; // ya están dentro de `id`
      if (attr.isPrimaryKey) {
        if (pkAttrs.length === 1 && attr.type === 'Long') {
          code += `    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n`;
        } else {
          code += `    @Id\n`;
        }
      }
      code += `    private ${attr.type} ${attr.name};\n\n`;
    });

    // Relaciones JPA reales derivadas de los conectores UML del diagrama.
    (ent.relationships || []).forEach((rel: any) => {
      if (rel.mapsId) {
        // Clase de Asociación: el campo de objeto comparte su parte de la PK compuesta con `id`.
        code += `    @ManyToOne\n    @MapsId("${rel.idField}")\n    @JoinColumn(name = "${rel.joinColumn}")\n    private ${rel.targetEntity} ${rel.fieldName};\n\n`;
      } else if (rel.type === 'MANY_TO_ONE') {
        const nullableAttr = rel.nullable === false ? ', nullable = false' : '';
        code += `    @ManyToOne\n    @JoinColumn(name = "${rel.joinColumn}"${nullableAttr})\n    private ${rel.targetEntity} ${rel.fieldName};\n\n`;
      } else if (rel.type === 'ONE_TO_MANY') {
        const cascadeAttr = rel.cascade ? `, cascade = ${rel.cascade}` : '';
        code += `    @OneToMany(mappedBy = "${rel.mappedBy}"${cascadeAttr})\n    @JsonIgnore\n    @Builder.Default\n    private List<${rel.targetEntity}> ${rel.fieldName} = new ArrayList<>();\n\n`;
      } else if (rel.type === 'ONE_TO_ONE') {
        if (rel.owning) {
          code += `    @OneToOne\n    @JoinColumn(name = "${rel.joinColumn}", unique = true)\n    private ${rel.targetEntity} ${rel.fieldName};\n\n`;
        } else {
          code += `    @OneToOne(mappedBy = "${rel.mappedBy}")\n    @JsonIgnore\n    private ${rel.targetEntity} ${rel.fieldName};\n\n`;
        }
      } else if (rel.type === 'MANY_TO_MANY') {
        if (rel.owning) {
          code += `    @ManyToMany\n    @JoinTable(\n        name = "${rel.joinTable}",\n        joinColumns = @JoinColumn(name = "${rel.joinColumn}"),\n        inverseJoinColumns = @JoinColumn(name = "${rel.inverseJoinColumn}")\n    )\n    @Builder.Default\n    private List<${rel.targetEntity}> ${rel.fieldName} = new ArrayList<>();\n\n`;
        } else {
          code += `    @ManyToMany(mappedBy = "${rel.mappedBy}")\n    @JsonIgnore\n    @Builder.Default\n    private List<${rel.targetEntity}> ${rel.fieldName} = new ArrayList<>();\n\n`;
        }
      }
    });

    code += `}\n`;
    return code;
  }

  /**
   * Genera la clase @Embeddable que representa la clave primaria compuesta de una Clase de
   * Asociación (p. ej. DetalleVentasId con idUsuario + idVentas), usada por su @EmbeddedId.
   */
  private static generateAssocClassIdJava(ent: any): string {
    const pkAttrs = (ent.attributes || []).filter((a: any) => a.isPrimaryKey);

    let code = `package com.examen.backend.model;

import java.io.Serializable;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ${ent.idClassName} implements Serializable {

`;
    pkAttrs.forEach((attr: any) => {
      code += `    private ${attr.type} ${attr.name};\n`;
    });
    code += `}\n`;
    return code;
  }

  private static generateRepositoryJava(ent: any): string {
    const className = ent.className;
    const pkType = ent.effectivePk ? ent.effectivePk.type : 'Long';

    return `package com.examen.backend.repository;

import com.examen.backend.model.${className};
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ${className}Repository extends JpaRepository<${className}, ${pkType}> {
}
`;
  }

  private static generateServiceJava(ent: any): string {
    const className = ent.className;
    const varName = this.sanitizeFieldName(className);
    const repoVar = `${varName}Repository`;
    const pkType = ent.effectivePk ? ent.effectivePk.type : 'Long';

    return `package com.examen.backend.service;

import com.examen.backend.model.${className};
import com.examen.backend.repository.${className}Repository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
public class ${className}Service {

    @Autowired
    private ${className}Repository ${repoVar};

    public List<${className}> findAll() {
        return ${repoVar}.findAll();
    }

    public Optional<${className}> findById(${pkType} id) {
        return ${repoVar}.findById(id);
    }

    public ${className} save(${className} entity) {
        return ${repoVar}.save(entity);
    }

    public void deleteById(${pkType} id) {
        ${repoVar}.deleteById(id);
    }
}
`;
  }

  private static generateControllerJava(ent: any): string {
    const className = ent.className;
    const varName = this.sanitizeFieldName(className);
    const serviceVar = `${varName}Service`;
    const endpoint = ent.tableName;

    if (ent.isAssociationClass) {
      // Clave compuesta (@EmbeddedId): sin un Converter<String, ${ent.idClassName}> registrado,
      // Spring MVC no puede bindear un @PathVariable a ella desde la URL, así que solo se
      // exponen list/create (los que no dependen de bindear la PK compuesta desde un path).
      return `package com.examen.backend.controller;

import com.examen.backend.model.${className};
import com.examen.backend.service.${className}Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/${endpoint}")
@CrossOrigin(origins = "*")
public class ${className}Controller {

    @Autowired
    private ${className}Service ${serviceVar};

    @GetMapping
    public List<${className}> getAll() {
        return ${serviceVar}.findAll();
    }

    @PostMapping
    public ${className} create(@RequestBody ${className} entity) {
        return ${serviceVar}.save(entity);
    }
}
`;
    }

    const pkType = ent.effectivePk ? ent.effectivePk.type : 'Long';
    const pkFieldName = ent.effectivePk ? ent.effectivePk.name : 'id';
    const pkSetter = `set${pkFieldName.charAt(0).toUpperCase()}${pkFieldName.slice(1)}`;

    return `package com.examen.backend.controller;

import com.examen.backend.model.${className};
import com.examen.backend.service.${className}Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/${endpoint}")
@CrossOrigin(origins = "*")
public class ${className}Controller {

    @Autowired
    private ${className}Service ${serviceVar};

    @GetMapping
    public List<${className}> getAll() {
        return ${serviceVar}.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<${className}> getById(@PathVariable ${pkType} id) {
        return ${serviceVar}.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ${className} create(@RequestBody ${className} entity) {
        return ${serviceVar}.save(entity);
    }

    @PutMapping("/{id}")
    public ResponseEntity<${className}> update(@PathVariable ${pkType} id, @RequestBody ${className} entity) {
        if (!${serviceVar}.findById(id).isPresent()) {
            return ResponseEntity.notFound().build();
        }
        entity.${pkSetter}(id);
        return ResponseEntity.ok(${serviceVar}.save(entity));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable ${pkType} id) {
        if (${serviceVar}.findById(id).isPresent()) {
            ${serviceVar}.deleteById(id);
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
`;
  }

  private static generateAiAssistantController(entities: any[]): string {
    const entityListStr = entities.map((e) => e.className).join(', ');

    return `package com.examen.backend.ai;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/ai")
@CrossOrigin(origins = "*")
public class AiAssistantController {

    @GetMapping("/schema-summary")
    public ResponseEntity<Map<String, Object>> getSchemaSummary() {
        Map<String, Object> response = new HashMap<>();
        response.put("system", "Spring Boot Backend con PostgreSQL e IA Local Support");
        response.put("entitiesCount", ${entities.length});
        response.put("availableEntities", List.of(${entities.map(e => `"${e.className}"`).join(', ')}));
        response.put("status", "ACTIVE");
        return ResponseEntity.ok(response);
    }

    @PostMapping("/query")
    public ResponseEntity<Map<String, String>> processAiQuery(@RequestBody Map<String, String> request) {
        String prompt = request.getOrDefault("prompt", "");
        Map<String, String> response = new HashMap<>();
        response.put("prompt", prompt);
        response.put("aiResponse", "Respuesta del Agente de IA Local sobre el esquema (${entityListStr}): " + prompt);
        response.put("mode", "OFFLINE/LOCAL_AI_READY");
        return ResponseEntity.ok(response);
    }
}
`;
  }
}
