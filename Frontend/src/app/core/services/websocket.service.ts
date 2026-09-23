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
  private readonly serverUrl = 'http://3.138.124.211:3000';

  roomUsers$ = new Subject<any[]>();
  userJoined$ = new Subject<any>();
  userLeft$ = new Subject<string>();
  cursorMoved$ = new Subject<CursorData>();
  nodeDragged$ = new Subject<{ nodeId: string; positionX: number; positionY: number }>();
  nodeUpdated$ = new Subject<any>();
  nodeCreated$ = new Subject<any>();
  nodeDeleted$ = new Subject<string>();
  connectorCreated$ = new Subject<any>();
  connectorDeleted$ = new Subject<string>();
  diagramReloaded$ = new Subject<any>();

  private activeProjectRoom: string | null = null;
  private activeUser: any = null;

  connect(): void {
    if (this.socket?.connected) return;
    this.socket = io(this.serverUrl, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      if (this.activeProjectRoom && this.activeUser) {
        this.socket?.emit('join-project', { projectId: this.activeProjectRoom, user: this.activeUser });
      }
    });

    this.socket.on('room-users', (users: any[]) => this.roomUsers$.next(users));
    this.socket.on('user-joined', (data: any) => this.userJoined$.next(data));
    this.socket.on('user-left', (socketId: string) => this.userLeft$.next(socketId));
    this.socket.on('cursor-moved', (data: CursorData) => this.cursorMoved$.next(data));
    this.socket.on('node-dragged', (data: any) => this.nodeDragged$.next(data));
    this.socket.on('node-updated', (data: any) => this.nodeUpdated$.next(data.node));
    this.socket.on('node-created', (data: any) => this.nodeCreated$.next(data.node));
    this.socket.on('node-deleted', (data: any) => this.nodeDeleted$.next(data.nodeId));
    this.socket.on('connector-created', (data: any) => this.connectorCreated$.next(data.connector));
    this.socket.on('connector-deleted', (data: any) => this.connectorDeleted$.next(data.connectorId));
    this.socket.on('diagram-reloaded', (data: any) => this.diagramReloaded$.next(data));
  }


  joinProject(projectId: string, user: any): void {
    this.activeProjectRoom = projectId;
    this.activeUser = user;
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

  emitNodeCreated(projectId: string, node: any): void {
    this.socket?.emit('node-created', { projectId, node });
  }

  emitNodeDeleted(projectId: string, nodeId: string): void {
    this.socket?.emit('node-deleted', { projectId, nodeId });
  }

  emitConnectorCreated(projectId: string, connector: any): void {
    this.socket?.emit('connector-created', { projectId, connector });
  }

  emitConnectorDeleted(projectId: string, connectorId: string): void {
    this.socket?.emit('connector-deleted', { projectId, connectorId });
  }

  emitDiagramReloaded(projectId: string, payload?: any): void {
    this.socket?.emit('diagram-reloaded', { projectId, payload });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
