export interface UMLAttribute {
  id: string;
  name: string;
  type: string;
  visibility?: string;
  isPrimaryKey?: boolean;
}

export interface UMLMethod {
  id: string;
  name: string;
  returnType: string;
  visibility?: string;
  params?: any[];
}

export interface UMLNode {
  id: string;
  name: string;
  stereotype: string;
  attributes: UMLAttribute[];
  methods: UMLMethod[];
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
}

export interface UMLConnector {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  label?: string;
  associationClassNodeId?: string | null;
}

export interface SQLOptions {
  includeForeignKeys?: boolean;
  addIndexes?: boolean;
  generateMigrations?: boolean;
  includeSeedData?: Boolean;
}

export class PostgreSQLGeneratorService {
  private static mapTypeToPostgres(typeStr: string): string {
    const t = (typeStr || 'String').toLowerCase().trim();
    if (t === 'string' || t === 'varchar' || t === 'text') return 'VARCHAR(255)';
    if (t === 'int' || t === 'integer' || t === 'long') return 'INTEGER';
    if (t === 'double' || t === 'float' || t === 'decimal' || t === 'number') return 'DOUBLE PRECISION';
    if (t === 'boolean' || t === 'bool') return 'BOOLEAN';
    if (t === 'date' || t === 'datetime' || t === 'timestamp') return 'TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP';
    if (t === 'uuid') return 'UUID';
    return 'VARCHAR(255)';
  }

  private static sqlType(typeStr: string): string {
    return this.mapTypeToPostgres(typeStr)
      .replace(/\s+PRIMARY KEY\b/i, '')
      .replace(/\s+DEFAULT\s+.+$/i, '')
      .trim();
  }

  private static isIdentifierName(name: string): boolean {
    const n = (name || '').toLowerCase();
    return n === 'id' || n.startsWith('id_') || n.endsWith('_id');
  }

  private static toTableName(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .trim() + 's';
  }

  private static toColumnName(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .trim();
  }

  private static primaryKeyOf(node: UMLNode): { name: string; sqlType: string } {
    const attrs = Array.isArray(node.attributes) ? node.attributes : [];
    const pk = attrs.find((attr) => attr?.isPrimaryKey) || attrs.find((attr) => this.isIdentifierName(attr?.name));
    if (pk?.name) return { name: this.toColumnName(pk.name), sqlType: this.sqlType(pk.type) };
    return { name: `${this.toColumnName(node.name)}_id`, sqlType: 'VARCHAR(255)' };
  }

  private static foreignKeyColumn(parent: UMLNode, pkName: string): string {
    return pkName === 'id' ? `${this.toColumnName(parent.name)}_id` : pkName;
  }

  /** El lado "muchos" es quien guarda la clave foránea. Sin multiplicidad, queda el origen. */
  private static manySide(conn: UMLConnector): 'source' | 'target' {
    const srcMany = (conn.sourceMultiplicity || '').includes('*');
    const tgtMany = (conn.targetMultiplicity || '').includes('*');
    if (srcMany && !tgtMany) return 'source';
    if (tgtMany && !srcMany) return 'target';
    if (!conn.sourceMultiplicity && !conn.targetMultiplicity && (conn.type === 'Composition' || conn.type === 'Aggregation')) {
      return 'source';
    }
    return 'source';
  }

  private static linkAssociationClasses(nodes: UMLNode[], connectors: UMLConnector[]): Map<string, UMLConnector> {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const linked = new Map<string, UMLConnector>();

    connectors.forEach((conn) => {
      if (conn.associationClassNodeId && nodeMap.has(conn.associationClassNodeId)) {
        linked.set(conn.associationClassNodeId, conn);
      }
    });

    const used = new Set([...linked.values()].map((conn) => conn.id));
    const free = connectors.filter((conn) => conn.type === 'AssociationClass' && !used.has(conn.id));
    nodes
      .filter((node) => node.stereotype === 'AssociationClass' && !linked.has(node.id))
      .forEach((node) => {
        const named = free.find((conn) => {
          const left = nodeMap.get(conn.sourceNodeId)?.name || '';
          const right = nodeMap.get(conn.targetNodeId)?.name || '';
          const className = node.name.toLowerCase();
          return className === `${left}_${right}`.toLowerCase() || className === `${right}_${left}`.toLowerCase();
        });
        const match = named || (free.length === 1 ? free[0] : undefined);
        if (!match) return;
        linked.set(node.id, match);
        free.splice(free.indexOf(match), 1);
      });

    return linked;
  }

  private static createEntityTable(node: UMLNode, extraAttrs: UMLAttribute[] = [], withDtype = false): string {
    const attrs = (Array.isArray(node.attributes) ? node.attributes : []).filter((attr) => attr?.name);
    const pkAttr = attrs.find((attr) => attr.isPrimaryKey) || attrs.find((attr) => this.isIdentifierName(attr.name));
    const columns: string[] = [];
    const used = new Set<string>();
    const push = (column: string) => {
      const name = column.trim().split(/\s+/)[0];
      if (used.has(name)) return;
      used.add(name);
      columns.push(column);
    };
    if (pkAttr) push(this.attributeColumn(pkAttr, true));
    else push(`  ${this.toColumnName(node.name)}_id VARCHAR(255) PRIMARY KEY`);
    attrs.forEach((attr) => {
      if (attr !== pkAttr) push(this.attributeColumn(attr, false));
    });
    extraAttrs.forEach((attr) => push(this.attributeColumn(attr, false)));
    if (withDtype) push(`  dtype VARCHAR(31)`);
    return `CREATE TABLE ${this.toTableName(node.name)} (\n${columns.join(',\n')}\n);\n`;
  }

  private static descendantAttributes(rootId: string, childToParent: Map<string, string>, nodeMap: Map<string, UMLNode>): UMLAttribute[] {
    const extras: UMLAttribute[] = [];
    const visit = (parentId: string) => {
      childToParent.forEach((parent, childId) => {
        if (parent !== parentId) return;
        const child = nodeMap.get(childId);
        (child?.attributes || []).forEach((attr) => {
          if (!attr?.name || attr.isPrimaryKey || this.isIdentifierName(attr.name)) return;
          extras.push(attr);
        });
        visit(childId);
      });
    };
    visit(rootId);
    return extras;
  }

  private static createJoinTable(left: UMLNode, right: UMLNode): string {
    const table = `${this.toTableName(left.name)}_${this.toTableName(right.name)}`;
    const leftPk = this.primaryKeyOf(left);
    const rightPk = this.primaryKeyOf(right);
    const leftColumn = this.foreignKeyColumn(left, leftPk.name);
    const rightColumn = this.foreignKeyColumn(right, rightPk.name);
    return [
      `CREATE TABLE ${table} (`,
      `  ${leftColumn} ${leftPk.sqlType} NOT NULL,`,
      `  ${rightColumn} ${rightPk.sqlType} NOT NULL,`,
      `  PRIMARY KEY (${leftColumn}, ${rightColumn}),`,
      `  FOREIGN KEY (${leftColumn}) REFERENCES ${this.toTableName(left.name)} (${leftPk.name}) ON DELETE CASCADE,`,
      `  FOREIGN KEY (${rightColumn}) REFERENCES ${this.toTableName(right.name)} (${rightPk.name}) ON DELETE CASCADE`,
      `);\n`,
    ].join('\n');
  }

  private static attributeColumn(attr: UMLAttribute, primaryKey: boolean): string {
    const name = this.toColumnName(attr.name);
    const type = this.mapTypeToPostgres(attr.type).replace(/\s+PRIMARY KEY\b/i, '').trim();
    return primaryKey ? `  ${name} ${type} PRIMARY KEY` : `  ${name} ${type}`;
  }

  /** La clase de asociación guarda las dos claves primarias de las entidades que une. */
  private static createAssociationTable(node: UMLNode, conn: UMLConnector, nodeMap: Map<string, UMLNode>): string {
    const left = nodeMap.get(conn.sourceNodeId);
    const right = nodeMap.get(conn.targetNodeId);
    if (!left || !right) return this.createEntityTable(node);

    const table = this.toTableName(node.name);
    const parents = [left, right];
    const used = new Set<string>();
    const keys = parents.map((parent) => {
      const pk = this.primaryKeyOf(parent);
      let column = this.foreignKeyColumn(parent, pk.name);
      if (used.has(column)) column = `${this.toColumnName(parent.name)}_${pk.name}`;
      used.add(column);
      return { parent, column, pk };
    });

    const own = (Array.isArray(node.attributes) ? node.attributes : []).filter((attr) => {
      if (!attr?.name || this.isIdentifierName(attr.name)) return false;
      return !used.has(this.toColumnName(attr.name));
    });

    const columns = [
      ...keys.map((key) => `  ${key.column} ${key.pk.sqlType} NOT NULL`),
      ...own.map((attr) => this.attributeColumn(attr, false)),
      `  PRIMARY KEY (${keys.map((key) => key.column).join(', ')})`,
      ...keys.map((key) =>
        `  CONSTRAINT fk_${table}_${key.column} FOREIGN KEY (${key.column}) REFERENCES ${this.toTableName(key.parent.name)} (${key.pk.name}) ON DELETE CASCADE`
      ),
    ];
    return `CREATE TABLE ${table} (\n${columns.join(',\n')}\n);\n`;
  }

  public static generateDDL(
    nodes: UMLNode[],
    connectors: UMLConnector[],
    options: SQLOptions = { includeForeignKeys: true, addIndexes: true }
  ): string {
    const sqlOutput: string[] = [];
    sqlOutput.push(`-- ========================================================`);
    sqlOutput.push(`-- ClassForge Generated PostgreSQL DDL Schema`);
    sqlOutput.push(`-- Timestamp: ${new Date().toISOString()}`);
    sqlOutput.push(`-- ========================================================\n`);

    const nodeMap = new Map<string, UMLNode>();
    nodes.forEach((node) => nodeMap.set(node.id, node));
    const entityNodes = nodes.filter((node) => node.stereotype !== 'Package' && node.stereotype !== 'Interface');
    const childToParent = new Map<string, string>();
    connectors.forEach((conn) => {
      if (conn.type === 'Inheritance' && nodeMap.has(conn.sourceNodeId) && nodeMap.has(conn.targetNodeId)) {
        childToParent.set(conn.sourceNodeId, conn.targetNodeId);
      }
    });
    const rootOf = (id: string) => {
      const seen = new Set<string>();
      let current = id;
      while (childToParent.has(current) && !seen.has(current)) {
        seen.add(current);
        current = childToParent.get(current)!;
      }
      return nodeMap.get(current);
    };
    const associationOf = this.linkAssociationClasses(entityNodes, connectors);
    const consumed = new Set([...associationOf.values()].map((conn) => conn.id));

    entityNodes.forEach((node) => {
      if (childToParent.has(node.id)) return;
      const link = associationOf.get(node.id);
      if (link) {
        sqlOutput.push(this.createAssociationTable(node, link, nodeMap));
        return;
      }
      const extras = this.descendantAttributes(node.id, childToParent, nodeMap);
      sqlOutput.push(this.createEntityTable(node, extras, extras.length > 0));
    });

    const foreignKeys: { table: string; column: string }[] = [];
    associationOf.forEach((conn, nodeId) => {
      const node = nodeMap.get(nodeId);
      const left = nodeMap.get(conn.sourceNodeId);
      const right = nodeMap.get(conn.targetNodeId);
      if (!node || !left || !right) return;
      const table = this.toTableName(node.name);
      [left, right].forEach((parent) => {
        foreignKeys.push({ table, column: this.foreignKeyColumn(parent, this.primaryKeyOf(parent).name) });
      });
    });

    if (options.includeForeignKeys) {
      connectors.forEach((conn) => {
        if (consumed.has(conn.id) || conn.type === 'AssociationClass' || conn.type === 'Inheritance' || conn.type === 'Implementation' || conn.type === 'Dependency') return;
        const sourceNode = rootOf(conn.sourceNodeId);
        const targetNode = rootOf(conn.targetNodeId);
        if (!sourceNode || !targetNode || sourceNode.stereotype === 'Interface' || targetNode.stereotype === 'Interface') return;
        if (associationOf.has(sourceNode.id) || associationOf.has(targetNode.id)) return;

        const srcMany = (conn.sourceMultiplicity || '').includes('*');
        const tgtMany = (conn.targetMultiplicity || '').includes('*');
        if (srcMany && tgtMany) {
          sqlOutput.push(`-- Relationship: ${sourceNode.name} -> ${targetNode.name} (ManyToMany)`);
          sqlOutput.push(this.createJoinTable(sourceNode, targetNode));
          const joinTable = `${this.toTableName(sourceNode.name)}_${this.toTableName(targetNode.name)}`;
          foreignKeys.push({ table: joinTable, column: this.foreignKeyColumn(sourceNode, this.primaryKeyOf(sourceNode).name) });
          foreignKeys.push({ table: joinTable, column: this.foreignKeyColumn(targetNode, this.primaryKeyOf(targetNode).name) });
          return;
        }

        const srcMult = (conn.sourceMultiplicity || '').replace(/\+/g, '').trim();
        const tgtMult = (conn.targetMultiplicity || '').replace(/\+/g, '').trim();
        const oneToOne = !srcMany && !tgtMany && srcMult !== '' && tgtMult !== '';
        const optionalSource = srcMult.startsWith('0');
        const optionalTarget = tgtMult.startsWith('0');
        const fkOnSource = oneToOne
          ? (optionalTarget && !optionalSource ? false : true)
          : this.manySide(conn) === 'source';
        const child = fkOnSource ? sourceNode : targetNode;
        const parent = fkOnSource ? targetNode : sourceNode;
        const childTable = this.toTableName(child.name);
        const parentTable = this.toTableName(parent.name);
        const parentPk = this.primaryKeyOf(parent);
        const fkColumn = this.foreignKeyColumn(parent, parentPk.name);
        const flags = `${oneToOne ? ' UNIQUE' : ''}${conn.type === 'Composition' ? ' NOT NULL' : ''}`;

        sqlOutput.push(`-- Relationship: ${sourceNode.name} -> ${targetNode.name} (${conn.type})`);
        sqlOutput.push(`ALTER TABLE ${childTable}`);
        sqlOutput.push(`  ADD COLUMN IF NOT EXISTS ${fkColumn} ${parentPk.sqlType}${flags};`);
        sqlOutput.push(`ALTER TABLE ${childTable}`);
        sqlOutput.push(`  ADD CONSTRAINT fk_${childTable}_${fkColumn}`);
        sqlOutput.push(`  FOREIGN KEY (${fkColumn}) REFERENCES ${parentTable} (${parentPk.name})`);
        sqlOutput.push(`  ON DELETE CASCADE;\n`);
        foreignKeys.push({ table: childTable, column: fkColumn });
      });
    }

    if (options.addIndexes) {
      foreignKeys.forEach((fk) => {
        sqlOutput.push(`CREATE INDEX idx_${fk.table}_${fk.column} ON ${fk.table}(${fk.column});`);
      });
    }

    return sqlOutput.join('\n');
  }
}
