import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SupportAgentService } from '../../core/services/support-agent.service';

@Component({
  selector: 'app-agent-bubble',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div 
      *ngIf="isInteractiveMode && mascotTip" 
      class="mascot-bubble-container"
      [style.left.px]="posX"
      [style.top.px]="posY"
      [class.is-dragging]="isDragging"
      (mousedown)="startDrag($event)"
    >
      <div 
        class="drag-handle-avatar" 
        (click)="onAvatarClick($event)" 
        title="Arrastra para mover o haz clic para abrir la Sección de Ayuda"
      >
        <div class="avatar-icon">🤖</div>
        <span class="pulse-ring"></span>
      </div>

      <div class="mascot-tooltip" (click)="$event.stopPropagation()">
        <div class="tooltip-header">
          <span class="tooltip-title">💡 Asistente ClassForge</span>
          <button class="close-btn" (click)="dismissTip()" title="Cerrar sugerencia">✕</button>
        </div>
        <p class="tooltip-text">{{ mascotTip }}</p>
        <div class="tooltip-footer">
          <button class="action-btn" (click)="openHelp()">💬 Preguntar al Agente</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .mascot-bubble-container {
      position: fixed;
      z-index: 9999;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      user-select: none;
      font-family: 'Inter', system-ui, sans-serif;
      cursor: grab;
      transition: box-shadow 0.2s ease;
    }

    .mascot-bubble-container.is-dragging {
      cursor: grabbing !important;
      opacity: 0.9;
    }

    .drag-handle-avatar {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #00d4ff 0%, #3b82f6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0, 212, 255, 0.4);
      position: relative;
      transition: transform 0.2s ease;
      cursor: grab;
    }

    .drag-handle-avatar:hover {
      transform: scale(1.08);
      box-shadow: 0 0 24px rgba(0, 212, 255, 0.7);
    }

    .avatar-icon {
      font-size: 24px;
      line-height: 1;
    }

    .pulse-ring {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px solid #00d4ff;
      animation: pulse 2s infinite;
      pointer-events: none;
    }

    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(1.5); opacity: 0; }
    }

    .mascot-tooltip {
      background: #0f1420;
      border: 1px solid rgba(0, 212, 255, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
      max-width: 280px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(10px);
      cursor: default;
    }

    .tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .tooltip-title {
      font-size: 12px;
      font-weight: 700;
      color: #00d4ff;
    }

    .close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 12px;
      cursor: pointer;
      padding: 0 4px;
    }
    .close-btn:hover { color: #ffffff; }

    .tooltip-text {
      font-size: 12px;
      color: #e2e8f0;
      margin: 0 0 10px 0;
      line-height: 1.4;
    }

    .tooltip-footer {
      display: flex;
      justify-content: flex-end;
    }

    .action-btn {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid #00d4ff;
      border-radius: 6px;
      color: #00d4ff;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-btn:hover {
      background: #00d4ff;
      color: #000000;
    }
  `]
})
export class AgentBubbleComponent implements OnInit, OnDestroy {
  public isInteractiveMode: boolean = true;
  public mascotTip: string | null = null;
  private subs: Subscription[] = [];

  // Draggable position coordinates
  public posX: number = 280;
  public posY: number = 550;
  public isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private totalDragDistance: number = 0;

  constructor(
    private supportService: SupportAgentService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Calculate initial Y position safely
    if (typeof window !== 'undefined') {
      this.posY = Math.max(100, window.innerHeight - 130);
    }

    this.subs.push(
      this.supportService.isInteractiveMode$.subscribe(mode => {
        this.isInteractiveMode = mode;
      }),
      this.supportService.activeMascotTip$.subscribe(tip => {
        this.mascotTip = tip;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  public startDrag(event: MouseEvent): void {
    this.isDragging = true;
    this.dragStartX = event.clientX - this.posX;
    this.dragStartY = event.clientY - this.posY;
    this.totalDragDistance = 0;
    event.stopPropagation();
  }

  @HostListener('document:mousemove', ['$event'])
  public onMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const newX = event.clientX - this.dragStartX;
    const newY = event.clientY - this.dragStartY;

    this.totalDragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);

    // Screen bounds checking
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 80;

    this.posX = Math.max(10, Math.min(newX, maxX));
    this.posY = Math.max(10, Math.min(newY, maxY));
  }

  @HostListener('document:mouseup')
  public onMouseUp(): void {
    this.isDragging = false;
  }

  public onAvatarClick(event: MouseEvent): void {
    // If it was a small drag/click, navigate to help
    if (this.totalDragDistance < 6) {
      this.openHelp();
    }
  }

  public openHelp(): void {
    this.router.navigate(['/help']);
  }

  public dismissTip(): void {
    this.supportService.setMascotTip(null);
  }
}
