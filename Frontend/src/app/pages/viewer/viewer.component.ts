import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CanvasComponent } from '../../components/canvas/canvas.component';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../../core/services/project.service';
import { DiagramService, UMLNode, UMLConnector, CanvasLabel } from '../../core/services/diagram.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { AIAgentService, AIMessage } from '../../core/services/ai-agent.service';

// "Modo Ver" (mobile app): shows a project's diagram and its AI group chat in real time,
// strictly read-only - no editing, no AI prompts. The server also ignores any edit event
// coming from a socket joined in 'view' mode.
@Component({
  selector: 'app-viewer',
  standalone: true,
  imports: [CommonModule, CanvasComponent],
  template: `
    <div class="viewer-layout">
      <header class="viewer-header">
        <button class="vh-btn" (click)="goBack()" title="Volver a proyectos">←</button>
        <div class="vh-title">
          <span class="vh-name">{{ projectName || 'Proyecto' }}</span>
          <span class="vh-badge">👁 Modo Ver</span>
        </div>
        <div class="vh-actions">
          <span class="vh-online" *ngIf="onlineUsers.length" [title]="onlineNames">
            <span class="vh-dot"></span>{{ onlineUsers.length }}
          </span>
          <button class="vh-btn" (click)="fitToScreen()" title="Ajustar a la pantalla">⤢</button>
          <button class="vh-btn" [class.active]="showChat" (click)="showChat = !showChat" title="Chat IA (solo lectura)">💬</button>
        </div>
      </header>

      <div class="viewer-state" *ngIf="status === 'loading'">Cargando diagrama...</div>
      <div class="viewer-state viewer-denied" *ngIf="status === 'denied'">
        <p>🔒 No tienes acceso a este proyecto.</p>
        <button class="vh-btn" (click)="goBack()">Volver</button>
      </div>

      <div class="viewer-canvas" *ngIf="status === 'ready'">
        <app-canvas
          [nodes]="nodes"
          [connectors]="connectors"
          [labels]="labels"
          [readOnly]="true"
        ></app-canvas>
      </div>

      <!-- Read-only AI group chat -->
      <aside class="viewer-chat" *ngIf="showChat && status === 'ready'">
        <div class="vc-header">
          <span>Chat IA del grupo · solo lectura</span>
          <button class="vh-btn" (click)="showChat = false">✕</button>
        </div>
        <div class="vc-messages">
          <div class="vc-empty" *ngIf="chatMessages.length === 0">Aún no hay mensajes en el chat.</div>
          <div class="vc-msg" *ngFor="let msg of chatMessages" [class.vc-ai]="msg.sender === 'AI'">
            <div class="vc-meta">
              <strong>{{ msg.sender === 'AI' ? 'Agente IA' : (msg.user?.fullName || 'Usuario') }}</strong>
              <span *ngIf="msg.sender === 'AI' && msg.user"> · respondiendo a {{ msg.user.fullName }}</span>
              <span class="vc-time" *ngIf="msg.timestamp">{{ msg.timestamp | date:'HH:mm' }}</span>
            </div>
            <div class="vc-text">{{ msg.content }}</div>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      background: var(--bg-darkest);
      color: var(--text-primary);
      /* app-canvas sizes itself as 100vh minus this value */
      --navbar-height: 52px;
    }
    .viewer-layout {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      overflow: hidden;
    }
    .viewer-header {
      height: var(--navbar-height);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .vh-title {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vh-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vh-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--cyan-glow);
      color: var(--cyan);
      border: 1px solid var(--border-active);
      white-space: nowrap;
    }
    .vh-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .vh-online {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .vh-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
    }
    .vh-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-primary);
      border-radius: var(--radius-md);
      min-width: 34px;
      height: 32px;
      padding: 0 8px;
      cursor: pointer;
    }
    .vh-btn.active {
      border-color: var(--cyan);
      color: var(--cyan);
    }
    .viewer-canvas {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .viewer-state {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
    }
    .viewer-denied p {
      margin-bottom: 12px;
      color: var(--text-primary);
    }
    .viewer-chat {
      position: absolute;
      right: 0;
      top: var(--navbar-height);
      bottom: 0;
      width: min(360px, 100%);
      display: flex;
      flex-direction: column;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      z-index: 100;
    }
    .vc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
    }
    .vc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .vc-empty {
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    }
    .vc-msg {
      padding: 8px 10px;
      border-radius: var(--radius-md);
      background: var(--violet);
      color: #fff;
      font-size: 12px;
    }
    .vc-msg.vc-ai {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-primary);
    }
    .vc-meta {
      font-size: 10px;
      opacity: 0.85;
      margin-bottom: 2px;
    }
    .vc-time {
      float: right;
    }
    .vc-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
  `]
})
export class ViewerComponent implements OnInit, OnDestroy {
  @ViewChild(CanvasComponent) canvas?: CanvasComponent;

  projectId = '';
  projectName = '';
  status: 'loading' | 'ready' | 'denied' = 'loading';
  nodes: UMLNode[] = [];
  connectors: UMLConnector[] = [];
  labels: CanvasLabel[] = [];
  onlineUsers: any[] = [];
  showChat = false;
  chatMessages: AIMessage[] = [];

  private subs = new Subscription();
  private hasFitted = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private projectService: ProjectService,
    private diagramService: DiagramService,
    private wsService: WebSocketService,
    private aiService: AIAgentService
  ) { }

  get onlineNames(): string {
    return this.onlineUsers.map(u => u.fullName + (u.viewOnly ? ' (viendo)' : '')).join(', ');
  }

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: `/view/${this.projectId}` } });
      return;
    }

    this.subs.add(this.diagramService.nodes$.subscribe(n => this.nodes = n));
    this.subs.add(this.diagramService.connectors$.subscribe(c => this.connectors = c));
    this.subs.add(this.diagramService.labels$.subscribe(l => this.labels = l));

    // getById only answers for the owner or a collaborator
    this.projectService.getById(this.projectId).subscribe({
      next: (project) => {
        this.projectName = project.name;
        this.loadDiagram();
        this.loadChat();
        this.connectRealtime();
      },
      error: () => this.status = 'denied'
    });
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.wsService.disconnect();
    this.diagramService.clearCanvas();
  }

  goBack(): void {
    this.router.navigate(['/view']);
  }

  // Zoom so the whole diagram fits the phone screen (node sizes are estimated)
  fitToScreen(): void {
    if (!this.canvas || this.nodes.length === 0) return;
    let maxX = 0;
    let maxY = 0;
    for (const n of this.nodes) {
      const rows = (n.attributes?.length || 0) + (n.methods?.length || 0);
      maxX = Math.max(maxX, (n.positionX || 0) + (n.width || 240));
      maxY = Math.max(maxY, (n.positionY || 0) + (n.height || 80 + rows * 20));
    }
    const availableW = window.innerWidth - 16;
    const availableH = window.innerHeight - 52 - 48;
    const zoom = Math.min(availableW / (maxX + 40), availableH / (maxY + 40), 1);
    this.canvas.zoomLevel = Math.max(0.2, Math.round(zoom * 100) / 100);
  }

  private loadDiagram(): void {
    this.diagramService.loadDiagram(this.projectId).subscribe({
      next: () => {
        this.status = 'ready';
        if (!this.hasFitted) {
          this.hasFitted = true;
          setTimeout(() => this.fitToScreen());
        }
      },
      error: () => this.status = 'ready'
    });
  }

  private loadChat(): void {
    this.aiService.getChatHistory(this.projectId).subscribe({
      next: (history) => this.chatMessages = history,
      error: () => { }
    });
  }

  // Listen-only: same realtime events the editor applies, without ever emitting changes
  private connectRealtime(): void {
    this.wsService.connect();
    this.wsService.joinProject(this.projectId, this.auth.currentUser, 'view', this.auth.token || undefined);

    this.subs.add(this.wsService.joinDenied$.subscribe(evt => {
      if (evt?.projectId === this.projectId) this.status = 'denied';
    }));
    this.subs.add(this.wsService.roomUsers$.subscribe(users => this.onlineUsers = users || []));

    this.subs.add(this.wsService.nodeDragged$.subscribe(data => {
      const target = this.nodes.find(n => n.id === data.nodeId);
      if (target) {
        target.positionX = data.positionX;
        target.positionY = data.positionY;
      }
    }));
    this.subs.add(this.wsService.nodeUpdated$.subscribe(node => this.diagramService.updateLocalNode(node)));
    this.subs.add(this.wsService.nodeCreated$.subscribe(node => this.diagramService.addLocalNode(node)));
    // Local removal only - DiagramService.deleteNode() would also send a DELETE to the server
    this.subs.add(this.wsService.nodeDeleted$.subscribe(nodeId => {
      (this.diagramService as any).nodesSubject.next(this.diagramService.currentNodes.filter(n => n.id !== nodeId));
      (this.diagramService as any).connectorsSubject.next(
        this.diagramService.currentConnectors.filter(c => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId)
      );
    }));
    this.subs.add(this.wsService.connectorCreated$.subscribe(connector => {
      const current = this.diagramService.currentConnectors;
      if (!current.some(c => c.id === connector.id)) {
        (this.diagramService as any).connectorsSubject.next([...current, connector]);
      }
    }));
    this.subs.add(this.wsService.connectorDeleted$.subscribe(connectorId => {
      (this.diagramService as any).connectorsSubject.next(this.diagramService.currentConnectors.filter(c => c.id !== connectorId));
    }));
    this.subs.add(this.wsService.diagramReloaded$.subscribe(() => this.loadDiagram()));

    this.subs.add(this.wsService.aiChatMessage$.subscribe(raw => {
      if (!raw || raw.projectId !== this.projectId) return;
      if (raw.id && this.chatMessages.some(m => m.id === raw.id)) return;
      this.chatMessages = [...this.chatMessages, this.aiService.normalizeChatMessage(raw)];
    }));
    this.subs.add(this.wsService.aiChatCleared$.subscribe(evt => {
      if (evt?.projectId === this.projectId) this.chatMessages = [];
    }));
  }
}
