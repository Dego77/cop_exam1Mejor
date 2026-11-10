import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgreSQLGeneratorService, UMLConnector, UMLNode } from './sql.service';
import { SpringBootGeneratorService } from './springboot.service';

function node(id: string, name: string, stereotype: string, attributes: { name: string; type: string }[]): UMLNode {
  return {
    id,
    name,
    stereotype,
    attributes: attributes.map((attr, index) => ({ id: `${id}-${index}`, ...attr })),
    methods: [],
  };
}

function tableBlock(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE ${table}`);
  const startIf = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  const at = start >= 0 ? start : startIf;
  assert.ok(at >= 0, `falta la tabla ${table}`);
  const rest = sql.slice(at + 1);
  const next = rest.search(/CREATE TABLE|ALTER TABLE|-- Relationship/);
  return sql.slice(at, next >= 0 ? at + 1 + next : undefined);
}

const id = (name: string, type = 'String') => ({ name, type });

describe('otras relaciones en el SQL del diagrama', () => {
  it('pone la clave foránea en el lado muchos de una asociación', () => {
    const sql = PostgreSQLGeneratorService.generateDDL(
      [
        node('nv', 'NotaVenta', 'Class', [id('id'), id('fecha', 'Date')]),
        node('cli', 'Cliente', 'Class', [id('id'), id('nombre')]),
      ],
      [{ id: 'c', sourceNodeId: 'nv', targetNodeId: 'cli', type: 'Association', sourceMultiplicity: '*', targetMultiplicity: '1' }]
    );
    assert.match(sql, /ALTER TABLE nota_ventas[\s\S]*cliente_id VARCHAR\(255\)/);
    assert.match(sql, /REFERENCES clientes \(id\)/);
    assert.doesNotMatch(sql, /ALTER TABLE clientes/);
  });

  it('arma una tabla intermedia cuando la asociación es de muchos a muchos', () => {
    const sql = PostgreSQLGeneratorService.generateDDL(
      [
        node('cli', 'Cliente', 'Class', [id('id'), id('nombre')]),
        node('prod', 'Producto', 'Class', [id('id'), id('nombre')]),
      ],
      [{ id: 'c', sourceNodeId: 'cli', targetNodeId: 'prod', type: 'Association', sourceMultiplicity: '*', targetMultiplicity: '0..*' }]
    );
    const join = tableBlock(sql, 'clientes_productos');
    assert.match(join, /cliente_id VARCHAR\(255\) NOT NULL/);
    assert.match(join, /producto_id VARCHAR\(255\) NOT NULL/);
    assert.match(join, /PRIMARY KEY \(cliente_id, producto_id\)/);
    assert.match(join, /REFERENCES clientes \(id\)/);
    assert.match(join, /REFERENCES productos \(id\)/);
    assert.doesNotMatch(sql, /ALTER TABLE clientes/);
    assert.doesNotMatch(sql, /ALTER TABLE productos/);
  });

  it('marca única la clave foránea de una relación uno a uno', () => {
    const sql = PostgreSQLGeneratorService.generateDDL(
      [
        node('usu', 'Usuario', 'Class', [id('id'), id('nombre')]),
        node('per', 'Perfil', 'Class', [id('id'), id('bio')]),
      ],
      [{ id: 'c', sourceNodeId: 'usu', targetNodeId: 'per', type: 'Association', sourceMultiplicity: '1', targetMultiplicity: '0..1' }]
    );
    assert.match(sql, /ALTER TABLE perfils[\s\S]*usuario_id VARCHAR\(255\) UNIQUE/);
    assert.match(sql, /REFERENCES usuarios \(id\)/);
  });

  it('exige la clave foránea en una composición y la deja opcional en una agregación', () => {
    const composition = PostgreSQLGeneratorService.generateDDL(
      [
        node('lin', 'Linea', 'Class', [id('id'), id('cantidad', 'Integer')]),
        node('ped', 'Pedido', 'Class', [id('id')]),
      ],
      [{ id: 'c', sourceNodeId: 'lin', targetNodeId: 'ped', type: 'Composition' }]
    );
    assert.match(composition, /ALTER TABLE lineas[\s\S]*pedido_id VARCHAR\(255\) NOT NULL/);
    assert.doesNotMatch(composition, /cantidad[^,\n]*PRIMARY KEY/);

    const aggregation = PostgreSQLGeneratorService.generateDDL(
      [
        node('emp', 'Empleado', 'Class', [id('id'), id('nombre')]),
        node('dep', 'Departamento', 'Class', [id('id'), id('nombre')]),
      ],
      [{ id: 'c', sourceNodeId: 'emp', targetNodeId: 'dep', type: 'Aggregation' }]
    );
    assert.match(aggregation, /departamento_id VARCHAR\(255\);/);
    assert.doesNotMatch(aggregation, /departamento_id VARCHAR\(255\) NOT NULL/);
  });

  it('pliega la clase hija en la tabla del padre y no crea tabla para una interfaz', () => {
    const sql = PostgreSQLGeneratorService.generateDDL(
      [
        node('per', 'Persona', 'Class', [id('id'), id('nombre')]),
        node('cli', 'Cliente', 'Class', [id('id'), id('email')]),
        node('pag', 'Pagable', 'Interface', []),
        node('fac', 'Factura', 'Class', [id('id'), id('total', 'Double')]),
        node('cal', 'Calculadora', 'Class', [id('id')]),
      ],
      [
        { id: 'h', sourceNodeId: 'cli', targetNodeId: 'per', type: 'Inheritance' },
        { id: 'i', sourceNodeId: 'fac', targetNodeId: 'pag', type: 'Implementation' },
        { id: 'd', sourceNodeId: 'fac', targetNodeId: 'cal', type: 'Dependency' },
      ] as UMLConnector[]
    );
    const personas = tableBlock(sql, 'personas');
    assert.match(personas, /nombre VARCHAR\(255\)/);
    assert.match(personas, /email VARCHAR\(255\)/);
    assert.match(personas, /dtype VARCHAR\(31\)/);
    assert.doesNotMatch(sql, /CREATE TABLE clientes/);
    assert.doesNotMatch(sql, /CREATE TABLE pagables/);
    assert.doesNotMatch(sql, /REFERENCES calculadoras/);
    assert.match(sql, /CREATE TABLE facturas/);
  });
});

describe('las mismas relaciones en el SQL del backend', () => {
  const schema = (nodes: UMLNode[], connectors: UMLConnector[]) =>
    SpringBootGeneratorService.renderSchemaSql(nodes as any, connectors as any);

  it('da a la clase de asociación dos claves distintas y sus atributos propios', () => {
    const sql = schema(
      [
        node('nv', 'NotaVenta', 'Class', [id('id'), id('fecha', 'Date')]),
        node('prod', 'Producto', 'Class', [id('id'), id('nombre')]),
        node('det', 'DetalleVenta', 'AssociationClass', [id('cantidad'), id('precio_unitario', 'Double')]),
      ],
      [{ id: 'c', sourceNodeId: 'nv', targetNodeId: 'prod', type: 'AssociationClass', associationClassNodeId: 'det' }]
    );
    const detail = tableBlock(sql, 'detalle_ventas');
    assert.match(detail, /idNotaVenta VARCHAR\(255\)/);
    assert.match(detail, /idProducto VARCHAR\(255\)/);
    assert.match(detail, /cantidad VARCHAR\(255\)/);
    assert.match(detail, /precio_unitario DOUBLE PRECISION/);
    assert.match(detail, /PRIMARY KEY \(idNotaVenta, idProducto\)/);
    assert.match(detail, /FOREIGN KEY \(idNotaVenta\) REFERENCES nota_ventas/);
    assert.match(detail, /FOREIGN KEY \(idProducto\) REFERENCES productos/);
    assert.doesNotMatch(detail, /cantidad[^,\n]*PRIMARY KEY/);
  });

  it('crea la tabla puente, la clave única y la composición obligatoria', () => {
    const many = schema(
      [
        node('cli', 'Cliente', 'Class', [id('id')]),
        node('prod', 'Producto', 'Class', [id('id')]),
      ],
      [{ id: 'c', sourceNodeId: 'cli', targetNodeId: 'prod', type: 'Association', sourceMultiplicity: '*', targetMultiplicity: '*' }]
    );
    const join = tableBlock(many, 'clientes_productos');
    assert.match(join, /cliente_id VARCHAR\(255\) NOT NULL/);
    assert.match(join, /producto_id VARCHAR\(255\) NOT NULL/);
    assert.match(join, /PRIMARY KEY \(cliente_id, producto_id\)/);

    const pair = schema(
      [
        node('usu', 'Usuario', 'Class', [id('id')]),
        node('per', 'Perfil', 'Class', [id('id')]),
      ],
      [{ id: 'c', sourceNodeId: 'usu', targetNodeId: 'per', type: 'Association', sourceMultiplicity: '1', targetMultiplicity: '0..1' }]
    );
    assert.match(pair, /usuario_id VARCHAR\(255\) UNIQUE/);

    const composition = schema(
      [
        node('lin', 'Linea', 'Class', [id('id'), id('cantidad', 'Integer')]),
        node('ped', 'Pedido', 'Class', [id('id')]),
      ],
      [{ id: 'c', sourceNodeId: 'lin', targetNodeId: 'ped', type: 'Composition' }]
    );
    assert.match(composition, /pedido_id VARCHAR\(255\) NOT NULL/);
    assert.doesNotMatch(composition, /cantidad[^,\n]*PRIMARY KEY/);
  });

  it('comparte la tabla del padre y omite interfaces, implementaciones y dependencias', () => {
    const sql = schema(
      [
        node('per', 'Persona', 'Class', [id('id'), id('nombre')]),
        node('cli', 'Cliente', 'Class', [id('email')]),
        node('pag', 'Pagable', 'Interface', []),
        node('fac', 'Factura', 'Class', [id('id'), id('total', 'Double')]),
        node('cal', 'Calculadora', 'Class', [id('id')]),
      ],
      [
        { id: 'h', sourceNodeId: 'cli', targetNodeId: 'per', type: 'Inheritance' },
        { id: 'i', sourceNodeId: 'fac', targetNodeId: 'pag', type: 'Implementation' },
        { id: 'd', sourceNodeId: 'fac', targetNodeId: 'cal', type: 'Dependency' },
      ]
    );
    const personas = tableBlock(sql, 'personas');
    assert.match(personas, /nombre VARCHAR\(255\)/);
    assert.match(personas, /email VARCHAR\(255\)/);
    assert.match(personas, /dtype VARCHAR\(31\)/);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS clientes/);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS pagables/);
    assert.doesNotMatch(sql, /REFERENCES calculadoras/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS facturas/);
  });
});

describe('las clases Java de una asociación', () => {
  it('importa la clave compuesta y la marca como embebible', () => {
    const files = SpringBootGeneratorService.renderJavaSources(
      [
        node('nv', 'NotaVenta', 'Class', [id('id'), id('fecha', 'Date')]),
        node('prod', 'Producto', 'Class', [id('id'), id('nombre')]),
        node('det', 'DetalleVenta', 'AssociationClass', [id('cantidad'), id('precio_unitario', 'Double')]),
      ],
      [{ id: 'c', sourceNodeId: 'nv', targetNodeId: 'prod', type: 'AssociationClass', associationClassNodeId: 'det' }]
    );

    const idClass = files['model/DetalleVentaId.java'];
    const repository = files['repository/DetalleVentaRepository.java'];
    const service = files['service/DetalleVentaService.java'];
    const entity = files['model/DetalleVenta.java'];

    assert.match(idClass, /@Embeddable/);
    assert.match(idClass, /public class DetalleVentaId implements Serializable/);
    assert.match(idClass, /private String idNotaVenta;/);
    assert.match(idClass, /private String idProducto;/);
    assert.match(repository, /import com\.examen\.backend\.model\.DetalleVentaId;/);
    assert.match(repository, /JpaRepository<DetalleVenta, DetalleVentaId>/);
    assert.match(service, /import com\.examen\.backend\.model\.DetalleVentaId;/);
    assert.match(service, /findById\(DetalleVentaId id\)/);
    assert.match(service, /deleteById\(DetalleVentaId id\)/);
    assert.match(entity, /@EmbeddedId/);
    assert.match(entity, /private DetalleVentaId id;/);
    assert.doesNotMatch(files['repository/NotaVentaRepository.java'], /import com\.examen\.backend\.model\.Long/);
  });
});
