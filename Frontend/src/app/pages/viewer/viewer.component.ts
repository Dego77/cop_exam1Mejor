import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CanvasComponent } from '../../components/canvas/canvas.component';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../../core/services/project.service';
import { DiagramService, UMLNode, UMLConnector, CanvasLabel } from '../../core/services/diagram.service';
import { WebSocketService, CursorData, CanvasActivity } from '../../core/services/websocket.service';
import { AIAgentService, AIMessage } from '../../core/services/ai-agent.service';
import { ChatTextComponent } from '../../components/chat-text/chat-text.component';

// "Modo Ver" (app móvil): muestra el diagrama del proyecto y el chat grupal de la IA en tiempo real,
// solo lectura. No se edita ni se escribe a la IA. El servidor también ignora cualquier evento de
// edición que llegue de un socket unido en modo 'view'.
@Component({
  selector: 'app-viewer',
  standalone: true,
  imports: [CommonModule, CanvasComponent, ChatTextComponent],
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
          <select class="vh-voice-select" [value]="aiVoiceChoice" aria-label="Elegir voz de Chirp"
            (change)="setAIVoiceChoice($any($event.target).value)">
            <option value="Puck">Puck</option>
            <option value="Leda">Leda</option>
          </select>
          <button class="vh-btn" [class.active]="aiVoiceEnabled" [disabled]="!speechSynthesisSupported"
            [attr.aria-pressed]="aiVoiceEnabled" (click)="toggleAIVoice()"
            [title]="speechSynthesisSupported ? (aiVoiceEnabled ? 'Deshabilitar voz de respuestas' : 'Habilitar voz de respuestas') : 'La voz no está disponible en este navegador'">
            {{ speechSynthesisSupported ? (aiVoiceEnabled ? '🔊' : '🔇') : '×' }}
          </button>
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
          [remoteCursors]="remoteCursors"
          [readOnly]="true"
        ></app-canvas>
        <div class="viewer-activity" *ngIf="activityText">{{ activityText }}</div>
      </div>

      <!-- Chat grupal de la IA, solo lectura -->
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
            <div class="vc-text"><app-chat-text [text]="msg.content" [classNames]="classNames" [emphasizeClasses]="msg.sender === 'AI'"></app-chat-text></div>
            <img
              *ngIf="msg.mode === 'PHOTO' && msg.mediaUrl"
              [src]="msg.mediaUrl"
              class="vc-img"
              alt="Imagen enviada a la IA"
              (click)="expandedImageUrl = msg.mediaUrl"
            />
            <div class="vc-text" *ngFor="let proposal of msg.proposals">{{ proposal.label }} · {{ proposal.status === 'applied' ? 'aplicado' : (proposal.status === 'rejected' ? 'no permitido' : 'pendiente') }}</div>
          </div>
          <div class="vc-status" *ngFor="let peer of usersWaitingAI">Agente IA está respondiendo a {{ peer.fullName }}</div>
          <div class="vc-status" *ngIf="typingLabel">{{ typingLabel }}</div>
        </div>
      </aside>

      <!-- Imagen del chat en grande; se cierra tocando en cualquier parte -->
      <div class="vc-img-overlay" *ngIf="expandedImageUrl" (click)="expandedImageUrl = null">
        <img [src]="expandedImageUrl" alt="Imagen enviada a la IA" />
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      background: var(--bg-darkest);
      color: var(--text-primary);
      /* app-canvas se mide como 100vh menos este valor */
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
    .vh-voice-select {
      max-width: 82px;
      height: 32px;
      padding: 0 5px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      background: var(--bg-card);
    }
    .viewer-canvas {
      flex: 1;
      display: flex;
      min-height: 0;
      position: relative;
    }
    .viewer-activity {
      position: absolute;
      top: 8px;
      left: 12px;
      right: 12px;
      z-index: 110;
      padding: 6px 10px;
      font-size: 12px;
      text-align: center;
      color: var(--text-primary);
      background: var(--bg-panel);
      border: 1px solid var(--border-active);
      border-radius: var(--radius-md);
      pointer-events: none;
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
    .vc-img {
      display: block;
      width: 100%;
      max-width: 220px;
      max-height: 180px;
      object-fit: cover;
      margin-top: 6px;
      border-radius: 6px;
      cursor: zoom-in;
    }
    .vc-img-overlay {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.85);
    }
    .vc-img-overlay img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 6px;
    }
    .vc-status {
      font-size: 11px;
      color: var(--text-secondary);
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
  expandedImageUrl: string | null = null;
  chatMessages: AIMessage[] = [];
  aiVoiceEnabled = true;
  aiVoiceChoice: 'Puck' | 'Leda' = 'Puck';
  private spokenAIMessageIds = new Set<string>();
  private activeAIReplyAudio?: HTMLAudioElement;
  private activeAIReplyAudioUrl?: string;
  private voiceRequestVersion = 0;

  private remoteCursorsMap = new Map<string, CursorData>();
  usersWaitingAI: { userId: number; fullName: string }[] = [];
  typers: { userId: number; fullName: string }[] = [];

  get typingLabel(): string {
    if (this.typers.length === 0) return '';
    const names = this.typers.map(peer => (peer.fullName || 'Alguien').trim().split(/\s+/)[0]);
    if (names.length === 1) return `${names[0]} está escribiendo…`;
    if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
    return `${names[0]}, ${names[1]} y ${names.length - 2} más están escribiendo…`;
  }
  private typerTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private activityMessage = '';
  private activityTimer?: ReturnType<typeof setTimeout>;

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

  get classNames(): string[] {
    return this.nodes.map(node => node.name);
  }

  get onlineNames(): string {
    return this.onlineUsers.map(u => u.fullName + (u.viewOnly ? ' (viendo)' : '')).join(', ');
  }

  get remoteCursors(): CursorData[] {
    return Array.from(this.remoteCursorsMap.values());
  }

  // El aviso de la IA pensando se mantiene hasta que termina; los demás duran 4 segundos
  get activityText(): string {
    if (this.usersWaitingAI.length > 0) {
      return `🤖 La IA está respondiendo a ${this.usersWaitingAI.map(u => u.fullName).join(', ')}...`;
    }
    return this.activityMessage;
  }

  get speechSynthesisSupported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  private voicePreferenceKey(): string {
    return `classforge_ai_voice_${this.auth.currentUser?.id ?? 'default'}`;
  }

  private voiceChoicePreferenceKey(): string {
    return `${this.voicePreferenceKey()}_chirp`;
  }

  private restoreAIVoicePreference(): void {
    try {
      const preference = localStorage.getItem(this.voicePreferenceKey());
      if (preference !== null) this.aiVoiceEnabled = preference === 'true';
      const choice = localStorage.getItem(this.voiceChoicePreferenceKey());
      if (choice === 'Puck' || choice === 'Leda') this.aiVoiceChoice = choice;
    } catch { }
  }

  setAIVoiceChoice(choice: string): void {
    if (choice !== 'Puck' && choice !== 'Leda') return;
    this.aiVoiceChoice = choice;
    try { localStorage.setItem(this.voiceChoicePreferenceKey(), choice); } catch { }
    this.stopAIReplyAudio();
  }

  toggleAIVoice(): void {
    if (!this.speechSynthesisSupported) return;
    this.aiVoiceEnabled = !this.aiVoiceEnabled;
    try { localStorage.setItem(this.voicePreferenceKey(), String(this.aiVoiceEnabled)); } catch { }
    if (!this.aiVoiceEnabled) this.stopAIReplyAudio();
  }

  private speakAIReplyOnce(message: AIMessage): void {
    if (message.sender !== 'AI') return;
    const id = String(message.id || message.clientMessageId || '');
    if (id && this.spokenAIMessageIds.has(id)) return;
    if (id) {
      this.spokenAIMessageIds.add(id);
      if (this.spokenAIMessageIds.size > 250) {
        const oldest = this.spokenAIMessageIds.values().next().value;
        if (oldest) this.spokenAIMessageIds.delete(oldest);
      }
    }
    if (!this.aiVoiceEnabled || !message.content?.trim()) return;
    if (message.id) {
      const requestVersion = ++this.voiceRequestVersion;
      this.aiService.getAIMessageSpeech(message.id, this.aiVoiceChoice).subscribe({
        next: (blob) => {
          if (!this.aiVoiceEnabled || requestVersion !== this.voiceRequestVersion) return;
          this.stopAIReplyAudio();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          this.activeAIReplyAudioUrl = url;
          this.activeAIReplyAudio = audio;
          audio.onended = () => this.releaseAIReplyAudio(audio, url);
          audio.onerror = () => {
            this.releaseAIReplyAudio(audio, url);
            this.speakAIText(message.content);
          };
          void audio.play().catch(() => {
            this.releaseAIReplyAudio(audio, url);
            this.speakAIText(message.content);
          });
        },
        error: () => {
          if (this.aiVoiceEnabled && requestVersion === this.voiceRequestVersion) this.speakAIText(message.content);
        },
      });
      return;
    }
    this.speakAIText(message.content);
  }

  private speakAIText(text: string): void {
    if (!this.aiVoiceEnabled || !('speechSynthesis' in window) || !text?.trim()) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`~]/g, ''));
      utterance.lang = 'es-ES';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    } catch { }
  }

  private stopAIReplyAudio(): void {
    this.voiceRequestVersion++;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (this.activeAIReplyAudio) {
      this.activeAIReplyAudio.onended = null;
      this.activeAIReplyAudio.onerror = null;
      this.activeAIReplyAudio.pause();
      this.activeAIReplyAudio.src = '';
      this.activeAIReplyAudio = undefined;
    }
    if (this.activeAIReplyAudioUrl) {
      URL.revokeObjectURL(this.activeAIReplyAudioUrl);
      this.activeAIReplyAudioUrl = undefined;
    }
  }

  private releaseAIReplyAudio(audio: HTMLAudioElement, url: string): void {
    if (this.activeAIReplyAudio === audio) this.activeAIReplyAudio = undefined;
    if (this.activeAIReplyAudioUrl === url) this.activeAIReplyAudioUrl = undefined;
    URL.revokeObjectURL(url);
  }

  ngOnInit(): void {
    this.restoreAIVoicePreference();
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: `/view/${this.projectId}` } });
      return;
    }

    this.subs.add(this.diagramService.nodes$.subscribe(n => this.nodes = n));
    this.subs.add(this.diagramService.connectors$.subscribe(c => this.connectors = c));
    this.subs.add(this.diagramService.labels$.subscribe(l => this.labels = l));

    // getById solo responde al dueño o a un colaborador
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
    this.stopAIReplyAudio();
    clearTimeout(this.activityTimer);
    this.spokenAIMessageIds.clear();
    this.subs.unsubscribe();
    this.wsService.disconnect();
    this.diagramService.clearCanvas();
  }

  goBack(): void {
    this.router.navigate(['/view']);
  }

  // Zoom para que el diagrama entero quepa en la pantalla del teléfono (el tamaño de los nodos es estimado)
  fitToScreen(): void {
    if (!this.canvas || this.nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      const rows = (n.attributes?.length || 0) + (n.methods?.length || 0);
      minX = Math.min(minX, n.positionX || 0);
      minY = Math.min(minY, n.positionY || 0);
      maxX = Math.max(maxX, (n.positionX || 0) + (n.width || 240));
      maxY = Math.max(maxY, (n.positionY || 0) + (n.height || 80 + rows * 20));
    }
    const availableW = window.innerWidth - 16;
    const availableH = window.innerHeight - 52 - 48;
    const diagramW = maxX - minX;
    const diagramH = maxY - minY;
    const zoom = Math.min(availableW / (diagramW + 40), availableH / (diagramH + 40), 1);
    this.canvas.zoomLevel = Math.max(0.2, Math.round(zoom * 100) / 100);
    this.canvas.centerOn({ x: minX + diagramW / 2, y: minY + diagramH / 2 });
  }

  private showActivity(text: string): void {
    this.activityMessage = text;
    clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => this.activityMessage = '', 4000);
  }

  // Quita los cursores de quienes salieron de la sala
  private removeStaleCursors(users: any[]): void {
    const activeSockets = new Set(users.map(u => u.socketId));
    for (const socketId of Array.from(this.remoteCursorsMap.keys())) {
      if (!activeSockets.has(socketId)) this.remoteCursorsMap.delete(socketId);
    }
  }

  // Se llama antes de aplicar el cambio, así que this.nodes aún tiene el estado anterior
  private describeActivity(activity: CanvasActivity): void {
    const by = activity.by || 'Un usuario';
    const nodeId = activity.nodeId || activity.node?.id;
    const previous = this.nodes.find(n => n.id === nodeId);
    const name = activity.node?.name || previous?.name || 'una clase';

    switch (activity.action) {
      case 'moved':
        this.showActivity(`✏️ ${by} está moviendo ${name}`);
        break;
      case 'updated': {
        // node-updated también llega al soltar una clase; solo cuenta si cambió su contenido
        const content = (n: UMLNode) => JSON.stringify([n.name, n.attributes, n.methods]);
        if (previous && content(previous) !== content(activity.node)) {
          this.showActivity(`✏️ ${by} editó ${name}`);
        }
        break;
      }
      case 'created':
        this.showActivity(`✏️ ${by} creó la clase ${name}`);
        break;
      case 'deleted':
        this.showActivity(`✏️ ${by} eliminó la clase ${name}`);
        break;
      case 'connector-created':
        this.showActivity(`✏️ ${by} creó una relación`);
        break;
      case 'connector-updated':
        this.showActivity(`✏️ ${by} editó una relación`);
        break;
      case 'connector-deleted':
        this.showActivity(`✏️ ${by} eliminó una relación`);
        break;
    }
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

  // Solo escucha: los mismos eventos en tiempo real que aplica el editor, sin emitir cambios
  private connectRealtime(): void {
    this.wsService.connect();
    this.wsService.joinProject(this.projectId, this.auth.currentUser, 'view', this.auth.token || undefined);

    this.subs.add(this.wsService.joinDenied$.subscribe(evt => {
      if (evt?.projectId === this.projectId) this.status = 'denied';
    }));
    this.subs.add(this.wsService.roomUsers$.subscribe(users => {
      this.onlineUsers = users || [];
      this.removeStaleCursors(this.onlineUsers);
    }));
    this.subs.add(this.wsService.cursorMoved$.subscribe(data => this.remoteCursorsMap.set(data.socketId, data)));
    this.subs.add(this.wsService.activity$.subscribe(activity => this.describeActivity(activity)));
    this.subs.add(this.wsService.chatTyping$.subscribe(evt => {
      if (!evt || evt.projectId !== this.projectId || String(evt.userId) === String(this.auth.currentUser?.id)) return;
      this.typers = this.typers.filter(peer => peer.userId !== evt.userId);
      clearTimeout(this.typerTimers.get(evt.userId));
      if (!evt.active) return;
      this.typers = [...this.typers, { userId: evt.userId, fullName: evt.fullName }];
      this.typerTimers.set(evt.userId, setTimeout(() => {
        this.typers = this.typers.filter(peer => peer.userId !== evt.userId);
      }, 3000));
    }));
    this.subs.add(this.wsService.aiChatThinking$.subscribe(evt => {
      if (!evt || evt.projectId !== this.projectId) return;
      this.usersWaitingAI = this.usersWaitingAI.filter(u => u.userId !== evt.userId);
      if (evt.thinking) this.usersWaitingAI.push({ userId: evt.userId, fullName: evt.fullName });
    }));

    this.subs.add(this.wsService.nodeDragged$.subscribe(data => {
      const target = this.nodes.find(n => n.id === data.nodeId);
      if (target) {
        target.positionX = data.positionX;
        target.positionY = data.positionY;
      }
    }));
    this.subs.add(this.wsService.nodeUpdated$.subscribe(node => this.diagramService.updateLocalNode(node)));
    this.subs.add(this.wsService.nodeCreated$.subscribe(node => this.diagramService.addLocalNode(node)));
    // Borrado solo local. DiagramService.deleteNode() también mandaría un DELETE al servidor
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
    this.subs.add(this.wsService.connectorUpdated$.subscribe(({ connectorId, changes }) => {
      this.diagramService.updateLocalConnector(connectorId, changes);
    }));
    this.subs.add(this.wsService.connectorDeleted$.subscribe(connectorId => {
      (this.diagramService as any).connectorsSubject.next(this.diagramService.currentConnectors.filter(c => c.id !== connectorId));
    }));
    this.subs.add(this.wsService.diagramReloaded$.subscribe(() => this.loadDiagram()));

    this.subs.add(this.wsService.aiChatMessage$.subscribe(raw => {
      if (!raw || raw.projectId !== this.projectId) return;
      const msg = this.aiService.normalizeChatMessage(raw);
      const previous = this.chatMessages.find(m => m.id === msg.id);
      if (msg.id && previous) {
        const applied = msg.proposals?.find((p, i) => p.status === 'applied' && previous.proposals?.[i]?.status !== 'applied');
        if (applied) this.showActivity(`🤖 ${applied.decidedBy || 'Un usuario'} aplicó un cambio de la IA`);
        this.chatMessages = this.chatMessages.map(m => m.id === msg.id ? msg : m);
        this.speakAIReplyOnce(msg);
        return;
      }
      this.chatMessages = [...this.chatMessages, msg];
      this.speakAIReplyOnce(msg);
    }));
    this.subs.add(this.wsService.aiChatCleared$.subscribe(evt => {
      if (evt?.projectId === this.projectId) this.chatMessages = [];
    }));
  }
}
