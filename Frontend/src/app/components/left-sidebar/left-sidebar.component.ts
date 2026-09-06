import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UMLNode } from '../../core/services/diagram.service';

@Component({
  selector: 'app-left-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="left-sidebar">
      <!-- Vertical Resizer Handle Bar (ew-resize) -->
      <div 
        class="sidebar-resizer-left" 
        [class.active]="isResizing"
        (mousedown)="startResizing($event)"
        title="Arrastra para cambiar el ancho del panel izquierdo"
      ></div>

      <!-- Section 1: Palette of UML Elements -->
      <div class="sidebar-section">
        <div class="section-title">Elementos UML</div>
        <div class="palette-grid">
          <div 
            class="palette-item" 
            draggable="true"
            (dragstart)="onDragStart($event, 'Class')"
            (click)="addElement.emit('Class')"
          >
            <span class="item-icon class-icon">C</span>
            <div class="item-text">
              <span class="item-name">Class</span>
              <span class="item-sub">«Entity»</span>
            </div>
          </div>

          <div 
            class="palette-item" 
            draggable="true"
            (dragstart)="onDragStart($event, 'Interface')"
            (click)="addElement.emit('Interface')"
          >
            <span class="item-icon interface-icon">I</span>
            <div class="item-text">
              <span class="item-name">Interface</span>
              <span class="item-sub">«Interface»</span>
            </div>
          </div>

          <div 
            class="palette-item" 
            draggable="true"
            (dragstart)="onDragStart($event, 'Abstract')"
            (click)="addElement.emit('Abstract')"
          >
            <span class="item-icon abstract-icon">A</span>
            <div class="item-text">
              <span class="item-name">Abstract Class</span>
              <span class="item-sub">«Abstract»</span>
            </div>
          </div>

          <div 
            class="palette-item" 
            draggable="true"
            (dragstart)="onDragStart($event, 'Enum')"
            (click)="addElement.emit('Enum')"
          >
            <span class="item-icon enum-icon">E</span>
            <div class="item-text">
              <span class="item-name">Enum</span>
              <span class="item-sub">«Enum»</span>
            </div>
          </div>

          <div 
            class="palette-item" 
            draggable="true"
            (dragstart)="onDragStart($event, 'Package')"
            (click)="addElement.emit('Package')"
          >
            <span class="item-icon package-icon">📦</span>
            <div class="item-text">
              <span class="item-name">Package</span>
              <span class="item-sub">«Package»</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 2: Palette of Connectors -->
      <div class="sidebar-section">
        <div class="section-title">Conectores UML</div>
        <div class="connectors-list">
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'Association'"
            (click)="selectConnector('Association')"
          >
            <span class="conn-icon">───►</span>
            <span>Asociación</span>
          </button>
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'AssociationClass'"
            (click)="selectConnector('AssociationClass')"
          >
            <span class="conn-icon">──┼──</span>
            <span>Clase de Asociación</span>
          </button>
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'Inheritance'"
            (click)="selectConnector('Inheritance')"
          >
            <span class="conn-icon">───▷</span>
            <span>Herencia</span>
          </button>
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'Implementation'"
            (click)="selectConnector('Implementation')"
          >
            <span class="conn-icon"> - - ▷</span>
            <span>Implementación</span>
          </button>
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'Aggregation'"
            (click)="selectConnector('Aggregation')"
          >
            <span class="conn-icon">───◇</span>
            <span>Agregación</span>
          </button>
          <button 
            class="connector-btn" 
            [class.active]="activeConnectorType === 'Composition'"
            (click)="selectConnector('Composition')"
          >
            <span class="conn-icon">───◆</span>
            <span>Composición</span>
          </button>
        </div>
      </div>

      <!-- Section 3: Hierarchy Tree View -->
      <div class="sidebar-section tree-section">
        <div class="section-title">Árbol de Jerarquía</div>
        <div class="tree-container">
          <div class="tree-root">
            <span class="tree-folder-icon">📁</span>
            <span class="tree-root-name">Modelo Diagrama</span>
          </div>
          <div class="tree-children">
            <div 
              class="tree-item" 
              *ngFor="let node of nodes"
              [class.selected]="selectedNode?.id === node.id"
              (click)="selectNode.emit(node)"
            >
              <span class="node-badge" [ngClass]="getStereotypeClass(node.stereotype)">
                {{ getStereotypeLetter(node.stereotype) }}
              </span>
              <span class="tree-node-name">{{ node.name }}</span>
            </div>
            <div class="tree-empty" *ngIf="nodes.length === 0">
              Sin elementos en el lienzo
            </div>
          </div>
        </div>
      </div>
    </aside>
  `,
  styles: [`
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      flex-shrink: 0;
      z-index: 30;
    }
    .left-sidebar {
      width: 100%;
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: calc(100vh - var(--navbar-height));
      overflow-y: auto;
      user-select: none;
      box-sizing: border-box;
    }
    .sidebar-resizer-left {
      position: absolute;
      top: 0;
      right: -4px;
      bottom: 0;
      width: 8px;
      cursor: ew-resize;
      z-index: 100;
      transition: background 0.2s ease, box-shadow 0.2s ease;
    }
    .sidebar-resizer-left:hover, .sidebar-resizer-left.active {
      background: var(--cyan);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.8);
    }
    .sidebar-section {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .palette-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .palette-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      cursor: grab;
      transition: var(--transition);
    }
    .palette-item:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-hover);
      transform: translateX(2px);
    }
    .palette-item:active {
      cursor: grabbing;
    }
    .item-icon {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 11px;
    }
    .class-icon { background: rgba(0, 212, 255, 0.2); color: var(--cyan); }
    .interface-icon { background: rgba(124, 58, 237, 0.2); color: var(--violet-light); }
    .abstract-icon { background: rgba(245, 158, 11, 0.2); color: var(--yellow-accent); }
    .enum-icon { background: rgba(16, 185, 129, 0.2); color: var(--green); }
    .package-icon { background: rgba(255, 255, 255, 0.1); font-size: 12px; }
    
    .item-text {
      display: flex;
      flex-direction: column;
    }
    .item-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .item-sub {
      font-size: 10px;
      color: var(--text-muted);
    }
    .connectors-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .connector-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      transition: var(--transition);
    }
    .connector-btn:hover {
      background: var(--bg-card);
      color: var(--text-primary);
    }
    .connector-btn.active {
      background: var(--cyan-glow);
      border-color: var(--cyan);
      color: var(--cyan);
      font-weight: 600;
    }
    .conn-icon {
      font-family: monospace;
      font-size: 11px;
    }
    .tree-section {
      flex: 1;
      border-bottom: none;
      display: flex;
      flex-direction: column;
    }
    .tree-container {
      font-size: 12px;
    }
    .tree-root {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
    }
    .tree-children {
      margin-left: 14px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tree-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: var(--transition);
    }
    .tree-item:hover {
      background: var(--bg-card);
    }
    .tree-item.selected {
      background: var(--bg-surface-light);
      color: var(--cyan);
      font-weight: 600;
    }
    .node-badge {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: bold;
    }
    .tree-empty {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
      padding: 4px 0;
    }
  `]
})
export class LeftSidebarComponent implements OnDestroy {
  @Input() nodes: UMLNode[] = [];
  @Input() selectedNode: UMLNode | null = null;
  @Input() activeConnectorType: string | null = null;
  @Input() sidebarWidth = 200;

  @Output() addElement = new EventEmitter<string>();
  @Output() selectConnectorType = new EventEmitter<string | null>();
  @Output() selectNode = new EventEmitter<UMLNode>();
  @Output() sidebarWidthChange = new EventEmitter<number>();

  isResizing = false;
  private startX = 0;
  private startWidth = 200;

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
    const newWidth = Math.max(160, Math.min(400, this.startWidth + deltaX));
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

  onDragStart(event: DragEvent, elementType: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', elementType);
    }
  }

  selectConnector(type: string): void {
    if (this.activeConnectorType === type) {
      this.selectConnectorType.emit(null);
    } else {
      this.selectConnectorType.emit(type);
    }
  }

  getStereotypeLetter(stereotype: string): string {
    switch (stereotype?.toLowerCase()) {
      case 'interface': return 'I';
      case 'abstract': return 'A';
      case 'enum': return 'E';
      case 'package': return 'P';
      default: return 'C';
    }
  }

  getStereotypeClass(stereotype: string): string {
    switch (stereotype?.toLowerCase()) {
      case 'interface': return 'interface-icon';
      case 'abstract': return 'abstract-icon';
      case 'enum': return 'enum-icon';
      default: return 'class-icon';
    }
  }
}
