import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import diagramRoutes from './routes/diagram.routes';
import aiRoutes from './routes/ai.routes';
import sqlRoutes from './routes/sql.routes';
import architectRoutes from './routes/architect.routes';
import { setupCollaborationSockets } from './sockets/collaboration.socket';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// HTTP Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// REST API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/diagrams', diagramRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sql', sqlRoutes);
app.use('/api/architect', architectRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ClassForge Backend API',
    timestamp: new Date().toISOString(),
  });
});

// Socket.io Realtime Server Setup
setupCollaborationSockets(io);

const PORT = process.env.PORT || 3000;

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Servidor ClassForge Backend corriendo en puerto ${PORT}`);
  console.log(`🔗 API REST: http://3.138.124.211:${PORT}/api`);
  console.log(`⚡ Sockets en vivo: ws://3.138.124.211:${PORT}`);
  console.log(`=======================================================`);
});
