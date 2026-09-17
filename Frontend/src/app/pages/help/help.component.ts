import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SupportAgentService, SupportChatMessage } from '../../core/services/support-agent.service';

interface VideoTutorial {
  id: string;
  title: string;
  category: string;
  duration: string;
  description: string;
  icon: string;
  videoUrl?: string;
  isAvailable?: boolean;
}


@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="help-container">
      <!-- HEADER -->
      <div class="help-header">
        <div class="header-left">
          <button class="back-btn" (click)="goBack()" title="Volver al Editor">
            <span>← Volver al Editor</span>
          </button>
          <span class="help-title">❓ Sección de Ayuda & Tutoría ClassForge</span>
        </div>
        <div class="header-right">
          <div class="status-pill">
            <span class="status-dot"></span>
            <span>Agente de Soporte Disponible</span>
          </div>
        </div>
      </div>

      <!-- BODY GRID -->
      <div class="help-body">
        
        <!-- LEFT COLUMN: VIDEO TUTORIALS PLACEHOLDER -->
        <div class="left-section">
          <div class="section-header">
            <div class="section-title-wrap">
              <span class="section-icon"></span>
              <h2>Video Tutoriales & Guías del Sistema</h2>
            </div>
            <p class="section-subtitle">
              Recursos audiovisuales para aprender a dominar ClassForge. (Espacio preparado para futuros video tutoriales).
            </p>
          </div>

          <!-- CATEGORY FILTERS -->
          <div class="category-chips">
            <button 
              *ngFor="let cat of categories" 
              class="chip-btn" 
              [class.active]="selectedCategory === cat"
              (click)="selectedCategory = cat">
              {{ cat }}
            </button>
          </div>

          <!-- TUTORIAL CARDS GRID -->
          <div class="tutorials-grid">
            <div 
              *ngFor="let video of filteredVideos" 
              class="tutorial-card"
              [class.playable]="video.isAvailable"
              (click)="openVideoModal(video)"
            >
              <div class="thumbnail-placeholder" [class.available-thumb]="video.isAvailable">
                <span class="play-icon" [class.active-play]="video.isAvailable">▶</span>
                <span class="duration-badge">{{ video.duration }}</span>
                <span class="coming-soon-badge" *ngIf="!video.isAvailable">Próximamente</span>
                <span class="available-badge" *ngIf="video.isAvailable">🟢 Ver Video</span>
              </div>
              <div class="card-content">
                <div class="card-tag">{{ video.category }}</div>
                <h3 class="card-title">{{ video.title }}</h3>
                <p class="card-desc">{{ video.description }}</p>
              </div>
            </div>
          </div>
        </div>


        <!-- RIGHT COLUMN: AI SUPPORT CHATBOT -->
        <div class="right-section">
          <div class="chat-card">
            
            <!-- CHAT HEADER WITH TOGGLE SWITCH -->
            <div class="chat-header">
              <div class="agent-info">
                <div class="agent-avatar">🤖</div>
                <div>
                  <h3 class="agent-name">Agente Tutor ClassForge</h3>
                  <span class="agent-subtitle">Asistente en tiempo real</span>
                </div>
              </div>

              <!-- TOGGLE SWITCH (ENCENDER / APAGAR) -->
              <div class="toggle-container">
                <span class="toggle-label" [class.active-label]="isInteractiveMode">
                  Asistencia en Pantalla: <strong>{{ isInteractiveMode ? 'ON' : 'OFF' }}</strong>
                </span>
                <label class="switch">
                  <input 
                    type="checkbox" 
                    [checked]="isInteractiveMode" 
                    (change)="toggleInteractiveMode()">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <!-- CHAT MESSAGES BODY -->
            <div class="chat-messages" #scrollContainer>
              <div 
                *ngFor="let msg of messages" 
                class="message-wrapper" 
                [class.user-wrapper]="msg.sender === 'USER'"
                [class.agent-wrapper]="msg.sender === 'AGENT'">
                
                <div class="message-avatar">
                  {{ msg.sender === 'USER' ? '👤' : '🤖' }}
                </div>

                <div class="message-bubble">
                  <p class="message-text">{{ msg.text }}</p>
                  
                  <!-- STEP GUIDE LIST IF PRESENT -->
                  <div *ngIf="msg.stepGuide && msg.stepGuide.length > 0" class="step-guide">
                    <div *ngFor="let step of msg.stepGuide" class="step-item">
                      {{ step }}
                    </div>
                  </div>

                  <!-- HIGHLIGHT ELEMENT BUTTON -->
                  <button 
                    *ngIf="msg.targetSelector && isInteractiveMode" 
                    class="highlight-action-btn"
                    (click)="highlightElement(msg.targetSelector, msg)">
                    🎯 Señalar herramienta en pantalla
                  </button>

                  <span class="message-time">
                    {{ msg.timestamp | date:'HH:mm' }}
                  </span>
                </div>
              </div>

              <!-- LOADING INDICATOR -->
              <div *ngIf="isLoading" class="message-wrapper agent-wrapper">
                <div class="message-avatar">🤖</div>
                <div class="message-bubble loading-bubble">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
              </div>
            </div>

            <!-- QUICK SUGGESTIONS CHIPS -->
            <div class="quick-chips">
              <span class="quick-title">Preguntas frecuentes:</span>
              <button 
                *ngFor="let chip of quickChips" 
                class="quick-chip-btn"
                (click)="askQuickQuestion(chip)">
                {{ chip }}
              </button>
            </div>

            <!-- CHAT INPUT FOOTER -->
            <div class="chat-footer">
              <input 
                type="text" 
                class="chat-input" 
                placeholder="Escribe tu duda sobre cómo usar el sistema..." 
                [(ngModel)]="userQuestion"
                (keyup.enter)="sendMessage()">
              <button class="send-btn" [disabled]="!userQuestion.trim() || isLoading" (click)="sendMessage()">
                <span>Enviar</span>
                <span>➔</span>
              </button>
            </div>

          </div>
        </div>

      </div>

      <!-- MODAL REPRODUCTOR DE VIDEO TUTORIAL -->
      <div class="video-modal-backdrop" *ngIf="activeVideo" (click)="closeVideoModal()">
        <div class="modal-card glass-panel video-modal-card" (click)="$event.stopPropagation()">
          <div class="ea-modal-header">
            <span>📹 {{ activeVideo.title }}</span>
            <button class="icon-btn text-muted" (click)="closeVideoModal()" style="border:none;background:none;cursor:pointer;font-size:16px;">✕</button>
          </div>

          <div class="video-player-box">
            <video 
              [src]="activeVideo.videoUrl" 
              controls 
              autoplay 
              class="html5-video-player">
              Tu navegador no soporta la reproducción de video HTML5.
            </video>
          </div>

          <div class="video-modal-footer">
            <div class="video-modal-info">
              <span class="badge-cat">{{ activeVideo.category }}</span>
              <p class="video-modal-desc">{{ activeVideo.description }}</p>
            </div>
            <button class="btn btn-ghost" (click)="closeVideoModal()">Cerrar</button>
          </div>
        </div>
      </div>
    </div>

  `,
  styles: [`
    .help-container {
      width: 100vw;
      height: 100vh;
      background-color: #07090e;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    /* HEADER */
    .help-header {
      height: 58px;
      background: #0f1420;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .back-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 16px;
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 8px;
      color: #00d4ff;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s ease;
    }
    .back-btn:hover {
      background: rgba(0, 212, 255, 0.25);
      border-color: #00d4ff;
      box-shadow: 0 0 12px rgba(0, 212, 255, 0.4);
    }
    .help-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 0.3px;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 20px;
      color: #10b981;
      font-size: 12px;
      font-weight: 600;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background-color: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
    }

    /* BODY GRID */
    .help-body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 440px;
      gap: 20px;
      padding: 20px;
      overflow: hidden;
    }

    /* LEFT SECTION: VIDEOS */
    .left-section {
      background: #0d111a;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 14px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
    }
    .section-header {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-icon {
      font-size: 24px;
    }
    .section-title-wrap h2 {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      color: #ffffff;
    }
    .section-subtitle {
      font-size: 13px;
      color: #94a3b8;
      margin: 0;
    }

    .category-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip-btn {
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      color: #cbd5e1;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .chip-btn:hover, .chip-btn.active {
      background: #00d4ff;
      border-color: #00d4ff;
      color: #000000;
      font-weight: 700;
    }

    .tutorials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 8px;
    }
    .tutorial-card {
      background: #141926;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.25 ease;
      display: flex;
      flex-direction: column;
    }
    .tutorial-card:hover {
      border-color: rgba(0, 212, 255, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    }
    .thumbnail-placeholder {
      height: 130px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .play-icon {
      width: 44px;
      height: 44px;
      background: rgba(0, 212, 255, 0.2);
      border: 1px solid #00d4ff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00d4ff;
      font-size: 16px;
      padding-left: 3px;
    }
    .duration-badge {
      position: absolute;
      bottom: 8px;
      right: 8px;
      background: rgba(0, 0, 0, 0.75);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      color: #e2e8f0;
    }
    .coming-soon-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #f59e0b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .card-content {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .card-tag {
      font-size: 11px;
      color: #00d4ff;
      font-weight: 600;
      text-transform: uppercase;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: #f8fafc;
      margin: 0;
    }
    .card-desc {
      font-size: 12px;
      color: #94a3b8;
      margin: 0;
      line-height: 1.4;
    }

    /* RIGHT SECTION: CHATBOT */
    .right-section {
      height: 100%;
      min-height: 0;
    }
    .chat-card {
      height: 100%;
      background: #0d111a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .chat-header {
      padding: 16px 20px;
      background: #141926;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .agent-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .agent-avatar {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #00d4ff 0%, #3b82f6 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 12px rgba(0, 212, 255, 0.3);
    }
    .agent-name {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
    }
    .agent-subtitle {
      font-size: 11px;
      color: #94a3b8;
    }

    /* TOGGLE SWITCH */
    .toggle-container {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    .toggle-label {
      font-size: 11px;
      color: #64748b;
    }
    .toggle-label.active-label {
      color: #00d4ff;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 42px;
      height: 22px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #334155;
      transition: .3s;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
    }
    input:checked + .slider {
      background-color: #00d4ff;
    }
    input:checked + .slider:before {
      transform: translateX(20px);
    }
    .slider.round {
      border-radius: 34px;
    }
    .slider.round:before {
      border-radius: 50%;
    }

    /* CHAT MESSAGES */
    .chat-messages {
      flex: 1;
      min-height: 0;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .chat-messages::-webkit-scrollbar { width: 5px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: #00d4ff; border-radius: 99px; }
    .message-wrapper {
      display: flex;
      gap: 10px;
      max-width: 88%;
    }
    .user-wrapper {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .agent-wrapper {
      align-self: flex-start;
    }
    .message-avatar {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .user-wrapper .message-avatar {
      background: rgba(59, 130, 246, 0.2);
    }
    .message-bubble {
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      position: relative;
    }
    .agent-wrapper .message-bubble {
      background: #182030;
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border-top-left-radius: 2px;
    }
    .user-wrapper .message-bubble {
      background: #00d4ff;
      color: #000000;
      font-weight: 500;
      border-top-right-radius: 2px;
    }
    .message-text {
      margin: 0;
      white-space: pre-wrap;
    }
    .message-time {
      display: block;
      font-size: 10px;
      opacity: 0.6;
      margin-top: 6px;
      text-align: right;
    }
    .step-guide {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: rgba(0, 0, 0, 0.2);
      padding: 8px 10px;
      border-radius: 6px;
    }
    .step-item {
      font-size: 12px;
      color: #38bdf8;
    }
    .highlight-action-btn {
      margin-top: 10px;
      padding: 6px 12px;
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid #00d4ff;
      border-radius: 6px;
      color: #00d4ff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .highlight-action-btn:hover {
      background: #00d4ff;
      color: #000;
    }

    /* TYPING INDICATOR */
    .loading-bubble {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 14px 18px;
    }
    .typing-dot {
      width: 6px;
      height: 6px;
      background: #00d4ff;
      border-radius: 50%;
      animation: blink 1.4s infinite ease-in-out both;
    }
    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes blink {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.2); }
    }

    /* QUICK CHIPS */
    .quick-chips {
      padding: 8px 16px;
      background: #101624;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .quick-title {
      font-size: 11px;
      color: #64748b;
      width: 100%;
    }
    .quick-chip-btn {
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      color: #94a3b8;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .quick-chip-btn:hover {
      background: rgba(0, 212, 255, 0.1);
      border-color: #00d4ff;
      color: #00d4ff;
    }

    /* FOOTER */
    .chat-footer {
      padding: 12px 16px;
      background: #141926;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 10px;
    }
    .chat-input {
      flex: 1;
      background: #0d111a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 10px 14px;
      color: #ffffff;
      font-size: 13px;
      outline: none;
    }
    .chat-input:focus {
      border-color: #00d4ff;
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.2);
    }
    .send-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 16px;
      background: #00d4ff;
      border: none;
      border-radius: 8px;
      color: #000000;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .send-btn:hover:not(:disabled) {
      background: #38bdf8;
      box-shadow: 0 0 12px rgba(0, 212, 255, 0.5);
    }
    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `]
})
export class HelpComponent implements OnInit, OnDestroy {
  public userQuestion: string = '';
  public isLoading: boolean = false;
  public isInteractiveMode: boolean = true;
  public messages: SupportChatMessage[] = [];
  private sub!: Subscription;

  public categories: string[] = ['Todos', 'Primeros Pasos', 'Diagramas UML', 'Exportar SQL/XMI', 'Colaboración'];
  public selectedCategory: string = 'Todos';

  public quickChips: string[] = [
    '¿Cómo crear mi primer proyecto?',
    '¿Cómo exportar a código SQL?',
    '¿Cómo conectar dos clases?',
    '¿Cómo invitar a mi equipo?'
  ];

  public videos: VideoTutorial[] = [
    {
      id: '1',
      title: 'Primeros Pasos & Iniciar Sesión',
      category: 'Primeros Pasos',
      duration: '00:18',
      description: 'Aprende a crear tu espacio de trabajo, navegar por la interfaz e iniciar sesión.',
      icon: '▶',
      videoUrl: '/assets/videos/Iniciar%20sesion.mp4',
      isAvailable: true
    },
    {
      id: '2',
      title: 'Crear Nuevo Proyecto',
      category: 'Primeros Pasos',
      duration: '00:21',
      description: 'Guía rápida para crear, guardar y gestionar espacios de trabajo para diagramas UML.',
      icon: '▶',
      videoUrl: '/assets/videos/crearProyecto.mp4',
      isAvailable: true
    },
    {
      id: '3',
      title: 'Modelado UML: Crear Clase con Atributos',
      category: 'Diagramas UML',
      duration: '00:55',
      description: 'Guía paso a paso para crear clases en el Canvas, definir atributos, tipos de datos y visibilidad.',
      icon: '▶',
      videoUrl: '/assets/videos/crear_Clasecon_atributos.mp4',
      isAvailable: true
    },
    {
      id: '4',
      title: 'Colaboración y Sesiones en Vivo',
      category: 'Colaboración',
      duration: '00:22',
      description: 'Cómo invitar a otros desarrolladores y sincronizar cambios en tiempo real mediante WebSockets.',
      icon: '▶',
      videoUrl: '/assets/videos/InvitarColaborador.mp4',
      isAvailable: true
    },
    {
      id: '5',
      title: 'Generar Código SQL DDL & XMI',
      category: 'Exportar SQL/XMI',
      duration: '04:10',
      description: 'Convierte tus diagramas de clases en scripts de base de datos relacional PostgreSQL con un clic.',
      icon: '▶',
      isAvailable: false
    }
  ];


  activeVideo: VideoTutorial | null = null;


  @ViewChild('scrollContainer') private scrollContainer?: ElementRef;

  constructor(
    private router: Router,
    private supportService: SupportAgentService
  ) { }

  ngOnInit(): void {
    this.sub = this.supportService.chatHistory$.subscribe(history => {
      this.messages = history;
      setTimeout(() => this.scrollToBottom(), 50);
    });

    this.supportService.isInteractiveMode$.subscribe(mode => {
      this.isInteractiveMode = mode;
    });
  }

  ngOnDestroy(): void {
    if (this.sub) this.sub.unsubscribe();
  }

  private scrollToBottom(): void {
    try {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
      }
    } catch (_) { }
  }

  get filteredVideos(): VideoTutorial[] {
    if (this.selectedCategory === 'Todos') return this.videos;
    return this.videos.filter(v => v.category === this.selectedCategory);
  }

  goBack(): void {
    this.router.navigate(['/editor']);
  }

  toggleInteractiveMode(): void {
    this.supportService.toggleInteractiveMode();
  }

  sendMessage(): void {
    if (!this.userQuestion.trim() || this.isLoading) return;

    const q = this.userQuestion.trim();
    this.userQuestion = '';
    this.isLoading = true;

    this.supportService.askAgent(q).subscribe({
      next: () => {
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  askQuickQuestion(question: string): void {
    this.userQuestion = question;
    this.sendMessage();
  }

  highlightElement(selector: string, msg?: SupportChatMessage): void {
    this.supportService.setHighlight(selector);
    if (msg) {
      const tipText = msg.stepGuide?.[0] || msg.text;
      this.supportService.setMascotTip(`🎯 ${tipText}`);
    } else {
      this.supportService.setMascotTip(`🎯 ¡Aquí está la herramienta que necesitas!`);
    }
    this.router.navigate(['/editor']);
  }

  openVideoModal(video: VideoTutorial): void {
    if (video.isAvailable && video.videoUrl) {
      this.activeVideo = video;
    }
  }

  closeVideoModal(): void {
    this.activeVideo = null;
  }
}

