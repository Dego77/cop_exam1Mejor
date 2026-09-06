import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    const userId = req.user!.id;

    if (!name) {
      res.status(400).json({ error: 'El nombre del proyecto es obligatorio.' });
      return;
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        ownerId: userId,
        diagrams: {
          create: {
            name: `${name} Diagram`,
          },
        },
      },
      include: {
        diagrams: true,
        collaborators: true,
      },
    });

    res.status(201).json(project);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear proyecto: ' + error.message });
  }
};

export const getUserProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const ownedProjects = await prisma.project.findMany({
      where: { ownerId: userId },
      include: {
        owner: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
        collaborators: {
          include: { user: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
        },
        diagrams: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const sharedCollaborations = await prisma.projectCollaborator.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            owner: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
            collaborators: {
              include: { user: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
            },
            diagrams: true,
          },
        },
      },
    });

    const sharedProjects = sharedCollaborations.map((c) => c.project);

    res.json({
      owned: ownedProjects,
      shared: sharedProjects,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar proyectos: ' + error.message });
  }
};

export const getProjectById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId } } },
        ],
      },
      include: {
        owner: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
        collaborators: {
          include: { user: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
        },
        diagrams: {
          include: {
            nodes: true,
            connectors: true,
          },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado o sin permisos de acceso.' });
      return;
    }

    res.json(project);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener proyecto: ' + error.message });
  }
};

export const addCollaborator = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { email, role } = req.body;
    const userId = req.user!.id;

    // Verify user owns or is admin of project
    const project = await prisma.project.findFirst({
      where: { id, ownerId: userId },
    });

    if (!project) {
      res.status(403).json({ error: 'Solo el propietario del proyecto puede invitar colaboradores.' });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { email } });
    if (!targetUser) {
      res.status(404).json({ error: 'El usuario a invitar no existe en ClassForge.' });
      return;
    }

    const collaborator = await prisma.projectCollaborator.upsert({
      where: {
        projectId_userId: {
          projectId: id,
          userId: targetUser.id,
        },
      },
      update: { role: (role as string) || 'EDITOR' },
      create: {
        projectId: id,
        userId: targetUser.id,
        role: (role as string) || 'EDITOR',
      },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
      },
    });

    res.json({ message: 'Colaborador añadido exitosamente', collaborator });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al agregar colaborador: ' + error.message });
  }
};
