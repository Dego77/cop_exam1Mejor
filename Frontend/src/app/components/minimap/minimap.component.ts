import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UMLNode, UMLConnector } from '../../core/services/diagram.service';
import { CursorData } from '../../core/services/websocket.service';

@Component({
  selector: 'app-minimap',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="minimap-wrapper" [class.collapsed]="isCollapsed">
      <!-- Botón para mostrar u ocultar el minimapa -->
      <div class="minimap-header" (click)="isCollapsed = !isCollapsed" title="Minimapa de Navegación">
        <div class="header-title">
          <span class="minimap-icon">🗺️</span>
          <span *ngIf="!isCollapsed" class="title-text">Navegación / Radar</span>
        </div>
        <button class="toggle-btn">{{ isCollapsed ? '▲' : '▼' }}</button>
      </div>

      <!-- Cuerpo del minimapa -->
      <div
        *ngIf="!isCollapsed"
        class="minimap-body"
        #minimapBox
        [class.read-only]="readOnly"
        (click)="onMinimapClick($event)"
        (pointerdown)="onRadarPointerDown($event)"
        (pointermove)="onRadarPointerMove($event)"
        (pointerup)="isNavigating = false"
        (pointercancel)="isNavigating = false"
      >
        <svg class="minimap-svg" [attr.viewBox]="svgViewBox">
          <!-- Capa de conectores -->
          <g *ngFor="let conn of connectors">
            <line
              *ngIf="getConnectorCoords(conn) as coords"
              [attr.x1]="coords.x1"
              [attr.y1]="coords.y1"
              [attr.x2]="coords.x2"
              [attr.y2]="coords.y2"
              stroke="#00d4ff"
              stroke-width="2"
              opacity="0.6"
            />
          </g>

          <!-- Capa de nodos -->
          <rect
            *ngFor="let node of nodes"
            [attr.x]="node.positionX"
            [attr.y]="node.positionY"
            width="220"
            height="140"
            rx="8"
            fill="rgba(0, 212, 255, 0.25)"
            stroke="#00d4ff"
            stroke-width="2"
          />

          <!-- Cursores de los colaboradores remotos -->
          <circle
            *ngFor="let c of remoteCursors"
            [attr.cx]="c.cursor ? c.cursor.x : 0"
            [attr.cy]="c.cursor ? c.cursor.y : 0"
            r="14"
            [attr.fill]="(c.user && c.user.color) ? c.user.color : '#ec4899'"
            stroke="#ffffff"
            stroke-width="2"
          />


          <!-- Rectángulo de lo que se ve ahora en pantalla -->
          <rect
            [attr.x]="viewportRect.x"
            [attr.y]="viewportRect.y"
            [attr.width]="viewportRect.w"
            [attr.height]="viewportRect.h"
            fill="rgba(0, 212, 255, 0.08)"
            stroke="#00d4ff"
            stroke-width="3"
            stroke-dasharray="6 3"
            class="viewport-box"
          />
        </svg>
      </div>
    </div>
  `,
  styles: [`
    .minimap-wrapper {
      position: absolute;
      bottom: 56px;
      right: 20px;
      z-index: 100;
      background: rgba(13, 17, 26, 0.9);
      border: 1px solid rgba(0, 212, 255, 0.35);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(12px);
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      font-family: 'Inter', system-ui, sans-serif;
    }

    .minimap-wrapper.collapsed {
      width: 44px;
      height: 38px;
      border-radius: 20px;
    }

    .minimap-header {
      height: 38px;
      padding: 0 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      background: rgba(20, 25, 38, 0.8);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .minimap-header:hover {
      background: rgba(0, 212, 255, 0.1);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .minimap-icon {
      font-size: 14px;
    }
    .title-text {
      font-size: 11px;
      font-weight: 700;
      color: #00d4ff;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .toggle-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 10px;
      cursor: pointer;
    }

    .minimap-body {
      width: 210px;
      height: 140px;
      position: relative;
      cursor: crosshair;
      background: radial-gradient(circle, rgba(15, 23, 42, 0.8) 0%, rgba(7, 9, 14, 0.95) 100%);
    }
    .minimap-body.read-only {
      touch-action: none;
    }

    .minimap-svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .viewport-box {
      filter: drop-shadow(0 0 6px rgba(0, 212, 255, 0.8));
      cursor: grab;
    }
  `]
})
export class MinimapComponent {
  @Input() nodes: UMLNode[] = [];
  @Input() connectors: UMLConnector[] = [];
  @Input() remoteCursors: CursorData[] = [];
  @Input() zoomLevel: number = 1;
  // Modo Ver: la vista se mueve con panX/panY en lugar de con scroll
  @Input() readOnly: boolean = false;
  @Input() panX: number = 0;
  @Input() panY: number = 0;

  @Output() navigateTo = new EventEmitter<{ x: number; y: number }>();

  public isCollapsed: boolean = false;
  public isNavigating: boolean = false;

  get svgViewBox(): string {
    if (!this.nodes || this.nodes.length === 0) {
      return '0 0 1400 900';
    }

    let minX = Math.min(...this.nodes.map(n => n.positionX)) - 100;
    let minY = Math.min(...this.nodes.map(n => n.positionY)) - 100;
    let maxX = Math.max(...this.nodes.map(n => n.positionX + 260)) + 100;
    let maxY = Math.max(...this.nodes.map(n => n.positionY + 180)) + 100;

    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, 1400);
    maxY = Math.max(maxY, 900);

    const width = maxX - minX;
    const height = maxY - minY;

    return `${minX} ${minY} ${width} ${height}`;
  }

  get viewportRect(): { x: number; y: number; w: number; h: number } {
    const parentContainer = document.querySelector('.canvas-container');
    const vw = parentContainer ? parentContainer.clientWidth : 1200;
    const vh = parentContainer ? parentContainer.clientHeight : 800;

    const currentScrollLeft = parentContainer ? parentContainer.scrollLeft : 0;
    const currentScrollTop = parentContainer ? parentContainer.scrollTop : 0;

    if (this.readOnly) {
      return {
        x: -this.panX / this.zoomLevel,
        y: -this.panY / this.zoomLevel,
        w: vw / this.zoomLevel,
        h: vh / this.zoomLevel
      };
    }

    return {
      x: currentScrollLeft / this.zoomLevel,
      y: currentScrollTop / this.zoomLevel,
      w: vw / this.zoomLevel,
      h: vh / this.zoomLevel
    };
  }

  getConnectorCoords(conn: UMLConnector): { x1: number; y1: number; x2: number; y2: number } | null {
    const src = this.nodes.find(n => n.id === conn.sourceNodeId);
    const tgt = this.nodes.find(n => n.id === conn.targetNodeId);

    if (!src || !tgt) return null;

    return {
      x1: src.positionX + 110,
      y1: src.positionY + 70,
      x2: tgt.positionX + 110,
      y2: tgt.positionY + 70
    };
  }

  onRadarPointerDown(event: PointerEvent): void {
    if (!this.readOnly) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.isNavigating = true;
    this.navigateToPointer(event);
  }

  onRadarPointerMove(event: PointerEvent): void {
    if (this.isNavigating) this.navigateToPointer(event);
  }

  // Convierte el punto tocado a coordenadas del diagrama, respetando las bandas que deja el SVG
  private navigateToPointer(event: PointerEvent): void {
    const svg = (event.currentTarget as HTMLElement).querySelector('svg');
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    this.navigateTo.emit({ x: point.x, y: point.y });
  }

  onMinimapClick(event: MouseEvent): void {
    if (this.readOnly) return;
    const parentContainer = document.querySelector('.canvas-container');
    if (!parentContainer) return;

    const targetBox = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const clickRelX = (event.clientX - targetBox.left) / targetBox.width;
    const clickRelY = (event.clientY - targetBox.top) / targetBox.height;

    const viewBoxParts = this.svgViewBox.split(' ').map(Number);
    const vbMinX = viewBoxParts[0];
    const vbMinY = viewBoxParts[1];
    const vbW = viewBoxParts[2];
    const vbH = viewBoxParts[3];

    const targetCanvasX = vbMinX + clickRelX * vbW;
    const targetCanvasY = vbMinY + clickRelY * vbH;

    parentContainer.scrollLeft = (targetCanvasX - parentContainer.clientWidth / 2) * this.zoomLevel;
    parentContainer.scrollTop = (targetCanvasY - parentContainer.clientHeight / 2) * this.zoomLevel;
  }
}
