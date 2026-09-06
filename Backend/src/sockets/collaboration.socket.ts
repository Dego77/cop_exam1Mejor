import { Server, Socket } from 'socket.io';
import { prisma } from '../config/prisma';

export const setupCollaborationSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    // Join collaborative project room
    socket.on('join-project', ({ projectId, user }) => {
      socket.join(projectId);
      console.log(`[Socket] Usuario ${user?.fullName || socket.id} se unió al proyecto ${projectId}`);
      socket.to(projectId).emit('user-joined', { user, socketId: socket.id });
    });

    // Realtime cursor tracking
    socket.on('cursor-move', ({ projectId, cursor, user }) => {
      socket.to(projectId).emit('cursor-moved', {
        socketId: socket.id,
        cursor,
        user,
      });
    });

    // Realtime node dragging / auto-saving
    socket.on('node-dragged', async ({ projectId, nodeId, positionX, positionY }) => {
      // Broadcast to room immediately for smooth 60fps rendering
      socket.to(projectId).emit('node-dragged', { nodeId, positionX, positionY });

      // Save position to shared database (single source of truth)
      try {
        await prisma.node.update({
          where: { id: nodeId },
          data: { positionX, positionY },
        });
      } catch (err) {
        console.error('[Socket] Error al guardar posición del nodo:', err);
      }
    });

    // Realtime node content update (attributes/methods)
    socket.on('node-updated', async ({ projectId, node }) => {
      socket.to(projectId).emit('node-updated', { node });

      try {
        await prisma.node.update({
          where: { id: node.id },
          data: {
            name: node.name,
            stereotype: node.stereotype,
            attributes: node.attributes,
            methods: node.methods,
          },
        });
      } catch (err) {
        console.error('[Socket] Error al actualizar contenido del nodo:', err);
      }
    });

    // Realtime connector creation
    socket.on('connector-created', async ({ projectId, connector }) => {
      socket.to(projectId).emit('connector-created', { connector });
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit('user-left', { socketId: socket.id });
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    });
  });
};
