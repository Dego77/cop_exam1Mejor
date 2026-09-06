import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Acceso no autorizado. Token no proporcionado.' });
    return;
  }

  const secret = process.env.JWT_SECRET || 'classforge_super_secret_jwt_key_2026_antigravity';

  jwt.verify(token, secret, (err: any, decoded: any) => {
    if (err) {
      res.status(403).json({ error: 'Token inválido o expirado.' });
      return;
    }
    req.user = decoded as { id: number; email: string };
    next();
  });
};
