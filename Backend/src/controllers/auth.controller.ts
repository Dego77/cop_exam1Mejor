import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Todos los campos son obligatorios (email, password, fullName).' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'El usuario con este correo ya existe.' });
      return;
    }

    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(fullName)}`;

    // Store plain text password as requested by user
    const newUser = await prisma.user.create({
      data: {
        email,
        password: password,
        fullName,
        avatarUrl,
      },
    });

    const secret = process.env.JWT_SECRET || 'classforge_super_secret_jwt_key_2026_antigravity';
    const token = jwt.sign({ id: newUser.id, email: newUser.email }, secret, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Usuario registrado con éxito',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        avatarUrl: newUser.avatarUrl,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al registrar usuario: ' + error.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Por favor ingrese email y contraseña.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas.' });
      return;
    }

    // Direct plain text password comparison as requested by user
    if (user.password !== password) {
      res.status(401).json({ error: 'Credenciales inválidas.' });
      return;
    }

    const secret = process.env.JWT_SECRET || 'classforge_super_secret_jwt_key_2026_antigravity';
    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '7d' });

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al iniciar sesión: ' + error.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Usuario no identificado.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener perfil: ' + error.message });
  }
};
