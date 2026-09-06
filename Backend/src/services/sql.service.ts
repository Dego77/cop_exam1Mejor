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
    if (t === 'uuid') return 'UUID PRIMARY KEY DEFAULT gen_random_uuid()';
    return 'VARCHAR(255)';
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

  public static generateDDL(
    nodes: UMLNode[],
    connectors: UMLConnector[],
    options: SQLOptions = { includeForeignKeys: true, addIndexes: true }
  ): string {
    let sqlOutput: string[] = [];

    sqlOutput.push(`-- ========================================================`);
    sqlOutput.push(`-- ClassForge Generated PostgreSQL DDL Schema`);
    sqlOutput.push(`-- Timestamp: ${new Date().toISOString()}`);
    sqlOutput.push(`-- ========================================================\n`);

    const nodeMap = new Map<string, UMLNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // Filter nodes that are Entities or Classes (ignoring interfaces/enums or translating them)
    const entityNodes = nodes.filter((n) => n.stereotype !== 'Package');

    entityNodes.forEach((node) => {
      const tableName = this.toTableName(node.name);
      sqlOutput.push(`CREATE TABLE ${tableName} (`);

      const columns: string[] = [];
      let hasPrimaryKey = false;

      // Attributes to columns
      const attrs = Array.isArray(node.attributes) ? node.attributes : [];
      attrs.forEach((attr) => {
        const colName = this.toColumnName(attr.name);
        let colType = this.mapTypeToPostgres(attr.type);

        if (colName.includes('id') && !hasPrimaryKey) {
          colType = 'VARCHAR(255) PRIMARY KEY';
          hasPrimaryKey = true;
        }

        columns.push(`  ${colName} ${colType}`);
      });

      if (!hasPrimaryKey) {
        const defaultPkName = `${this.toColumnName(node.name)}_id`;
        columns.unshift(`  ${defaultPkName} VARCHAR(255) PRIMARY KEY`);
      }

      sqlOutput.push(columns.join(',\n'));
      sqlOutput.push(`);\n`);
    });

    // Handle Foreign Keys & Relationships
    if (options.includeForeignKeys) {
      connectors.forEach((conn) => {
        const sourceNode = nodeMap.get(conn.sourceNodeId);
        const targetNode = nodeMap.get(conn.targetNodeId);

        if (sourceNode && targetNode) {
          const sourceTable = this.toTableName(sourceNode.name);
          const targetTable = this.toTableName(targetNode.name);
          const fkColName = `${this.toColumnName(targetNode.name)}_id`;

          sqlOutput.push(`-- Relationship: ${sourceNode.name} -> ${targetNode.name} (${conn.type})`);
          sqlOutput.push(`ALTER TABLE ${sourceTable}`);
          sqlOutput.push(`  ADD COLUMN IF NOT EXISTS ${fkColName} VARCHAR(255);`);
          sqlOutput.push(`ALTER TABLE ${sourceTable}`);
          sqlOutput.push(`  ADD CONSTRAINT fk_${sourceTable}_${targetTable}`);
          sqlOutput.push(`  FOREIGN KEY (${fkColName}) REFERENCES ${targetTable}(${this.toColumnName(targetNode.name)}_id)`);
          sqlOutput.push(`  ON DELETE CASCADE;\n`);
        }
      });
    }

    // Handle Indexes
    if (options.addIndexes) {
      connectors.forEach((conn) => {
        const sourceNode = nodeMap.get(conn.sourceNodeId);
        const targetNode = nodeMap.get(conn.targetNodeId);

        if (sourceNode && targetNode) {
          const sourceTable = this.toTableName(sourceNode.name);
          const fkColName = `${this.toColumnName(targetNode.name)}_id`;
          sqlOutput.push(`CREATE INDEX idx_${sourceTable}_${fkColName} ON ${sourceTable}(${fkColName});`);
        }
      });
    }

    return sqlOutput.join('\n');
  }
}
