import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asksForAdvice,
  buildGroupChatPrompt,
  canDecideProposal,
  clarifyPendingApply,
  describeDirectApply,
  holdUnconfirmedDeletes,
  mentionsAgent,
  personalizeAiReply,
  selectChatContext,
  stripAgentMention,
  userConfirmedDeletion,
} from './chat-prompt';
import { affectedConnectors, reviewDiagramChange, validateMutationPayload } from './diagram-commands';

const diagram = {
  nodes: [
    { id: 'usuario', name: 'Usuario' },
    { id: 'rol', name: 'Rol' },
  ],
  connectors: [
    { id: 'c-91', sourceNodeId: 'usuario', targetNodeId: 'rol', sourceClassName: 'Usuario', targetClassName: 'Rol', type: 'Association' },
    { id: 'c-92', sourceNodeId: 'usuario', targetNodeId: 'rol', sourceClassName: 'Usuario', targetClassName: 'Rol', type: 'Dependency' },
  ],
};

describe('chat grupal', () => {
  it('detecta la mención a Agente IA y la quita de la pregunta', () => {
    assert.equal(mentionsAgent('@Agente IA elimina la relación'), true);
    assert.equal(mentionsAgent('hola equipo'), false);
    assert.equal(stripAgentMention('@Agente IA elimina la relación'), 'elimina la relación');
  });

  it('saluda solo en la primera respuesta', () => {
    assert.equal(personalizeAiReply('Hola Ana, listo.', 'Ana', true), 'Hola Ana, listo.');
    assert.equal(personalizeAiReply('Hola Ana, listo.', 'Ana', false), 'Ana, listo.');
    assert.equal(personalizeAiReply('listo.', 'Ana', false), 'Ana, listo.');
  });

  it('solo quien consultó puede decidir', () => {
    assert.equal(canDecideProposal(4, 4), true);
    assert.equal(canDecideProposal(4, 9), false);
  });

  it('recorta el historial a recientes y relevantes', () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      author: 'Luis',
      type: 'USER' as const,
      text: index === 3 ? 'el correo de Usuario identifica a la persona' : `mensaje ${index} del equipo sobre otra cosa`,
    }));
    const selected = selectChatContext(messages, 'elimina correo de Usuario', '');
    assert.equal(selected.recent.length, 20);
    assert.equal(selected.relevant.length, 1);
    assert.match(selected.relevant[0].texto, /correo/);
  });

  it('el prompt incluye ids y la bandera de primera respuesta', () => {
    const prompt = buildGroupChatPrompt({
      author: 'Ana',
      firstReply: true,
      question: 'elimina la relación entre Usuario y Rol',
      summary: '',
      recent: [],
      relevant: [],
      diagram: {
        nodes: diagram.nodes.map((node) => ({ nodeId: node.id, name: node.name })),
        connectors: diagram.connectors.map((item) => ({
          connectorId: item.id,
          sourceNodeId: item.sourceNodeId,
          targetNodeId: item.targetNodeId,
          sourceClassName: item.sourceClassName,
          targetClassName: item.targetClassName,
          type: item.type,
        })),
      },
      selected: null,
    });
    assert.match(prompt, /primera_respuesta_a_usuario": true/);
    assert.match(prompt, /c-91/);
    assert.match(prompt, /connectorId/);
    assert.match(prompt, /No aceptes automáticamente toda solicitud de borrado/);
    assert.match(prompt, /pulsen Permitir/);
    assert.match(prompt, /attributesToAdd/);
    assert.match(prompt, /connectorsGenerated/);
    assert.match(prompt, /Editar un atributo/);
    assert.match(prompt, /id va primero/);
    assert.match(prompt, /clase de asociación/);
    assert.match(prompt, /atributos esenciales/);
  });

  it('no deja listo un borrado hasta que la persona confirme', () => {
    const proposal = { classesToDelete: [{ nodeId: 'usuario', name: 'Usuario' }], connectorsToDelete: [{ connectorId: 'c-91' }] };
    assert.equal(userConfirmedDeletion('elimina la clase Usuario', []), false);
    assert.equal(holdUnconfirmedDeletes(proposal, false), true);
    assert.deepEqual(proposal.classesToDelete, []);
    assert.deepEqual(proposal.connectorsToDelete, []);
    const again = { classesToDelete: [{ nodeId: 'usuario', name: 'Usuario' }] };
    const recent = [{ tipo: 'AI', texto: 'Si la eliminas se pierde la relación con Rol. ¿Confirmas?' }];
    assert.equal(userConfirmedDeletion('sí, confirmo', recent), true);
    assert.equal(holdUnconfirmedDeletes(again, true), false);
    assert.equal(again.classesToDelete.length, 1);
  });

  it('avisa que el cambio sigue pendiente de Permitir', () => {
    const said = clarifyPendingApply('Isaac, ha añadido la relación entre Factura y Consulta al diagrama.', true);
    assert.match(said, /Todavía no está en el diagrama/);
    assert.match(said, /Permitir/);
    assert.equal(clarifyPendingApply('Isaac, dejo la relación lista. Usa Permitir.', true), 'Isaac, dejo la relación lista. Usa Permitir.');
    assert.equal(clarifyPendingApply('Isaac, no hay cambios.', false), 'Isaac, no hay cambios.');
  });

  it('un agregado directo no pide Permitir', () => {
    const said = describeDirectApply('Isaac, dejo preparada la modificación para que pulses Permitir.', true, false);
    assert.match(said, /ya quedó en el diagrama/);
    assert.doesNotMatch(said, /Permitir/);
  });

  it('una recomendación o un concepto no es un pedido de dibujar', () => {
    assert.equal(asksForAdvice('eres un senior, recomiéndame cual agregar'), true);
    assert.equal(asksForAdvice('qué es una llave primaria'), true);
    assert.equal(asksForAdvice('añade atributos a la clase Producto, como ser nombre, descripcion'), false);
    assert.equal(asksForAdvice('crea la clase Cliente'), false);
  });
});

describe('comandos del diagrama', () => {
  it('rechaza un id de clase que ya no existe', () => {
    const result = validateMutationPayload({ classesToDelete: [{ nodeId: 'viejo', name: 'Fantasma' }] }, diagram);
    assert.equal(result.payload.classesToDelete.length, 0);
    assert.equal(result.notes.length, 1);
  });

  it('no borra una relación si hay dos entre las mismas clases y no viene el id', () => {
    const result = validateMutationPayload({
      connectorsToDelete: [{ sourceClassName: 'Usuario', targetClassName: 'Rol' }],
    }, diagram);
    assert.equal(result.payload.connectorsToDelete.length, 0);
    assert.match(result.notes[0], /más de una relación/);
  });

  it('acepta el connectorId exacto', () => {
    const result = validateMutationPayload({ connectorsToDelete: [{ connectorId: 'c-92' }] }, diagram);
    assert.deepEqual(result.payload.connectorsToDelete, [{ connectorId: 'c-92' }]);
  });

  it('al borrar una clase señala las relaciones conectadas', () => {
    assert.deepEqual(affectedConnectors('usuario', diagram), ['c-91', 'c-92']);
  });

  it('un JSON inválido no es una respuesta de diagrama', () => {
    const raw = 'no es json';
    assert.throws(() => JSON.parse(raw));
  });

  it('no vuelve a crear una clase ni un atributo que ya existen', () => {
    const canvas = {
      nodes: [{ id: 'cliente', name: 'Cliente', attributes: [{ name: 'nombre' }], methods: [] }],
      connectors: [],
    };
    const result = reviewDiagramChange({
      classesGenerated: [{ name: 'Cliente', attributes: [{ name: 'nombre' }, { name: 'email', type: 'String' }] }],
    }, canvas);
    assert.equal(result.safe.classesGenerated, undefined);
    assert.deepEqual(result.safe.classesModified[0].attributesToAdd.map((item: any) => item.name), ['email']);
    assert.match(result.notes.join(' '), /ya está en el diagrama/);
    assert.match(result.notes.join(' '), /ya tiene el atributo nombre/);
  });

  it('un borrado sigue siendo crítico y un atributo nuevo es directo', () => {
    const canvas = {
      nodes: [{ id: 'producto', name: 'Producto', attributes: [{ name: 'precio' }], methods: [] }],
      connectors: [],
    };
    const result = reviewDiagramChange({
      classesModified: [{ name: 'Producto', attributesToAdd: [{ name: 'descripcion', type: 'String' }] }],
      classesToDelete: [{ nodeId: 'producto', name: 'Producto' }],
    }, canvas);
    assert.equal(result.safe.classesModified[0].attributesToAdd[0].name, 'descripcion');
    assert.equal(result.critical.classesToDelete.length, 1);
  });
});
