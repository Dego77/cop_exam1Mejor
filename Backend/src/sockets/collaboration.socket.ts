import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';

// Mapa de projectId -> mapa de socketId a usuario
const roomUsers = new Map<string, Map<string, any>>();

// "Modo Ver" (app móvil): el usuario sale del JWT verificado, nunca del cuerpo del mensaje, y
// tiene que ser el dueño o un colaborador. Devuelve el usuario, o null si no puede entrar.
async function resolveViewer(projectId: string, token: string | undefined) {
  if (!token) return null;
  try {
    const secret = process.env.JWT_SECRET || 'classforge_super_secret_jwt_key_2026_antigravity';
    const decoded = jwt.verify(token, secret) as { id: number };
    const userId = Number(decoded.id);
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId } } },
        ],
      },
      select: { id: true },
    });
    if (!project) return null;
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, avatarUrl: true },
    });
  } catch {
    return null;
  }
}

export const setupCollaborationSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    // Unirse a la sala del proyecto colaborativo
    socket.on('join-project', async ({ projectId, user, mode, token }) => {
      if (!projectId) return;

      // Visor de solo lectura: autenticación estricta, sin sesión de trabajo, y se ignora cualquier edición suya
      if (mode === 'view') {
        const viewer = await resolveViewer(projectId, token);
        if (!viewer) {
          socket.emit('join-denied', { projectId, reason: 'No tienes acceso a este proyecto.' });
          return;
        }

        socket.data.viewOnly = true;
        socket.join(projectId);

        if (!roomUsers.has(projectId)) {
          roomUsers.set(projectId, new Map());
        }
        const viewerData = { ...viewer, socketId: socket.id, joinedAt: new Date().toISOString(), viewOnly: true };
        roomUsers.get(projectId)!.set(socket.id, viewerData);

        console.log(`[Socket] Usuario ${viewer.fullName} se unió en MODO VER al proyecto ${projectId}`);
        io.to(projectId).emit('room-users', Array.from(roomUsers.get(projectId)!.values()));
        socket.to(projectId).emit('user-joined', { user: viewerData, socketId: socket.id });
        return;
      }

      // Validar que el usuario puede entrar al proyecto, si existe en la base
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          include: { collaborators: true }
        });
        if (project && user && user.id) {
          const uId = Number(user.id);
          const isOwner = project.ownerId === uId;
          const isCollab = project.collaborators?.some((c: any) => c.userId === uId);
          if (!isOwner && !isCollab) {
            console.warn(`[Socket] Acceso denegado: Usuario ${user.fullName || uId} no pertenece al proyecto ${projectId}`);
            return;
          }
        }
      } catch (err) {}

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

    // Seguimiento del cursor en tiempo real
    socket.on('cursor-move', ({ projectId, cursor, user }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      socket.to(projectId).emit('cursor-moved', {
        socketId: socket.id,
        cursor,
        user,
      });
    });

    // Arrastre de nodos en tiempo real y autoguardado
    socket.on('node-dragged', async ({ projectId, nodeId, positionX, positionY }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      // Enviar a la sala de inmediato para que se dibuje fluido
      socket.to(projectId).emit('node-dragged', { nodeId, positionX, positionY });

      // Guardar la posición en la base compartida (la fuente única)
      try {
        await prisma.node.update({
          where: { id: nodeId },
          data: { positionX, positionY },
        });
      } catch (err) {
        console.error('[Socket] Error al guardar posición del nodo:', err);
      }
    });

    // Actualización en tiempo real del contenido del nodo (atributos y métodos)
    socket.on('node-updated', async ({ projectId, node }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
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

    // Creación de nodos en tiempo real
    socket.on('node-created', async ({ projectId, node }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      socket.to(projectId).emit('node-created', { node });
    });

    // Borrado de nodos en tiempo real
    socket.on('node-deleted', async ({ projectId, nodeId }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      socket.to(projectId).emit('node-deleted', { nodeId });
    });

    // Creación de conectores en tiempo real
    socket.on('connector-created', async ({ projectId, connector }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      socket.to(projectId).emit('connector-created', { connector });
    });

    // Borrado de conectores en tiempo real
    socket.on('connector-deleted', async ({ projectId, connectorId }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
      socket.to(projectId).emit('connector-deleted', { connectorId });
    });

    // Recarga completa del diagrama en tiempo real (operaciones de la IA y cambios masivos)
    socket.on('diagram-reloaded', async ({ projectId, payload }) => {
      if (socket.data.viewOnly) return; // Modo Ver: read-only
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

