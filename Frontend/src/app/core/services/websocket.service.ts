import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';

export interface CursorData {
  socketId: string;
  user: { fullName: string; color?: string };
  cursor: { x: number; y: number };
}

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket: Socket | null = null;
  private readonly serverUrl = 'http://localhost:3000';

  userJoined$ = new Subject<any>();
  userLeft$ = new Subject<string>();
  cursorMoved$ = new Subject<CursorData>();
  nodeDragged$ = new Subject<{ nodeId: string; positionX: number; positionY: number }>();
  nodeUpdated$ = new Subject<any>();
  connectorCreated$ = new Subject<any>();

  connect(): void {
    if (this.socket?.connected) return;
    this.socket = io(this.serverUrl, { transports: ['websocket'] });

    this.socket.on('user-joined', (data: any) => this.userJoined$.next(data));
    this.socket.on('user-left', (socketId: string) => this.userLeft$.next(socketId));
    this.socket.on('cursor-moved', (data: CursorData) => this.cursorMoved$.next(data));
    this.socket.on('node-dragged', (data: any) => this.nodeDragged$.next(data));
    this.socket.on('node-updated', (data: any) => this.nodeUpdated$.next(data.node));
    this.socket.on('connector-created', (data: any) => this.connectorCreated$.next(data.connector));
  }

  joinProject(projectId: string, user: any): void {
    this.socket?.emit('join-project', { projectId, user });
  }

  emitCursorMove(projectId: string, cursor: { x: number; y: number }, user: any): void {
    this.socket?.emit('cursor-move', { projectId, cursor, user });
  }

  emitNodeDragged(projectId: string, nodeId: string, positionX: number, positionY: number): void {
    this.socket?.emit('node-dragged', { projectId, nodeId, positionX, positionY });
  }

  emitNodeUpdated(projectId: string, node: any): void {
    this.socket?.emit('node-updated', { projectId, node });
  }

  emitConnectorCreated(projectId: string, connector: any): void {
    this.socket?.emit('connector-created', { projectId, connector });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
