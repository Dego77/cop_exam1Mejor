import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgreSQLGeneratorService, UMLNode } from './sql.service';

function node(id: string, name: string, stereotype: string, attributes: { name: string; type: string }[]): UMLNode {
  return {
    id,
    name,
    stereotype,
    attributes: attributes.map((attr, index) => ({ id: `${id}-${index}`, ...attr })),
    methods: [],
  };
}

describe('script SQL de una clase de asociación', () => {
  it('entrega a detalle_ventas las claves de NotaVenta y Producto', () => {
    const nodes = [
      node('cat', 'Categoria', 'Class', [{ name: 'id', type: 'String' }, { name: 'nombre', type: 'String' }]),
      node('prod', 'Producto', 'Class', [{ name: 'id', type: 'String' }, { name: 'nombre', type: 'String' }, { name: 'descripcion', type: 'String' }]),
      node('det', 'DetalleVenta', 'AssociationClass', [{ name: 'cantidad', type: 'String' }, { name: 'precio_unitario', type: 'Double' }]),
      node('cli', 'Cliente', 'Class', [{ name: 'id', type: 'String' }, { name: 'nombre', type: 'String' }, { name: 'email', type: 'String' }]),
      node('nv', 'NotaVenta', 'Class', [{ name: 'id', type: 'String' }, { name: 'fecha', type: 'Date' }, { name: 'total', type: 'Double' }]),
    ];
    const sql = PostgreSQLGeneratorService.generateDDL(nodes, [
      { id: 'c1', sourceNodeId: 'cli', targetNodeId: 'nv', type: 'Association' },
      { id: 'c2', sourceNodeId: 'prod', targetNodeId: 'cat', type: 'Association' },
      { id: 'c3', sourceNodeId: 'nv', targetNodeId: 'prod', type: 'AssociationClass', associationClassNodeId: 'det' },
    ]);

    const detail = sql.slice(sql.indexOf('CREATE TABLE detalle_ventas'), sql.indexOf('CREATE TABLE', sql.indexOf('CREATE TABLE detalle_ventas') + 1));
    assert.match(detail, /nota_venta_id VARCHAR\(255\) NOT NULL/);
    assert.match(detail, /producto_id VARCHAR\(255\) NOT NULL/);
    assert.match(detail, /cantidad VARCHAR\(255\)/);
    assert.match(detail, /precio_unitario DOUBLE PRECISION/);
    assert.match(detail, /PRIMARY KEY \(nota_venta_id, producto_id\)/);
    assert.match(detail, /FOREIGN KEY \(nota_venta_id\) REFERENCES nota_ventas \(id\)/);
    assert.match(detail, /FOREIGN KEY \(producto_id\) REFERENCES productos \(id\)/);
    assert.doesNotMatch(sql, /cantidad[^,\n]*PRIMARY KEY/);
    assert.doesNotMatch(sql, /ALTER TABLE nota_ventas/);
    assert.match(sql, /REFERENCES categorias \(id\)/);
    assert.doesNotMatch(sql, /REFERENCES \w+ \(categoria_id\)/);
  });
});
