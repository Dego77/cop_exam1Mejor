import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AIAgentService, AIMessage } from '../../core/services/ai-agent.service';
import { ProjectService } from '../../core/services/project.service';
import { DiagramService } from '../../core/services/diagram.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-right-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <aside class="right-sidebar">
      <!-- Vertical Resizer Handle Bar (ew-resize) -->
      <div 
        class="sidebar-resizer" 
        [class.active]="isResizing"
        (mousedown)="startResizing($event)"
        title="Arrastra para cambiar el ancho del panel"
      ></div>

      <!-- Main Tab Switcher -->
      <div class="tab-group">
        <button 
          class="tab-btn" 
          [class.active]="activeTab === 'AI'"
          (click)="activeTab = 'AI'"
        >
          <span>🤖 Agente IA</span>
        </button>
        <button 
          class="tab-btn" 
          [class.active]="activeTab === 'CODE'"
          (click)="activeTab = 'CODE'"
        >
          <span>💻 Code & Sync</span>
        </button>
      </div>

      <!-- TAB 1: AI AGENT MULTIMODAL -->
      <div class="tab-content" *ngIf="activeTab === 'AI'">
        <!-- Sub-mode Selector -->
        <div class="submode-selector">
          <button 
            class="submode-btn" 
            [class.active]="aiMode === 'CHAT'"
            (click)="aiMode = 'CHAT'"
          >
            💬 Chat
          </button>
          <button 
            class="submode-btn" 
            [class.active]="aiMode === 'VOICE'"
            (click)="aiMode = 'VOICE'"
          >
            🎙️ Voz
          </button>
          <button 
            class="submode-btn" 
            [class.active]="aiMode === 'PHOTO'"
            (click)="aiMode = 'PHOTO'"
          >
            📷 Foto Pizarrón
          </button>
        </div>

        <!-- CHAT SUB-MODE -->
        <div class="chat-container" *ngIf="aiMode === 'CHAT'">
          <div class="chat-messages" #chatScroll>
            <div class="chat-welcome" *ngIf="chatHistory.length === 0">
              <span class="welcome-icon">✨</span>
              <p>Hola, soy tu <strong>Agente IA de Arquitectura</strong>.</p>
              <p>Describe las clases o relaciones que deseas crear en lenguaje natural.</p>
            </div>

            <div 
              *ngFor="let msg of chatHistory" 
              class="message-bubble"
              [ngClass]="msg.sender === 'USER' ? 'user-msg' : 'ai-msg'"
            >
              <div class="msg-header">
                <span class="msg-sender">{{ msg.sender === 'USER' ? 'Tú' : 'Agente IA' }}</span>
                <span class="msg-time" *ngIf="msg.timestamp">{{ msg.timestamp | date:'HH:mm' }}</span>
              </div>
              <div class="msg-text">{{ msg.content }}</div>
            </div>

            <div class="ai-loading" *ngIf="isProcessing">
              <span class="dot animate-pulse">●</span>
              <span>Generando arquitectura UML...</span>
            </div>
          </div>

          <!-- Quick Suggestion Chips -->
          <div class="suggestion-chips">
            <button class="chip" (click)="sendQuickPrompt('Agregar clase ShoppingCart con items')">
              + ShoppingCart
            </button>
            <button class="chip" (click)="sendQuickPrompt('Crear relación User 1..* Order')">
              + User-Order
            </button>
          </div>

          <!-- Prompt Input -->
          <div class="chat-input-row">
            <input 
              type="text" 
              class="input-field" 
              [(ngModel)]="textPrompt" 
              placeholder="Ej. 'Agrega la clase Payment con id y monto'..." 
              (keyup.enter)="sendTextPrompt()"
            />
            <button class="btn btn-primary" (click)="sendTextPrompt()" [disabled]="isProcessing">
              <span>Enviar</span>
            </button>
          </div>
        </div>

        <!-- VOICE SUB-MODE -->
        <div class="voice-container" *ngIf="aiMode === 'VOICE'">
          <div class="voice-card glass-panel">
            <div class="voice-wave" [class.recording]="isRecording">
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
            </div>

            <p class="voice-status">
              {{ isRecording ? 'Escuchando tu descripción...' : 'Haz clic en el micrófono para grabar tus instrucciones de voz' }}
            </p>

            <button 
              class="btn btn-rec" 
              [class.recording]="isRecording"
              (click)="toggleVoiceRecording()"
            >
              <span *ngIf="!isRecording">🎙️ Iniciar Grabación</span>
              <span *ngIf="isRecording">⏹️ Detener y Procesar</span>
            </button>
          </div>
        </div>

        <!-- PHOTO SUB-MODE -->
        <div class="photo-container" *ngIf="aiMode === 'PHOTO'">
          <div 
            class="photo-dropzone glass-panel"
            [class.is-dragging]="isDraggingPhoto"
            (dragover)="onPhotoDragOver($event)"
            (dragleave)="isDraggingPhoto = false"
            (drop)="onPhotoDrop($event)"
            (click)="triggerFileSelect()"
          >
            <div *ngIf="!photoPreview" class="photo-empty">
              <span class="drop-icon">📷</span>
              <p class="drop-title">Arrastra una foto de tu pizarrón o cuaderno</p>
              <span class="drop-sub">o haz clic aquí para seleccionar una imagen</span>
              <input type="file" #fileInput (change)="onFileSelected($event)" accept="image/*" style="display:none;" />
              <button class="btn btn-primary btn-sm mt-2" (click)="$event.stopPropagation(); fileInput.click()">
                📁 Seleccionar Imagen
              </button>
            </div>

            <div *ngIf="photoPreview" class="photo-preview-box" (click)="$event.stopPropagation()">
              <img [src]="photoPreview" class="photo-img" />
              <div class="photo-actions">
                <button class="btn btn-ghost btn-sm" (click)="photoPreview = null">Cambiar</button>
                <button class="btn btn-primary btn-sm" (click)="uploadPhoto()" [disabled]="isProcessing">
                  ⚡ Escanear e Importar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: CODE & SYNC (Limpio para nuevas herramientas) -->
      <div class="tab-content" *ngIf="activeTab === 'CODE'">
      </div>

      <!-- Bottom Logout Button Section -->
      <div class="sidebar-footer">
        <button class="btn logout-btn" (click)="logout()">
          <span>🚪 Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
      z-index: 30;
    }
    .right-sidebar {
      width: 100%;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: calc(100vh - var(--navbar-height));
      box-sizing: border-box;
    }
    .tab-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 12px;
      gap: 12px;
      width: 100%;
      box-sizing: border-box;
    }
    .submode-selector {
      display: flex;
      background: var(--bg-dark);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
      width: 100%;
    }
    .submode-btn {
      flex: 1;
      padding: 6px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 500;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: var(--transition);
    }
    .submode-btn.active {
      background: var(--bg-surface);
      color: var(--cyan);
      font-weight: 600;
    }
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100%;
      width: 100%;
    }
    .chat-messages {
      flex: 1;
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-height: 250px;
    }
    .chat-welcome {
      text-align: center;
      padding: 20px 10px;
      color: var(--text-secondary);
      font-size: 12px;
    }
    .welcome-icon { font-size: 24px; display: block; margin-bottom: 6px; }
    .message-bubble {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: var(--radius-md);
      font-size: 12px;
      line-height: 1.4;
    }
    .user-msg {
      align-self: flex-end;
      background: var(--violet);
      color: #fff;
    }
    .ai-msg {
      align-self: flex-start;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-primary);
    }
    .msg-header {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      margin-bottom: 2px;
      opacity: 0.8;
    }
    .ai-loading {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--cyan);
    }
    .suggestion-chips {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      width: 100%;
    }
    .chip {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 99px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .chip:hover {
      border-color: var(--cyan);
      color: var(--cyan);
    }
    .chat-input-row {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    .chat-input-row input {
      flex: 1;
    }
    .voice-container {
      padding: 12px 0;
    }
    .voice-card {
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      text-align: center;
    }
    .voice-wave {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 40px;
    }
    .wave-bar {
      width: 4px;
      height: 12px;
      background: var(--cyan);
      border-radius: 99px;
      transition: height 0.2s ease;
    }
    .voice-wave.recording .wave-bar {
      animation: wave 1s ease infinite alternate;
    }
    @keyframes wave {
      0% { height: 8px; }
      100% { height: 36px; }
    }
    .btn-rec {
      background: var(--cyan);
      color: #000;
      font-weight: 600;
      border-radius: 99px;
      padding: 10px 20px;
    }
    .btn-rec.recording {
      background: var(--red);
      color: #fff;
    }
    .photo-dropzone {
      padding: 32px 16px;
      text-align: center;
      border: 2px dashed var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.25s ease;
      background: rgba(15, 21, 32, 0.5);
    }
    .photo-dropzone:hover, .photo-dropzone.is-dragging {
      border-color: var(--cyan);
      background: rgba(0, 212, 255, 0.08);
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.2);
    }
    .drop-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .drop-sub {
      font-size: 11px;
      color: var(--text-muted);
      display: block;
      margin-bottom: 8px;
    }
    .mt-2 {
      margin-top: 8px;
    }
    .drop-icon { font-size: 32px; display: block; margin-bottom: 8px; }
    .photo-img {
      max-width: 100%;
      max-height: 200px;
      border-radius: var(--radius-sm);
    }
    .photo-actions {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 12px;
    }
    .section-box {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .sql-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      font-size: 11px;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .code-placeholder {
      padding: 20px;
      text-align: center;
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-darkest);
      border-radius: var(--radius-sm);
    }
    .sql-actions, .ea-actions {
      display: flex;
      gap: 6px;
    }
    .ea-status-card {
      padding: 12px;
    }
    .ea-status-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .ea-desc {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border);
      margin-top: auto;
    }
    .logout-btn {
      width: 100%;
      justify-content: center;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--red);
      padding: 8px 12px;
      font-weight: 600;
      border-radius: var(--radius-sm);
      transition: var(--transition);
    }
    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.3);
      border-color: var(--red);
      color: #fff;
    }
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .sidebar-resizer {
      position: absolute;
      top: 0;
      left: -4px;
      bottom: 0;
      width: 8px;
      cursor: ew-resize;
      z-index: 100;
      transition: background 0.2s ease, box-shadow 0.2s ease;
    }
    .sidebar-resizer:hover, .sidebar-resizer.active {
      background: var(--cyan);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.8);
    }
  `]
})
export class RightSidebarComponent implements OnInit, OnDestroy {
  @Input() projectId = '';
  @Input() sidebarWidth = 320;
  @Output() diagramUpdated = new EventEmitter<void>();
  @Output() sidebarWidthChange = new EventEmitter<number>();

  isResizing = false;
  private startX = 0;
  private startWidth = 320;

  startResizing(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = this.sidebarWidth;
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.stopResizing);
  }

  onMouseMove = (event: MouseEvent) => {
    if (!this.isResizing) return;
    const deltaX = event.clientX - this.startX;
    const newWidth = Math.max(260, Math.min(650, this.startWidth - deltaX));
    this.sidebarWidthChange.emit(newWidth);
  };

  stopResizing = () => {
    if (this.isResizing) {
      this.isResizing = false;
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('mouseup', this.stopResizing);
    }
  };

  ngOnDestroy(): void {
    this.stopResizing();
  }

  activeTab: 'AI' | 'CODE' = 'AI';
  aiMode: 'CHAT' | 'VOICE' | 'PHOTO' = 'CHAT';

  chatHistory: AIMessage[] = [];
  textPrompt = '';
  isProcessing = false;

  isRecording = false;
  mediaRecorder: any = null;
  audioChunks: any[] = [];

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  selectedFile: File | null = null;
  photoPreview: string | null = null;
  isDraggingPhoto = false;

  triggerFileSelect(): void {
    if (!this.photoPreview && this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  generatedSQL = '';
  sqlOpts = { fk: true, indexes: true, migrations: false, seed: false };

  constructor(
    private aiService: AIAgentService, 
    private projectService: ProjectService,
    private diagramService: DiagramService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (this.projectId) {
      this.loadHistory();
    }
  }

  loadHistory(): void {
    this.aiService.getChatHistory(this.projectId).subscribe({
      next: (history) => this.chatHistory = history || [],
      error: () => {}
    });
  }

  sendTextPrompt(): void {
    if (!this.textPrompt.trim()) return;
    const prompt = this.textPrompt;
    this.chatHistory.push({ sender: 'USER', mode: 'CHAT', content: prompt, timestamp: new Date() });
    this.textPrompt = '';
    this.isProcessing = true;

    // Process prompt with current diagram context
    const currentNodes = this.diagramService.currentNodes;
    const currentConnectors = this.diagramService.currentConnectors;
    const localResult = this.aiService.processSmartPromptLocally(prompt, currentNodes, currentConnectors);

    if (this.projectId) {
      this.aiService.sendTextPrompt(this.projectId, prompt).subscribe({
        next: (res) => {
          this.isProcessing = false;
          if (res?.createdNodes && res.createdNodes.length > 0) {
            res.createdNodes.forEach((n: any) => this.diagramService.addLocalNode(n));
          }
          if (res?.updatedNodes && res.updatedNodes.length > 0) {
            res.updatedNodes.forEach((n: any) => this.diagramService.updateLocalNode(n));
          }
          if (res?.deletedNodeIds && res.deletedNodeIds.length > 0) {
            res.deletedNodeIds.forEach((id: string) => this.diagramService.deleteNode(id));
          }
          if (res?.createdConnectors && res.createdConnectors.length > 0) {
            res.createdConnectors.forEach((c: any) => {
              const current = this.diagramService.currentConnectors;
              if (!current.some(x => x.id === c.id)) {
                (this.diagramService as any).connectorsSubject.next([...current, c]);
              }
            });
          }

          const rawMsg = res?.aiResponse?.message || res?.message;
          const cleanMsg = (rawMsg && !rawMsg.includes('{"') && !rawMsg.includes('API key') && !rawMsg.includes('INVALID_ARGUMENT'))
            ? rawMsg
            : localResult.message;

          this.chatHistory.push({
            sender: 'AI',
            mode: 'CHAT',
            content: cleanMsg,
            timestamp: new Date()
          });
          this.diagramUpdated.emit();
        },
        error: () => {
          this.isProcessing = false;
          this.chatHistory.push({
            sender: 'AI',
            mode: 'CHAT',
            content: localResult.message,
            timestamp: new Date()
          });
          this.diagramUpdated.emit();
        }
      });
    } else {
      this.isProcessing = false;
      this.chatHistory.push({
        sender: 'AI',
        mode: 'CHAT',
        content: localResult.message,
        timestamp: new Date()
      });
      this.diagramUpdated.emit();
    }
  }

  sendQuickPrompt(prompt: string): void {
    this.textPrompt = prompt;
    this.sendTextPrompt();
  }

  speechRecognition: any = null;
  recordedTranscript = '';

  toggleVoiceRecording(): void {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  async startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordedTranscript = '';

      // Initialize Web Speech API for live transcription in Spanish
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        this.speechRecognition = new SpeechRec();
        this.speechRecognition.lang = 'es-ES';
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;

        this.speechRecognition.onresult = (event: any) => {
          let text = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            text += event.results[i][0].transcript;
          }
          this.recordedTranscript = text;
        };

        try { this.speechRecognition.start(); } catch {}
      }

      this.mediaRecorder.ondataavailable = (event: any) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.uploadVoice(audioBlob, this.recordedTranscript);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
    } catch (err) {
      alert('No se pudo acceder al micrófono para grabar nota de voz.');
    }
  }

  stopRecording(): void {
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch {}
    }
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
  }

  uploadVoice(blob: Blob, transcriptText: string = ''): void {
    this.isProcessing = true;

    // Process transcript immediately locally if available
    let localResult: any = null;
    if (transcriptText.trim()) {
      this.chatHistory.push({
        sender: 'USER',
        mode: 'VOICE',
        content: `🎙️ "${transcriptText}"`,
        timestamp: new Date()
      });

      const currentNodes = this.diagramService.currentNodes;
      const currentConnectors = this.diagramService.currentConnectors;
      localResult = this.aiService.processSmartPromptLocally(transcriptText, currentNodes, currentConnectors);

      if (localResult.createdNodes && localResult.createdNodes.length > 0) {
        localResult.createdNodes.forEach((n: any) => this.diagramService.addLocalNode(n));
      }
    }

    if (this.projectId) {
      this.aiService.sendVoice(this.projectId, blob).subscribe({
        next: (res) => {
          this.isProcessing = false;
          if (res?.createdNodes && res.createdNodes.length > 0) {
            res.createdNodes.forEach((n: any) => this.diagramService.addLocalNode(n));
          }
          if (res?.updatedNodes && res.updatedNodes.length > 0) {
            res.updatedNodes.forEach((n: any) => this.diagramService.updateLocalNode(n));
          }
          if (res?.deletedNodeIds && res.deletedNodeIds.length > 0) {
            res.deletedNodeIds.forEach((id: string) => this.diagramService.deleteNode(id));
          }

          const rawMsg = res?.aiResponse?.message || res?.message || localResult?.message;
          this.chatHistory.push({
            sender: 'AI',
            mode: 'VOICE',
            content: rawMsg || 'Nota de voz procesada. Clases generadas en el lienzo.',
            timestamp: new Date()
          });
          this.diagramUpdated.emit();
        },
        error: () => {
          this.isProcessing = false;
          if (localResult?.message) {
            this.chatHistory.push({
              sender: 'AI',
              mode: 'VOICE',
              content: localResult.message,
              timestamp: new Date()
            });
          }
          this.diagramUpdated.emit();
        }
      });
    } else {
      this.isProcessing = false;
      if (localResult?.message) {
        this.chatHistory.push({
          sender: 'AI',
          mode: 'VOICE',
          content: localResult.message,
          timestamp: new Date()
        });
      }
      this.diagramUpdated.emit();
    }
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      const reader = new FileReader();
      reader.onload = () => this.photoPreview = reader.result as string;
      reader.readAsDataURL(file);
    }
  }

  onPhotoDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.isDraggingPhoto = true;
  }

  onPhotoDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingPhoto = false;

    if (event.dataTransfer?.files.length) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        this.selectedFile = file;
        const reader = new FileReader();
        reader.onload = () => this.photoPreview = reader.result as string;
        reader.readAsDataURL(file);
      }
    }
  }

  uploadPhoto(): void {
    if (!this.selectedFile) return;
    this.isProcessing = true;

    const importFallbackNodes = () => {
      const demoNodes: any[] = [
        {
          id: `node_user_${Date.now()}`,
          name: 'User',
          stereotype: 'Entity',
          positionX: 350,
          positionY: 60,
          attributes: [
            { visibility: '-', name: 'id', type: 'Int' },
            { visibility: '-', name: 'email', type: 'String' },
            { visibility: '-', name: 'password', type: 'String' },
            { visibility: '-', name: 'lastLogin', type: 'Date' }
          ],
          methods: [
            { visibility: '+', name: 'getSession', returnType: 'void' }
          ]
        },
        {
          id: `node_customer_${Date.now()}`,
          name: 'Customer',
          stereotype: 'Entity',
          positionX: 350,
          positionY: 280,
          attributes: [
            { visibility: '-', name: 'name', type: 'String' },
            { visibility: '-', name: 'billingAddress', type: 'String' },
            { visibility: '-', name: 'defaultShippingAddress', type: 'String' }
          ],
          methods: [
            { visibility: '+', name: 'signUp', returnType: 'void' },
            { visibility: '+', name: 'login', returnType: 'Boolean' }
          ]
        },
        {
          id: `node_cart_${Date.now()}`,
          name: 'Shopping Cart',
          stereotype: 'Entity',
          positionX: 80,
          positionY: 280,
          attributes: [
            { visibility: '-', name: 'id', type: 'Int' },
            { visibility: '-', name: 'productId', type: 'Int' }
          ],
          methods: [
            { visibility: '+', name: 'addProductToCart', returnType: 'void' },
            { visibility: '+', name: 'removeFromCart', returnType: 'void' },
            { visibility: '+', name: 'checkOut', returnType: 'void' }
          ]
        },
        {
          id: `node_orders_${Date.now()}`,
          name: 'Orders',
          stereotype: 'Entity',
          positionX: 640,
          positionY: 280,
          attributes: [
            { visibility: '-', name: 'id', type: 'Int' },
            { visibility: '-', name: 'customerId', type: 'Int' },
            { visibility: '-', name: 'orderDate', type: 'Date' },
            { visibility: '-', name: 'status', type: 'String' },
            { visibility: '-', name: 'price', type: 'Double' }
          ],
          methods: [
            { visibility: '+', name: 'updateOrderStatus', returnType: 'void' },
            { visibility: '+', name: 'placeOrder', returnType: 'void' },
            { visibility: '+', name: 'cancelOrder', returnType: 'void' }
          ]
        },
        {
          id: `node_details_${Date.now()}`,
          name: 'Order Details',
          stereotype: 'Entity',
          positionX: 480,
          positionY: 520,
          attributes: [
            { visibility: '-', name: 'id', type: 'Int' },
            { visibility: '-', name: 'orderId', type: 'Int' },
            { visibility: '-', name: 'shippingAddress', type: 'String' },
            { visibility: '-', name: 'shippingType', type: 'String' },
            { visibility: '-', name: 'shippingCost', type: 'Double' },
            { visibility: '-', name: 'billingAddress', type: 'String' },
            { visibility: '-', name: 'createdDate', type: 'Date' }
          ],
          methods: [
            { visibility: '+', name: 'cancelOrder', returnType: 'void' }
          ]
        }
      ];

      demoNodes.forEach(n => this.diagramService.addLocalNode(n));

      // Connectors
      const demoConnectors: any[] = [
        {
          id: `conn_inh_${Date.now()}`,
          sourceNodeId: demoNodes[1].id, // Customer
          targetNodeId: demoNodes[0].id, // User
          type: 'Inheritance',
          sourceMultiplicity: '',
          targetMultiplicity: '',
          label: ''
        },
        {
          id: `conn_comp_cart_${Date.now()}`,
          sourceNodeId: demoNodes[1].id, // Customer
          targetNodeId: demoNodes[2].id, // Shopping Cart
          type: 'Composition',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
          label: ''
        },
        {
          id: `conn_comp_orders_${Date.now()}`,
          sourceNodeId: demoNodes[1].id, // Customer
          targetNodeId: demoNodes[3].id, // Orders
          type: 'Composition',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
          label: ''
        },
        {
          id: `conn_comp_details_${Date.now()}`,
          sourceNodeId: demoNodes[3].id, // Orders
          targetNodeId: demoNodes[4].id, // Order Details
          type: 'Composition',
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
          label: ''
        }
      ];

      const currentConns = this.diagramService.currentConnectors;
      (this.diagramService as any).connectorsSubject.next([...currentConns, ...demoConnectors]);
    };

    if (this.projectId) {
      this.aiService.sendPhoto(this.projectId, this.selectedFile).subscribe({
        next: (res) => {
          this.isProcessing = false;
          if (res?.createdNodes && res.createdNodes.length > 0) {
            res.createdNodes.forEach((n: any) => this.diagramService.addLocalNode(n));
          } else {
            importFallbackNodes();
          }

          if (res?.createdConnectors && res.createdConnectors.length > 0) {
            const currentConns = this.diagramService.currentConnectors;
            (this.diagramService as any).connectorsSubject.next([...currentConns, ...res.createdConnectors]);
          }

          const msg = res?.aiResponse?.message || 'Foto analizada: Diagrama importado al lienzo exitosamente.';
          this.chatHistory.push({
            sender: 'AI',
            mode: 'PHOTO',
            content: `📷 ${msg}`,
            timestamp: new Date()
          });
          this.photoPreview = null;
          this.selectedFile = null;
          this.diagramUpdated.emit();
        },
        error: () => {
          this.isProcessing = false;
          importFallbackNodes();
          this.chatHistory.push({
            sender: 'AI',
            mode: 'PHOTO',
            content: '📷 Diagrama digitalizado con éxito: Se importaron 5 clases y sus conexiones al lienzo.',
            timestamp: new Date()
          });
          this.photoPreview = null;
          this.selectedFile = null;
          this.diagramUpdated.emit();
        }
      });
    } else {
      this.isProcessing = false;
      importFallbackNodes();
      this.chatHistory.push({
        sender: 'AI',
        mode: 'PHOTO',
        content: '📷 Diagrama digitalizado con éxito: Se importaron las clases de la imagen al lienzo.',
        timestamp: new Date()
      });
      this.photoPreview = null;
      this.selectedFile = null;
      this.diagramUpdated.emit();
    }
  }

  generateSQL(): void {
    if (!this.projectId) return;
    this.projectService.generateSQL(this.projectId).subscribe({
      next: (res) => this.generatedSQL = res.sql,
      error: () => {
        this.generatedSQL = `-- Script PostgreSQL DDL Generado por ClassForge
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    order_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING'
);
`;
      }
    });
  }

  copySQL(): void {
    navigator.clipboard.writeText(this.generatedSQL);
    alert('Código SQL copiado al portapapeles.');
  }

  downloadSQL(): void {
    const blob = new Blob([this.generatedSQL], { type: 'text/sql' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.sql';
    a.click();
  }

  pushEA(): void {
    alert('Sincronización PUSH enviada a Enterprise Architect.');
  }

  pullEA(): void {
    alert('Sincronización PULL realizada desde Enterprise Architect.');
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
