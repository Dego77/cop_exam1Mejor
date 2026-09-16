import JSZip from 'jszip';

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

    // Mapeo inicial de entidades
    const entities = validNodes.map((node) => {
      const className = this.sanitizeJavaName(node.name);
      const tableName = this.toTableName(className);

      // Verificar si es una Clase de Asociación
      const isAssocClass =
        node.stereotype === 'AssociationClass' ||
        connectors.some(
          (c) =>
            c.associationClassNodeId === node.id ||
            (c.type === 'AssociationClass' &&
              (`${nodeMap.get(c.sourceNodeId)?.name}_${nodeMap.get(c.targetNodeId)?.name}`.toLowerCase() === node.name.toLowerCase() ||
                `${nodeMap.get(c.targetNodeId)?.name}_${nodeMap.get(c.sourceNodeId)?.name}`.toLowerCase() === node.name.toLowerCase()))
        );

      let attributes: any[] = [];

      if (isAssocClass) {
        // Buscar el conector que enlaza a esta Clase de Asociación
        const assocConn = connectors.find(
          (c) =>
            c.associationClassNodeId === node.id ||
            c.type === 'AssociationClass' ||
            (nodeMap.get(c.sourceNodeId) && nodeMap.get(c.targetNodeId) &&
              (`${nodeMap.get(c.sourceNodeId)?.name}_${nodeMap.get(c.targetNodeId)?.name}`.toLowerCase() === node.name.toLowerCase() ||
                `${nodeMap.get(c.targetNodeId)?.name}_${nodeMap.get(c.sourceNodeId)?.name}`.toLowerCase() === node.name.toLowerCase()))
        );

        if (assocConn) {
          const sourceNode = nodeMap.get(assocConn.sourceNodeId);
          const targetNode = nodeMap.get(assocConn.targetNodeId);

          if (sourceNode && targetNode) {
            const sourcePk = this.getNodePrimaryKey(sourceNode);
            const targetPk = this.getNodePrimaryKey(targetNode);

            // Agregar la PK del origen como PK y FK
            attributes.push({
              name: sourcePk.name,
              type: sourcePk.type,
              isPrimaryKey: true,
              isForeignKey: true,
              foreignKeyEntity: this.sanitizeJavaName(sourceNode.name),
            });

            // Agregar la PK del destino como PK y FK
            attributes.push({
              name: targetPk.name,
              type: targetPk.type,
              isPrimaryKey: true,
              isForeignKey: true,
              foreignKeyEntity: this.sanitizeJavaName(targetNode.name),
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

        // Si no tiene clave primaria explícita, agregar 'id' por defecto
        if (!attributes.some((a) => a.isPrimaryKey)) {
          attributes.unshift({
            name: `id_${this.sanitizeFieldName(node.name)}`,
            type: 'Long',
            isPrimaryKey: true,
          });
        }
      }

      // Procesar Relaciones para esta Entidad
      const relationships: any[] = [];
      connectors.forEach((conn) => {
        const sourceNode = nodeMap.get(conn.sourceNodeId);
        const targetNode = nodeMap.get(conn.targetNodeId);

        if (sourceNode && targetNode) {
          const sourceClass = this.sanitizeJavaName(sourceNode.name);
          const targetClass = this.sanitizeJavaName(targetNode.name);

          if (isAssocClass) {
            if (sourceNode.id === node.id || targetNode.id === node.id || className === `${sourceClass}_${targetClass}`) {
              // Relación de la Clase de Asociación con sus padres
              relationships.push({
                type: 'MANY_TO_ONE',
                targetEntity: sourceClass,
                foreignKey: this.getNodePrimaryKey(sourceNode).name,
              });
              relationships.push({
                type: 'MANY_TO_ONE',
                targetEntity: targetClass,
                foreignKey: this.getNodePrimaryKey(targetNode).name,
              });
            }
          } else {
            if (conn.sourceNodeId === node.id) {
              const relType = conn.type === 'Inheritance' ? 'INHERITANCE' : 'MANY_TO_ONE';
              relationships.push({
                type: relType,
                targetEntity: targetClass,
                foreignKey: `${this.sanitizeFieldName(targetClass)}_id`,
              });
            } else if (conn.targetNodeId === node.id) {
              relationships.push({
                type: 'ONE_TO_MANY',
                targetEntity: sourceClass,
                mappedBy: this.sanitizeFieldName(className),
              });
            }
          }
        }
      });

      return {
        className,
        tableName,
        stereotype: node.stereotype || (isAssocClass ? 'AssociationClass' : 'Class'),
        isAssociationClass: isAssocClass,
        attributes,
        relationships,
      };
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
    const rootFolder = zip.folder(cleanProjectName.toLowerCase())!;

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

    // For each entity, generate Model, Repo, Service, Controller
    entities.forEach((ent: any) => {
      modelFolder.file(`${ent.className}.java`, this.generateEntityJava(ent));
      repoFolder.file(`${ent.className}Repository.java`, this.generateRepositoryJava(ent));
      serviceFolder.file(`${ent.className}Service.java`, this.generateServiceJava(ent));
      controllerFolder.file(`${ent.className}Controller.java`, this.generateControllerJava(ent));
    });

    // 4. Controlador de Asistente IA para Flutter / Postman
    const aiFolder = javaFolder.folder('ai')!;
    aiFolder.file('AiAssistantController.java', this.generateAiAssistantController(entities));

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

    entities.forEach((ent) => {
      sql += `CREATE TABLE IF NOT EXISTS ${ent.tableName} (\n`;
      const cols: string[] = [];
      const pkNames: string[] = [];

      ent.attributes.forEach((attr: any) => {
        let pgType = 'VARCHAR(255)';
        if (attr.type === 'Integer') pgType = 'INTEGER';
        if (attr.type === 'Long') pgType = 'BIGINT';
        if (attr.type === 'Double') pgType = 'DOUBLE PRECISION';
        if (attr.type === 'Boolean') pgType = 'BOOLEAN';
        if (attr.type.includes('LocalDateTime')) pgType = 'TIMESTAMP';

        if (attr.isPrimaryKey) {
          pkNames.push(attr.name);
        }
        cols.push(`  ${attr.name} ${pgType}`);
      });

      if (pkNames.length > 0) {
        cols.push(`  PRIMARY KEY (${pkNames.join(', ')})`);
      }

      sql += cols.join(',\n') + '\n);\n\n';
    });

    return sql;
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
    let code = `package com.examen.backend.model;

import jakarta.persistence.*;
import lombok.*;
import java.util.*;

@Entity
@Table(name = "${ent.tableName}")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ${className} {

`;

    const pkAttrs = ent.attributes.filter((a: any) => a.isPrimaryKey);

    ent.attributes.forEach((attr: any) => {
      if (attr.isPrimaryKey) {
        if (pkAttrs.length === 1 && attr.type === 'Long') {
          code += `    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n`;
        } else {
          code += `    @Id\n`;
        }
      }
      code += `    private ${attr.type} ${attr.name};\n\n`;
    });

    code += `}\n`;
    return code;
  }

  private static generateRepositoryJava(ent: any): string {
    const className = ent.className;
    const pkAttr = ent.attributes.find((a: any) => a.isPrimaryKey);
    const pkType = pkAttr ? pkAttr.type : 'Long';

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
    const pkAttr = ent.attributes.find((a: any) => a.isPrimaryKey);
    const pkType = pkAttr ? pkAttr.type : 'Long';

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
    const pkAttr = ent.attributes.find((a: any) => a.isPrimaryKey);
    const pkType = pkAttr ? pkAttr.type : 'Long';

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
