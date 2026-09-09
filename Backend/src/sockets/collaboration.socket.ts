import { Server, Socket } from 'socket.io';
import { prisma } from '../config/prisma';

// Map of projectId -> Map<socketId, user>
const roomUsers = new Map<string, Map<string, any>>();

export const setupCollaborationSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    // Join collaborative project room
    socket.on('join-project', async ({ projectId, user }) => {
      if (!projectId) return;
      socket.join(projectId);

      if (!roomUsers.has(projectId)) {
        roomUsers.set(projectId, new Map());
      }
      const projectMap = roomUsers.get(projectId)!;
      
      const joinedAt = new Date();
      let sessionId: string | undefined = undefined;

      if (user && user.id) {
        try {
          const session = await (prisma as any).workSession.create({
            data: {
              projectId,
              userId: Number(user.id),
              startTime: joinedAt,
              socketId: socket.id
            }
          });
          sessionId = session.id;
        } catch (err) {
          console.error('[Socket] Error al crear WorkSession en DB:', err);
        }
      }

      const userData = {
        ...user,
        socketId: socket.id,
        joinedAt: joinedAt.toISOString(),
        sessionId
      };

      projectMap.set(socket.id, userData);

      console.log(`[Socket] Usuario ${user?.fullName || socket.id} se unió al proyecto ${projectId}`);
      
      const activeUsers = Array.from(projectMap.values());
      io.to(projectId).emit('room-users', activeUsers);
      socket.to(projectId).emit('user-joined', { user: userData, socketId: socket.id });
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

    // Realtime node creation
    socket.on('node-created', async ({ projectId, node }) => {
      socket.to(projectId).emit('node-created', { node });
    });

    // Realtime node deletion
    socket.on('node-deleted', async ({ projectId, nodeId }) => {
      socket.to(projectId).emit('node-deleted', { nodeId });
    });

    // Realtime connector creation
    socket.on('connector-created', async ({ projectId, connector }) => {
      socket.to(projectId).emit('connector-created', { connector });
    });

    // Realtime connector deletion
    socket.on('connector-deleted', async ({ projectId, connectorId }) => {
      socket.to(projectId).emit('connector-deleted', { connectorId });
    });

    // Realtime full diagram reloaded (AI operations, bulk updates)
    socket.on('diagram-reloaded', async ({ projectId, payload }) => {
      socket.to(projectId).emit('diagram-reloaded', { projectId, payload });
    });

    socket.on('disconnecting', async () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          const projectMap = roomUsers.get(room);
          if (projectMap) {
            const userObj = projectMap.get(socket.id);
            if (userObj && userObj.sessionId) {
              const endTime = new Date();
              const startTime = userObj.joinedAt ? new Date(userObj.joinedAt) : new Date();
              const durationSec = Math.max(0, Math.floor((endTime.getTime() - startTime.getTime()) / 1000));
              try {
                await (prisma as any).workSession.update({
                  where: { id: userObj.sessionId },
                  data: {
                    endTime,
                    duration: durationSec
                  }
                });
              } catch (err) {
                console.error('[Socket] Error al cerrar WorkSession en DB:', err);
              }
            }
            projectMap.delete(socket.id);
            if (projectMap.size === 0) {
              roomUsers.delete(room);
            } else {
              const activeUsers = Array.from(projectMap.values());
              io.to(room).emit('room-users', activeUsers);
            }
          }
          socket.to(room).emit('user-left', { socketId: socket.id });
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    });
  });
};

