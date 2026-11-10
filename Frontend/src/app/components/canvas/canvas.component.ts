import { Component, Input, Output, EventEmitter, HostListener, AfterViewInit, OnDestroy, ViewChildren, QueryList, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UMLNode, UMLConnector, CanvasLabel, DiagramService } from '../../core/services/diagram.service';
import { MinimapComponent } from '../minimap/minimap.component';

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, MinimapComponent],
  template: `

    <div
      class="canvas-container"
      [class.grid-active]="showGrid"
      [class.read-only]="readOnly"
      (dragover)="onDragOver($event)"
      (drop)="onDrop($event)"
      (mousemove)="onMouseMove($event)"
      (click)="onCanvasClick($event)"
      (dblclick)="onCanvasDblClick($event)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerEnd($event)"
      (pointercancel)="onPointerEnd($event)"
      (wheel)="onWheel($event)"
    >
      <!-- Vista única del lienzo (escala conectores SVG, nodos, etiquetas y cursores 1:1) -->
      <div
        class="canvas-viewport"
        [style.transform]="'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoomLevel + ')'"
        [style.transform-origin]="'0 0'"
      >
        <!-- Capa de conectores SVG (z-index: 25) -->
        <svg class="svg-layer">
        <defs>
          <!-- Flecha de asociación o dependencia -->
          <marker id="arrow" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="10" markerHeight="10" orient="auto">
            <path d="M 1 1 L 13 7 L 1 13" fill="none" stroke="#00d4ff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
          </marker>
          <!-- Triángulo de herencia -->
          <marker id="inheritance" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="12" markerHeight="12" orient="auto">
            <path d="M 1 1 L 13 7 L 1 13 Z" fill="#ffffff" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
          <!-- Rombo sólido de composición -->
          <marker id="composition" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="14" markerHeight="14" orient="auto">
            <path d="M 1 8 L 8 1 L 15 8 L 8 15 Z" fill="#000000" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
          <!-- Rombo blanco hueco de agregación (estilo imagen 2) -->
          <marker id="aggregation" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="14" markerHeight="14" orient="auto">
            <path d="M 1 8 L 8 1 L 15 8 L 8 15 Z" fill="#ffffff" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
        </defs>

        <!-- Dibujar conectores -->
        <g *ngFor="let conn of connectors">
          <!-- Conectores normales, no reflexivos -->
          <ng-container *ngIf="!isReflexive(conn)">
            <!-- Zona invisible de 16px para poder hacer clic en la línea con facilidad -->
            <path 
              [attr.d]="getConnectorPath(conn)" 
              class="connector-hitbox"
              (click)="onConnectorClick($event, conn)"
              (dblclick)="onConnectorClick($event, conn)"
            />

            <!-- Trazo visible de la línea del conector -->
            <path 
              [attr.d]="getConnectorPath(conn)" 
              class="connector-line"
              [class.selected]="selectedConnector?.id === conn.id || editingConnector?.id === conn.id"
              [attr.stroke-dasharray]="(conn.type === 'Implementation' || conn.type === 'Dependency') ? '6 4' : 'none'"
              (click)="onConnectorClick($event, conn)"
              (dblclick)="onConnectorClick($event, conn)"
            />

            <!-- Rombo blanco hueco de agregación, en SVG -->
            <polygon 
              *ngIf="conn.type === 'Aggregation'"
              [attr.points]="getDiamondPoints(conn)" 
              fill="#ffffff" 
              stroke="#00d4ff" 
              stroke-width="2.5"
              stroke-linejoin="miter"
              style="cursor: pointer; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));"
              (click)="onConnectorClick($event, conn)"
            />

            <!-- Rombo negro sólido de composición, en SVG -->
            <polygon 
              *ngIf="conn.type === 'Composition'"
              [attr.points]="getDiamondPoints(conn)" 
              fill="#000000" 
              stroke="#00d4ff" 
              stroke-width="2.5"
              stroke-linejoin="miter"
              style="cursor: pointer; pointer-events: all;"
              (click)="onConnectorClick($event, conn)"
            />

            <!-- Triángulo de herencia o implementación, en SVG -->
            <polygon 
              *ngIf="conn.type === 'Inheritance' || conn.type === 'Implementation'"
              [attr.points]="getTrianglePoints(conn)" 
              fill="#ffffff" 
              stroke="#00d4ff" 
              stroke-width="2.5"
              stroke-linejoin="miter"
              style="cursor: pointer; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));"
              (click)="onConnectorClick($event, conn)"
            />

            <!-- Multiplicidad de origen (junto a la clase origen) -->
            <g *ngIf="shouldShowSourceMultiplicity(conn)">
              <!-- Línea guía punteada al estilo de Enterprise Architect (solo si está seleccionado) -->
              <line 
                *ngIf="isSelectedMultiplicity(conn, 'source')"
                [attr.x1]="getConnectorSourceAnchorX(conn)"
                [attr.y1]="getConnectorSourceAnchorY(conn) - 8"
                [attr.x2]="getConnectorSourceX(conn)"
                [attr.y2]="getConnectorSourceY(conn) - 8"
                stroke="#00d4ff"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                style="pointer-events: none; filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.8));"
              />

              <!-- Texto de la multiplicidad -->
              <text 
                [attr.x]="getConnectorSourceX(conn)" 
                [attr.y]="getConnectorSourceY(conn) - 8" 
                class="connector-mult-text"
                [class.selected-mult]="isSelectedMultiplicity(conn, 'source')"
                (mousedown)="startDragMultiplicity($event, conn, 'source')"
                (click)="$event.stopPropagation(); selectMultiplicity(conn, 'source')"
                (dblclick)="onConnectorClick($event, conn)"
                title="Haz clic y arrastra para mover la multiplicidad"
              >
                {{ conn.sourceMultiplicity || '' }}
              </text>

              <!-- Caja de selección de 4 esquinas, al estilo de Enterprise Architect -->
              <g *ngIf="isSelectedMultiplicity(conn, 'source')">
                <rect [attr.x]="getConnectorSourceX(conn) - 12" [attr.y]="getConnectorSourceY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) + 12" [attr.y]="getConnectorSourceY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) - 12" [attr.y]="getConnectorSourceY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) + 12" [attr.y]="getConnectorSourceY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Multiplicidad de destino (junto a la clase destino) -->
            <g *ngIf="shouldShowTargetMultiplicity(conn)">
              <!-- Línea guía punteada al estilo de Enterprise Architect (solo si está seleccionado) -->
              <line 
                *ngIf="isSelectedMultiplicity(conn, 'target')"
                [attr.x1]="getConnectorTargetAnchorX(conn)"
                [attr.y1]="getConnectorTargetAnchorY(conn) - 8"
                [attr.x2]="getConnectorTargetX(conn)"
                [attr.y2]="getConnectorTargetY(conn) - 8"
                stroke="#00d4ff"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                style="pointer-events: none; filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.8));"
              />

              <!-- Texto de la multiplicidad -->
              <text 
                [attr.x]="getConnectorTargetX(conn)" 
                [attr.y]="getConnectorTargetY(conn) - 8" 
                class="connector-mult-text"
                [class.selected-mult]="isSelectedMultiplicity(conn, 'target')"
                (mousedown)="startDragMultiplicity($event, conn, 'target')"
                (click)="$event.stopPropagation(); selectMultiplicity(conn, 'target')"
                (dblclick)="onConnectorClick($event, conn)"
                title="Haz clic y arrastra para mover la multiplicidad"
              >
                {{ conn.targetMultiplicity || '' }}
              </text>

              <!-- Caja de selección de 4 esquinas, al estilo de Enterprise Architect -->
              <g *ngIf="isSelectedMultiplicity(conn, 'target')">
                <rect [attr.x]="getConnectorTargetX(conn) - 12" [attr.y]="getConnectorTargetY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) + 12" [attr.y]="getConnectorTargetY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) - 12" [attr.y]="getConnectorTargetY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) + 12" [attr.y]="getConnectorTargetY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Etiqueta o nombre de la relación (al centro) -->
            <text 
              *ngIf="conn.label"
              [attr.x]="getConnectorMidX(conn)" 
              [attr.y]="getConnectorMidY(conn) - 10" 
              class="connector-text"
              (click)="onConnectorClick($event, conn)"
              (dblclick)="onConnectorClick($event, conn)"
            >
              {{ conn.label }}
            </text>

            <!-- Línea punteada de la clase de asociación -->
            <line 
              *ngIf="getAssocClassNode(conn)"
              [attr.x1]="getConnectorMidX(conn)" 
              [attr.y1]="getConnectorMidY(conn)" 
              [attr.x2]="getAssocClassTopX(conn)" 
              [attr.y2]="getAssocClassTopY(conn)" 
              stroke="#00d4ff" 
              stroke-width="2.5" 
              stroke-dasharray="5 5" 
              style="filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));"
            />

          </ng-container>

          <!-- Conectores en lazo de asociación reflexiva -->
          <ng-container *ngIf="conn.sourceNodeId === conn.targetNodeId">
            <!-- Zona de clic -->
            <path 
              [attr.d]="getReflexivePath(conn)" 
              class="connector-hitbox"
              (click)="onConnectorClick($event, conn)"
              (mousedown)="startDragLoopBox($event, conn)"
            />

            <!-- Línea visible del lazo reflexivo -->
            <path 
              [attr.d]="getReflexivePath(conn)" 
              class="connector-line"
              [class.selected]="selectedConnector?.id === conn.id || editingConnector?.id === conn.id"
              [attr.stroke-dasharray]="(conn.type === 'Implementation' || conn.type === 'Dependency') ? '6 4' : 'none'"
              style="cursor: move; pointer-events: all; stroke-width: 2.5px; filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));"
              (click)="onConnectorClick($event, conn)"
              (mousedown)="startDragLoopBox($event, conn)"
            />

            <!-- Multiplicidad de destino del lazo reflexivo -->
            <g *ngIf="conn.targetMultiplicity">
              <!-- Línea guía punteada al estilo de Enterprise Architect (solo si está seleccionado) -->
              <line 
                *ngIf="isSelectedMultiplicity(conn, 'target')"
                [attr.x1]="getReflexiveBox(conn).x + getReflexiveBox(conn).width + 8"
                [attr.y1]="getReflexiveBox(conn).y + 14"
                [attr.x2]="getReflexiveTargetMultX(conn)"
                [attr.y2]="getReflexiveTargetMultY(conn)"
                stroke="#00d4ff"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                style="pointer-events: none; filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.8));"
              />

              <text
                [attr.x]="getReflexiveTargetMultX(conn)"
                [attr.y]="getReflexiveTargetMultY(conn)"
                class="connector-mult-text"
                [class.selected-mult]="isSelectedMultiplicity(conn, 'target')"
                (mousedown)="startDragMultiplicity($event, conn, 'target')"
                (click)="$event.stopPropagation(); selectMultiplicity(conn, 'target')"
                (dblclick)="onConnectorClick($event, conn)"
                title="Haz clic y arrastra para mover la multiplicidad"
              >
                {{ conn.targetMultiplicity }}
              </text>

              <!-- Caja de selección de 4 esquinas, al estilo de Enterprise Architect -->
              <g *ngIf="isSelectedMultiplicity(conn, 'target')">
                <rect [attr.x]="getReflexiveTargetMultX(conn) - 12" [attr.y]="getReflexiveTargetMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) + 12" [attr.y]="getReflexiveTargetMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) - 12" [attr.y]="getReflexiveTargetMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) + 12" [attr.y]="getReflexiveTargetMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Multiplicidad de origen del lazo reflexivo -->
            <g *ngIf="conn.sourceMultiplicity">
              <!-- Línea guía punteada al estilo de Enterprise Architect (solo si está seleccionado) -->
              <line 
                *ngIf="isSelectedMultiplicity(conn, 'source')"
                [attr.x1]="getReflexiveBox(conn).x - 14"
                [attr.y1]="getReflexiveBox(conn).y + getReflexiveBox(conn).height + 16"
                [attr.x2]="getReflexiveSourceMultX(conn)"
                [attr.y2]="getReflexiveSourceMultY(conn)"
                stroke="#00d4ff"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                style="pointer-events: none; filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.8));"
              />

              <text
                [attr.x]="getReflexiveSourceMultX(conn)"
                [attr.y]="getReflexiveSourceMultY(conn)"
                class="connector-mult-text"
                [class.selected-mult]="isSelectedMultiplicity(conn, 'source')"
                (mousedown)="startDragMultiplicity($event, conn, 'source')"
                (click)="$event.stopPropagation(); selectMultiplicity(conn, 'source')"
                (dblclick)="onConnectorClick($event, conn)"
                title="Haz clic y arrastra para mover la multiplicidad"
              >
                {{ conn.sourceMultiplicity }}
              </text>

              <!-- Caja de selección de 4 esquinas, al estilo de Enterprise Architect -->
              <g *ngIf="isSelectedMultiplicity(conn, 'source')">
                <rect [attr.x]="getReflexiveSourceMultX(conn) - 12" [attr.y]="getReflexiveSourceMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) + 12" [attr.y]="getReflexiveSourceMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) - 12" [attr.y]="getReflexiveSourceMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) + 12" [attr.y]="getReflexiveSourceMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Asas interactivas de 4 esquinas al seleccionar o editar -->
            <g *ngIf="selectedConnector?.id === conn.id || editingConnector?.id === conn.id">
              <rect 
                [attr.x]="getReflexiveBox(conn).x - 5" 
                [attr.y]="getReflexiveBox(conn).y - 5" 
                width="10" height="10" 
                fill="#00d4ff" stroke="#ffffff" stroke-width="1.5"
                style="cursor: nwse-resize; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.9));"
                (mousedown)="startResizeLoopBox($event, conn, 'nw')"
              />
              <rect 
                [attr.x]="getReflexiveBox(conn).x + getReflexiveBox(conn).width - 5" 
                [attr.y]="getReflexiveBox(conn).y - 5" 
                width="10" height="10" 
                fill="#00d4ff" stroke="#ffffff" stroke-width="1.5"
                style="cursor: nesw-resize; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.9));"
                (mousedown)="startResizeLoopBox($event, conn, 'ne')"
              />
              <rect 
                [attr.x]="getReflexiveBox(conn).x - 5" 
                [attr.y]="getReflexiveBox(conn).y + getReflexiveBox(conn).height - 5" 
                width="10" height="10" 
                fill="#00d4ff" stroke="#ffffff" stroke-width="1.5"
                style="cursor: nesw-resize; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.9));"
                (mousedown)="startResizeLoopBox($event, conn, 'sw')"
              />
              <rect 
                [attr.x]="getReflexiveBox(conn).x + getReflexiveBox(conn).width - 5" 
                [attr.y]="getReflexiveBox(conn).y + getReflexiveBox(conn).height - 5" 
                width="10" height="10" 
                fill="#00d4ff" stroke="#ffffff" stroke-width="1.5"
                style="cursor: nwse-resize; pointer-events: all; filter: drop-shadow(0 0 6px rgba(0,212,255,0.9));"
                (mousedown)="startResizeLoopBox($event, conn, 'se')"
              />
            </g>
          </ng-container>
        </g>
      </svg>

      <!-- Capa de nodos de clases UML (z-index: 20) -->
      <div class="nodes-layer">
        <div 
          *ngFor="let node of nodes" 
          #nodeCard
          [attr.data-node-id]="node.id"
          class="uml-card glass-panel"
          [class.selected]="selectedNode?.id === node.id"
          [class.connecting-source]="connectingSourceId === node.id"
          [style.left.px]="node.positionX"
          [style.top.px]="node.positionY"
          (mousedown)="startDragNode($event, node)"
          (click)="onNodeClick($event, node)"
          (dblclick)="onNodeDblClick($event, node)"
        >
          <!-- Estereotipo y encabezado de la clase -->
          <div class="card-header">
            <span class="stereotype" *ngIf="stereotypeLabel(node) as label">{{ label }}</span>
            <div class="header-name-row">
              <span 
                *ngIf="editingNodeId !== node.id" 
                class="class-name editable-title"
                [class.abstract-name]="(node.stereotype || '').toLowerCase() === 'abstract'"
                (click)="editNodeName($event, node)"
                title="Haz clic para cambiar nombre de la clase"
              >
                {{ node.name }}
              </span>
              <input 
                *ngIf="editingNodeId === node.id" 
                type="text" 
                class="input-inline" 
                [(ngModel)]="node.name" 
                (blur)="saveNodeName(node)" 
                (keyup.enter)="saveNodeName(node)"
                (click)="$event.stopPropagation()"
                autoFocus
              />
              <div class="card-actions">
                <button class="icon-btn text-danger" (click)="deleteNode.emit(node.id); $event.stopPropagation()" title="Eliminar Clase">✕</button>
              </div>
            </div>
          </div>

          <!-- Separador y lista de atributos -->
          <div class="card-section">
            <div class="section-header">
              <span>Atributos</span>
              <button class="icon-btn-sm" (click)="addAttribute($event, node)" title="Añadir atributo">+</button>
            </div>
            
            <div *ngFor="let attr of node.attributes; let i = index">
              <!-- Modo lectura -->
              <div 
                *ngIf="editingAttrKey !== (node.id + '_' + i)" 
                class="member-item member-hoverable"
                (click)="editAttr($event, node, i)"
                title="Haz clic para editar este atributo"
              >
                <span class="visibility-badge">{{ attr.visibility || '+' }}</span>
                <span class="member-name">{{ attr.name }}</span>
                <span class="member-type">: {{ attr.type }}</span>
                <button class="member-del" (click)="deleteAttribute($event, node, i)" title="Eliminar Atributo">✕</button>
              </div>

              <!-- Modo edición -->
              <div 
                *ngIf="editingAttrKey === (node.id + '_' + i)" 
                class="member-edit-row"
                (click)="$event.stopPropagation()"
              >
                <select class="input-vis" [(ngModel)]="attr.visibility" (change)="saveMemberEdit(node)">
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="#">#</option>
                  <option value="~">~</option>
                </select>
                <input type="text" class="input-name" [(ngModel)]="attr.name" (blur)="saveMemberEdit(node)" (keyup.enter)="saveMemberEdit(node)" placeholder="nombre" />
                <span class="colon">:</span>
                <select class="input-type" [(ngModel)]="attr.type" (change)="saveMemberEdit(node)">
                  <option *ngFor="let t of dataTypeOptions" [value]="t">{{ t }}</option>
                </select>
                <button class="member-del-active" (click)="deleteAttribute($event, node, i)" title="Eliminar">✕</button>
              </div>
            </div>

            <div class="member-empty" *ngIf="!node.attributes || node.attributes.length === 0">
              + sin atributos (clic + para agregar)
            </div>
          </div>

          <!-- Separador y lista de métodos -->
          <div class="card-section">
            <div class="section-header">
              <span>Métodos</span>
              <button class="icon-btn-sm" (click)="addMethod($event, node)" title="Añadir método">+</button>
            </div>

            <div *ngFor="let m of node.methods; let i = index">
              <!-- Modo lectura -->
              <div 
                *ngIf="editingMethodKey !== (node.id + '_' + i)" 
                class="member-item member-hoverable"
                (click)="editMethod($event, node, i)"
                title="Haz clic para editar este método"
              >
                <span class="visibility-badge">{{ m.visibility || '+' }}</span>
                <span class="member-name">{{ m.name }}()</span>
                <span class="member-type">: {{ m.returnType || 'void' }}</span>
                <button class="member-del" (click)="deleteMethod($event, node, i)" title="Eliminar Método">✕</button>
              </div>

              <!-- Modo edición -->
              <div 
                *ngIf="editingMethodKey === (node.id + '_' + i)" 
                class="member-edit-row"
                (click)="$event.stopPropagation()"
              >
                <select class="input-vis" [(ngModel)]="m.visibility" (change)="saveMemberEdit(node)">
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="#">#</option>
                  <option value="~">~</option>
                </select>
                <input type="text" class="input-name" [(ngModel)]="m.name" (blur)="saveMemberEdit(node)" (keyup.enter)="saveMemberEdit(node)" placeholder="método" />
                <span class="colon">:</span>
                <input type="text" class="input-type" [(ngModel)]="m.returnType" (blur)="saveMemberEdit(node)" (keyup.enter)="saveMemberEdit(node)" placeholder="retorno" />
                <button class="member-del-active" (click)="deleteMethod($event, node, i)" title="Eliminar">✕</button>
              </div>
            </div>

            <div class="member-empty" *ngIf="!node.methods || node.methods.length === 0">
              + sin métodos (clic + para agregar)
            </div>
          </div>
        </div>

        <!-- Capa de etiquetas y notas libres del lienzo (z-index: 22) -->
        <div class="labels-layer">
          <div 
            *ngFor="let label of labels" 
            class="canvas-label-card glass-panel"
            [class.editing]="editingLabelId === label.id"
            [style.left.px]="label.positionX"
            [style.top.px]="label.positionY"
            (mousedown)="startDragLabel($event, label)"
            (click)="$event.stopPropagation()"
            (dblclick)="editLabelText($event, label)"
          >
            <div *ngIf="editingLabelId !== label.id" class="label-text">
              📝 {{ label.text }}
            </div>
            <textarea 
              *ngIf="editingLabelId === label.id"
              class="label-input"
              [(ngModel)]="label.text"
              (blur)="saveLabelEdit(label)"
              (keyup.enter)="saveLabelEdit(label)"
              (click)="$event.stopPropagation()"
              autoFocus
            ></textarea>
            <button class="label-del-btn" (click)="deleteLabelEvent($event, label.id)" title="Eliminar nota">✕</button>
          </div>
        </div>

        <!-- Capa de cursores de los colaboradores en vivo -->
        <div 
          class="remote-cursor" 
          *ngFor="let c of remoteCursors"
          [style.left.px]="c.cursor.x"
          [style.top.px]="c.cursor.y"
          [style.transform]="readOnly ? 'scale(' + (1 / zoomLevel) + ')' : null"
          [style.transform-origin]="'0 0'"
        >
          <svg class="cursor-pointer" width="16" height="16" viewBox="0 0 24 24">
            <path d="M0 0l16 12-7 2-2 7z" [attr.fill]="c.user.color || '#00d4ff'" />
          </svg>
          <span class="cursor-badge" [style.background]="c.user.color || '#00d4ff'">
            {{ c.user.fullName }}
          </span>
        </div>
      </div>
    </div>

      <!-- Ventana flotante para editar la multiplicidad del conector (z-index: 200) -->
      <div 
        *ngIf="editingConnector" 
        class="connector-modal glass-panel animate-fade-in"
        [style.left.px]="modalPosX"
        [style.top.px]="modalPosY"
        (click)="$event.stopPropagation()"
      >
        <div class="modal-header">
          <span>🔗 Editar Relación UML</span>
          <button class="icon-btn-sm" (click)="editingConnector = null">✕</button>
        </div>

        <div class="modal-body">
          <!-- Multiplicidad de origen -->
          <div class="form-group">
            <label>Multiplicidad Origen (Clase {{ getSourceNodeName(editingConnector) }})</label>
            <div class="chip-row">
              <button 
                *ngFor="let opt of multOptions" 
                class="chip-sm" 
                [class.active]="editingConnector.sourceMultiplicity === opt"
                (click)="editingConnector.sourceMultiplicity = opt; saveConnectorEditDirect()"
              >
                {{ opt }}
              </button>
            </div>
            <input type="text" class="input-field-sm" [(ngModel)]="editingConnector.sourceMultiplicity" (input)="saveConnectorEditDirect()" placeholder="Ej. 1..*" />
          </div>

          <!-- Multiplicidad de destino -->
          <div class="form-group">
            <label>Multiplicidad Destino (Clase {{ getTargetNodeName(editingConnector) }})</label>
            <div class="chip-row">
              <button 
                *ngFor="let opt of multOptions" 
                class="chip-sm" 
                [class.active]="editingConnector.targetMultiplicity === opt"
                (click)="editingConnector.targetMultiplicity = opt; saveConnectorEditDirect()"
              >
                {{ opt }}
              </button>
            </div>
            <input type="text" class="input-field-sm" [(ngModel)]="editingConnector.targetMultiplicity" (input)="saveConnectorEditDirect()" placeholder="Ej. 0..*" />
          </div>

          <!-- Tipo de conector -->
          <div class="form-group">
            <label>Tipo de Conector UML</label>
            <select class="input-field-sm" [(ngModel)]="editingConnector.type" (change)="saveConnectorEditDirect()">
              <option value="Association">Asociación (───►)</option>
              <option value="Inheritance">Herencia (───▷)</option>
              <option value="Implementation">Implementación (- - ▷)</option>
              <option value="Aggregation">Agregación (───◇)</option>
              <option value="Composition">Composición (───◆)</option>
            </select>
          </div>

          <!-- Etiqueta de la relación -->
          <div class="form-group">
            <label>Nombre / Etiqueta de la Relación</label>
            <input type="text" class="input-field-sm" [(ngModel)]="editingConnector.label" (input)="saveConnectorEditDirect()" placeholder="Ej. tiene, pertenece a" />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm text-danger" (click)="deleteConnectorEvent(editingConnector.id)">
            🗑️ Eliminar Relación
          </button>
          <button class="btn btn-primary btn-sm" (click)="editingConnector = null">
            Listo ✓
          </button>
        </div>
      </div>

      <!-- Panel fijo arriba a la derecha para controlar el conector -->
      <div 
        *ngIf="selectedConnector && !editingConnector" 
        class="connector-quick-panel glass-panel animate-fade-in"
        (click)="$event.stopPropagation()"
      >
        <div class="quick-header">
          <span>Relación Seleccionada</span>
          <button class="icon-btn-sm" (click)="selectedConnector = null">✕</button>
        </div>
        <div class="quick-row">
          <span>Origen ({{ getSourceNodeName(selectedConnector) }}):</span>
          <select class="input-vis" [(ngModel)]="selectedConnector.sourceMultiplicity" (change)="onQuickChange(selectedConnector)">
            <option *ngFor="let opt of multOptions" [value]="opt">{{ opt }}</option>
          </select>
        </div>
        <div class="quick-row">
          <span>Destino ({{ getTargetNodeName(selectedConnector) }}):</span>
          <select class="input-vis" [(ngModel)]="selectedConnector.targetMultiplicity" (change)="onQuickChange(selectedConnector)">
            <option *ngFor="let opt of multOptions" [value]="opt">{{ opt }}</option>
          </select>
        </div>
        <div class="quick-actions">
          <button class="btn btn-ghost btn-sm" (click)="openConnectorModal($event, selectedConnector)">
            ✏️ Editar Todo
          </button>
          <button class="btn btn-ghost btn-sm text-danger" (click)="deleteConnectorEvent(selectedConnector.id)">
            🗑️ Eliminar
          </button>
        </div>
      </div>

      <!-- Minimapa de navegación -->
      <app-minimap
        [nodes]="nodes"
        [connectors]="connectors"
        [remoteCursors]="remoteCursors"
        [zoomLevel]="zoomLevel"
        [panX]="panX"
        [panY]="panY"
        (navigateTo)="centerOn($event)"
      ></app-minimap>

      <!-- Barra inferior de estado y controles -->
      <div class="status-bar">

        <div class="status-left">
          <span class="status-item">
            <span class="status-dot dot-connected"></span>
            <span>Architect Sync: Connected</span>
          </span>
          <span class="status-separator">|</span>
          <span class="status-item text-muted">Auto-save: up to date</span>
        </div>

        <div class="status-right">
          <button class="btn-tool" [class.active]="showGrid" (click)="showGrid = !showGrid">
            <span>Grid: {{ showGrid ? 'On' : 'Off' }}</span>
          </button>
          <div class="zoom-controls">
            <button class="btn-zoom" (click)="changeZoom(-0.1)">-</button>
            <span class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</span>
            <button class="btn-zoom" (click)="changeZoom(0.1)">+</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      flex: 1;
      display: flex;
      height: calc(100vh - var(--navbar-height));
      position: relative;
      min-width: 0;
    }
    /* Modo Ver: nodos, conectores y etiquetas ignoran clics y arrastres; el zoom sigue funcionando */
    .canvas-container.read-only .canvas-viewport,
    .canvas-container.read-only .canvas-viewport * {
      pointer-events: none !important;
    }
    /* Modo Ver: los gestos los maneja el lienzo; si no, el navegador se queda con ellos */
    .canvas-container.read-only {
      touch-action: none;
    }
    .canvas-container {
      flex: 1;
      width: 100%;
      position: relative;
      background: var(--bg-darkest);
      overflow: hidden;
      height: calc(100vh - var(--navbar-height));
      user-select: none;
    }
    .canvas-container.grid-active {
      background-image: 
        radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .canvas-viewport {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .svg-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
      z-index: 10;
    }
    .connector-hitbox {
      stroke: transparent;
      stroke-width: 18px;
      fill: none;
      pointer-events: stroke;
      cursor: pointer;
    }
    .connector-line {
      stroke: var(--cyan);
      stroke-width: 3px;
      fill: none;
      pointer-events: stroke;
      cursor: pointer;
      transition: stroke 0.2s ease;
    }
    .connector-line:hover, .connector-line.selected {
      stroke: var(--violet-light);
      stroke-width: 4px;
      filter: drop-shadow(0 0 8px var(--violet-light));
    }
    .connector-text {
      fill: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      text-anchor: middle;
      pointer-events: all;
      cursor: pointer;
    }
    .connector-text:hover {
      fill: var(--cyan);
    }
    .connector-mult-text {
      fill: var(--cyan);
      font-size: 13px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      text-anchor: middle;
      pointer-events: all;
      cursor: move;
      user-select: none;
      filter: drop-shadow(0 0 6px var(--cyan-glow));
    }
    .connector-mult-text:hover, .connector-mult-text.selected-mult {
      fill: #ffffff;
      font-size: 14px;
      filter: drop-shadow(0 0 10px rgba(0, 212, 255, 0.9));
    }
    .nodes-layer {
      position: absolute;
      inset: 0;
      z-index: 20;
      pointer-events: none;
    }
    .uml-card {
      position: absolute;
      width: 230px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      cursor: move;
      pointer-events: auto;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .uml-card:hover {
      border-color: var(--border-hover);
    }
    .uml-card.selected {
      border-color: var(--cyan);
      box-shadow: 0 0 16px var(--cyan-glow);
    }
    .uml-card.connecting-source {
      border-color: var(--yellow-accent);
      box-shadow: 0 0 16px var(--yellow-glow);
    }
    .card-header {
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom: 1px solid var(--border);
      text-align: center;
    }
    .abstract-name {
      font-style: italic;
    }
    .stereotype {
      font-size: 10px;
      color: var(--cyan);
      font-weight: 600;
      letter-spacing: 0.5px;
      display: block;
    }
    .header-name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-top: 2px;
    }
    .class-name {
      font-weight: 700;
      font-size: 13px;
      color: var(--text-bright);
      flex: 1;
      text-align: center;
    }
    .editable-title {
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm);
      transition: var(--transition);
    }
    .editable-title:hover {
      background: var(--bg-surface);
      color: var(--cyan);
    }
    .card-actions {
      display: flex;
      gap: 2px;
    }
    .card-section {
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
    }
    .card-section:last-child {
      border-bottom: none;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .member-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 4px 6px;
      color: var(--text-primary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: var(--transition);
    }
    .member-hoverable:hover {
      background: var(--bg-surface);
    }
    .member-edit-row {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px 0;
    }
    .input-vis {
      background: var(--bg-darkest);
      border: 1px solid var(--cyan);
      color: var(--cyan);
      font-size: 11px;
      font-weight: bold;
      padding: 1px 2px;
      border-radius: 3px;
    }
    .input-name {
      flex: 1;
      width: 60px;
      background: var(--bg-darkest);
      border: 1px solid var(--cyan);
      color: #fff;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .input-type {
      width: 50px;
      background: var(--bg-darkest);
      border: 1px solid var(--cyan);
      color: #a5f3fc;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .colon {
      color: var(--text-secondary);
      font-weight: bold;
    }
    .visibility-badge {
      font-family: monospace;
      color: var(--cyan);
      font-weight: bold;
    }
    .member-name {
      font-weight: 500;
    }
    .member-type {
      color: var(--text-secondary);
    }
    .member-del {
      margin-left: auto;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      opacity: 0.6;
      transition: opacity 0.15s ease, color 0.15s ease;
    }
    .member-item:hover .member-del {
      opacity: 1;
    }
    .member-del:hover {
      color: var(--red);
    }
    .member-del-active {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: var(--red);
      cursor: pointer;
      font-size: 10px;
      padding: 2px 5px;
      border-radius: 3px;
    }
    .member-del-active:hover {
      background: var(--red);
      color: #fff;
    }
    .member-empty {
      font-size: 10px;
      color: var(--text-muted);
      font-style: italic;
    }
    .icon-btn, .icon-btn-sm {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .icon-btn:hover, .icon-btn-sm:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }
    .text-danger {
      color: var(--red) !important;
    }
    .text-danger:hover {
      background: rgba(239, 68, 68, 0.2) !important;
    }
    .input-inline {
      width: 100%;
      background: var(--bg-darkest);
      border: 1px solid var(--cyan);
      color: #fff;
      font-size: 12px;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .connector-modal {
      position: absolute;
      width: 300px;
      z-index: 200;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: var(--shadow-lg);
    }
    .connector-quick-panel {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 240px;
      z-index: 150;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: var(--shadow-md);
    }
    .quick-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 700;
      font-size: 11px;
      color: var(--cyan);
      border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
    }
    .quick-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .quick-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 700;
      font-size: 13px;
      color: var(--cyan);
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-size: 11px;
      color: var(--text-secondary);
    }
    .chip-row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .chip-sm {
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 3px 7px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      font-family: monospace;
    }
    .chip-sm:hover {
      border-color: var(--cyan);
      color: var(--cyan);
    }
    .chip-sm.active {
      background: var(--cyan-glow);
      border-color: var(--cyan);
      color: var(--cyan);
      font-weight: bold;
    }
    .input-field-sm {
      width: 100%;
      padding: 6px 10px;
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
    }
    .modal-footer {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--border);
      padding-top: 8px;
      margin-top: 4px;
    }
    .remote-cursor {
      position: absolute;
      pointer-events: none;
      z-index: 50;
      transition: left 0.05s linear, top 0.05s linear;
    }
    .cursor-badge {
      position: absolute;
      left: 14px;
      top: 14px;
      font-size: 10px;
      font-weight: 600;
      color: #000;
      padding: 2px 6px;
      border-radius: 99px;
      white-space: nowrap;
      box-shadow: var(--shadow-sm);
    }
    .status-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: var(--statusbar-height);
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 40;
      font-size: 11px;
    }
    .status-left, .status-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-separator {
      color: var(--border);
    }
    .text-muted {
      color: var(--text-muted);
    }
    .btn-tool {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      cursor: pointer;
    }
    .btn-tool.active {
      background: var(--cyan-glow);
      color: var(--cyan);
      border-color: var(--cyan);
    }
    .labels-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 22;
    }
    .canvas-label-card {
      position: absolute;
      pointer-events: auto;
      min-width: 140px;
      max-width: 320px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.85);
      border: 1.5px solid rgba(0, 212, 255, 0.4);
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 212, 255, 0.2);
      cursor: move;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .canvas-label-card:hover, .canvas-label-card.editing {
      border-color: #00d4ff;
      box-shadow: 0 4px 25px rgba(0, 212, 255, 0.5);
    }
    .label-text {
      font-size: 13px;
      font-weight: 500;
      color: #e2e8f0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
      flex: 1;
    }
    .label-input {
      width: 100%;
      background: rgba(0, 0, 0, 0.6);
      border: 1.5px solid #00d4ff;
      border-radius: 4px;
      color: #00d4ff;
      font-size: 13px;
      font-family: inherit;
      padding: 4px 8px;
      outline: none;
      resize: both;
      min-height: 44px;
    }
    .label-del-btn {
      background: transparent;
      border: none;
      color: #ff4d4d;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.2s ease;
      padding: 0 4px;
    }
    .label-del-btn:hover {
      opacity: 1;
    }

    /* Tema claro: cian más oscuro y sin brillo neón sobre fondo claro */
    :host-context([data-theme="light"]) .canvas-container.grid-active {
      background-image: radial-gradient(circle, rgba(15, 23, 42, 0.14) 1px, transparent 1px);
    }
    :host-context([data-theme="light"]) [stroke="#00d4ff"] {
      stroke: var(--cyan);
    }
    :host-context([data-theme="light"]) [fill="#00d4ff"] {
      fill: var(--cyan);
    }
    :host-context([data-theme="light"]) [style*="drop-shadow"] {
      filter: none !important;
    }
    :host-context([data-theme="light"]) .connector-mult-text {
      filter: none;
    }
    :host-context([data-theme="light"]) .connector-mult-text:hover,
    :host-context([data-theme="light"]) .connector-mult-text.selected-mult {
      fill: var(--text-bright);
      filter: none;
    }
    :host-context([data-theme="light"]) .card-header {
      background: rgba(15, 23, 42, 0.03);
    }
    :host-context([data-theme="light"]) .input-name {
      color: var(--text-bright);
    }
    :host-context([data-theme="light"]) .input-type {
      color: var(--cyan-dark);
    }
    :host-context([data-theme="light"]) .canvas-label-card {
      background: rgba(255, 255, 255, 0.95);
      border-color: rgba(8, 145, 178, 0.35);
      box-shadow: var(--shadow-md);
    }
    :host-context([data-theme="light"]) .canvas-label-card:hover,
    :host-context([data-theme="light"]) .canvas-label-card.editing {
      border-color: var(--cyan);
      box-shadow: 0 4px 16px rgba(8, 145, 178, 0.2);
    }
    :host-context([data-theme="light"]) .label-text {
      color: var(--text-primary);
    }
    :host-context([data-theme="light"]) .label-input {
      background: var(--bg-card);
      border-color: var(--cyan);
      color: var(--cyan-dark);
    }
    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-dark);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .btn-zoom {
      background: transparent;
      border: none;
      color: var(--text-primary);
      cursor: pointer;
      font-weight: bold;
    }
    .zoom-level {
      color: var(--text-secondary);
      min-width: 36px;
      text-align: center;
    }
  `]
})
export class CanvasComponent implements AfterViewInit, OnDestroy {
  @Input() nodes: UMLNode[] = [];
  @Input() connectors: UMLConnector[] = [];
  @Input() labels: CanvasLabel[] = [];
  @Input() selectedNode: UMLNode | null = null;
  @Input() activeConnectorType: string | null = null;
  @Input() remoteCursors: any[] = [];
  // "Modo Ver" (visor móvil): el diagrama se ve y se puede hacer zoom, pero no se edita nada
  @Input() readOnly = false;

  @Output() nodeMoved = new EventEmitter<UMLNode>();
  @Output() nodeDragging = new EventEmitter<UMLNode>();
  @Output() selectNode = new EventEmitter<UMLNode | null>();
  @Output() addNodeFromDrop = new EventEmitter<{ type: string; x: number; y: number }>();
  @Output() deleteNode = new EventEmitter<string>();
  @Output() createConnector = new EventEmitter<{ sourceId: string; targetId: string; type: string }>();
  @Output() cursorMove = new EventEmitter<{ x: number; y: number }>();

  showGrid = true;
  zoomLevel = 1.0;
  Math = Math;

  // Desplazamiento de la vista: con gestos en Modo Ver y con el radar en ambos modos
  panX = 0;
  panY = 0;
  private activePointers = new Map<number, { x: number; y: number }>();
  private panDistance = 0;

  draggingNode: UMLNode | null = null;
  dragOffsetX = 0;
  dragOffsetY = 0;

  editingLabelId: string | null = null;
  draggingLabel: CanvasLabel | null = null;
  labelDragOffsetX = 0;
  labelDragOffsetY = 0;

  connectingSourceId: string | null = null;
  selectedConnector: UMLConnector | null = null;

  editingNodeId: string | null = null;
  editingAttrKey: string | null = null;
  editingMethodKey: string | null = null;

  editingConnector: UMLConnector | null = null;
  modalPosX = 200;
  modalPosY = 150;

  // Texto sobre el nombre de la clase según UML 2.5. El dato no cambia ('Entity' lo usan la IA, la BD y los generadores):
  // una clase normal no lleva estereotipo y la abstracta se indica con el nombre en cursiva.
  stereotypeLabel(node: UMLNode): string | null {
    const stereotype = (node.stereotype || '').trim();
    switch (stereotype.toLowerCase()) {
      case '':
      case 'entity':
      case 'class':
      case 'associationclass':
      case 'abstract':
        return null;
      case 'interface':
        return '«interface»';
      case 'enum':
        return '«enumeration»';
      default:
        return `«${stereotype}»`;
    }
  }

  multOptions = ['+1', '+*', '+0..1', '+1..*', '1', '0..1', '1..*', '0..*', '*', '1..1'];
  dataTypeOptions = ['Int', 'String', 'Double', 'Bool', 'Date', 'Char', 'Long', 'Arrays'];

  // Arrastre y tamaño del lazo reflexivo
  draggingLoopConn: UMLConnector | null = null;
  resizingLoopConn: UMLConnector | null = null;
  resizeCorner: string | null = null;
  loopStartX = 0;
  loopStartY = 0;
  loopInitialW = 90;
  loopInitialH = 130;
  loopInitialOX = -50;
  loopInitialOY = 30;

  // Arrastre de multiplicidades, al estilo de Enterprise Architect
  selectedMultiplicity: { connectorId: string; type: 'source' | 'target' } | null = null;
  draggingMultiplicity: { connector: UMLConnector; type: 'source' | 'target' } | null = null;
  multDragStartX = 0;
  multDragStartY = 0;
  multInitialOffsetX = 0;
  multInitialOffsetY = 0;

  // Tamaño real de cada tarjeta en el DOM: los conectores salen y llegan a su borde exacto.
  // offsetWidth/Height no cambian con el zoom, igual que positionX/Y.
  @ViewChildren('nodeCard') nodeCards!: QueryList<ElementRef<HTMLElement>>;
  private nodeSizes = new Map<string, { w: number; h: number }>();
  private observedCards = new Set<HTMLElement>();
  private resizeObserver?: ResizeObserver;

  constructor(public diagramService: DiagramService, private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset['nodeId'];
        if (!id) continue;
        const size = { w: el.offsetWidth, h: el.offsetHeight };
        const prev = this.nodeSizes.get(id);
        if (size.w && size.h && (prev?.w !== size.w || prev?.h !== size.h)) {
          this.nodeSizes.set(id, size);
          changed = true;
        }
      }
      // El callback corre fuera de Angular: solo se redibuja si alguna medida cambió de verdad
      if (changed) this.ngZone.run(() => {});
    });
    this.syncObservedCards();
    this.nodeCards.changes.subscribe(() => this.syncObservedCards());
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private syncObservedCards(): void {
    if (!this.resizeObserver) return;
    const current = new Set(this.nodeCards.map(ref => ref.nativeElement));
    for (const el of this.observedCards) {
      if (current.has(el)) continue;
      this.resizeObserver.unobserve(el);
      this.observedCards.delete(el);
      const id = el.dataset['nodeId'];
      if (id && !this.nodes?.some(n => n.id === id)) this.nodeSizes.delete(id);
    }
    for (const el of current) {
      if (this.observedCards.has(el)) continue;
      this.resizeObserver.observe(el);
      this.observedCards.add(el);
    }
  }

  onCanvasDblClick(event: MouseEvent): void {
    if (this.readOnly) return;
    const targetElem = event.target as HTMLElement;
    const targetTag = targetElem.tagName.toUpperCase();

    if (
      targetTag === 'INPUT' || 
      targetTag === 'TEXTAREA' || 
      targetTag === 'BUTTON' || 
      targetTag === 'SELECT' || 
      targetElem.closest('.uml-card') || 
      targetElem.closest('.canvas-label-card') || 
      targetElem.closest('.connector-hitbox') ||
      targetElem.closest('.connector-line')
    ) {
      return;
    }

    event.stopPropagation();
    const { x, y } = this.toCanvas(event, event.currentTarget as HTMLElement);

    const newLabel: CanvasLabel = {
      id: 'label_' + Date.now(),
      text: 'Nota de texto...',
      positionX: x,
      positionY: y
    };

    this.diagramService.addLabel(newLabel);
    this.editingLabelId = newLabel.id;
  }

  editLabelText(event: MouseEvent, label: CanvasLabel): void {
    event.stopPropagation();
    this.editingLabelId = label.id;
  }

  saveLabelEdit(label: CanvasLabel): void {
    this.editingLabelId = null;
    this.diagramService.updateLabel(label.id, label.text);
  }

  deleteLabelEvent(event: MouseEvent, labelId: string): void {
    event.stopPropagation();
    this.diagramService.deleteLabel(labelId);
  }

  startDragLabel(event: MouseEvent, label: CanvasLabel): void {
    const targetTag = (event.target as HTMLElement).tagName.toUpperCase();
    if (targetTag === 'TEXTAREA' || targetTag === 'BUTTON' || targetTag === 'INPUT') {
      return;
    }
    event.stopPropagation();
    this.draggingLabel = label;

    const mouse = this.toCanvas(event, (event.currentTarget as HTMLElement).closest('.canvas-container'));

    this.labelDragOffsetX = mouse.x - label.positionX;
    this.labelDragOffsetY = mouse.y - label.positionY;
  }

  findNode(idOrName?: string): UMLNode | undefined {
    if (!idOrName || !this.nodes) return undefined;
    const searchStr = String(idOrName).trim().toLowerCase();
    return this.nodes.find(n => 
      (n.id && String(n.id).trim().toLowerCase() === searchStr) ||
      (n.name && String(n.name).trim().toLowerCase() === searchStr)
    );
  }

  isReflexive(conn: UMLConnector): boolean {
    if (!conn || !conn.sourceNodeId || !conn.targetNodeId) return false;
    if (conn.sourceNodeId === conn.targetNodeId) return true;
    const s = this.findNode(conn.sourceNodeId);
    const t = this.findNode(conn.targetNodeId);
    return !!s && !!t && s.id === t.id;
  }

  getReflexiveBox(conn: UMLConnector): { x: number; y: number; width: number; height: number } {
    const node = this.findNode(conn.sourceNodeId);
    if (!node) return { x: 0, y: 0, width: 100, height: 140 };

    const nodeH = node.height || 160;
    const w = conn.loopWidth || 100;
    const h = conn.loopHeight || 140;

    // Anclar la esquina superior derecha del lazo a la esquina inferior izquierda del nodo (como en la imagen de referencia)
    const ox = conn.loopOffsetX !== undefined ? conn.loopOffsetX : -w;
    const oy = conn.loopOffsetY !== undefined ? conn.loopOffsetY : nodeH;

    return {
      x: node.positionX + ox,
      y: node.positionY + oy,
      width: w,
      height: h
    };
  }

  getReflexivePath(conn: UMLConnector): string {
    const box = this.getReflexiveBox(conn);
    // Rectángulo cerrado de 4 lados
    return `M ${box.x} ${box.y} L ${box.x + box.width} ${box.y} L ${box.x + box.width} ${box.y + box.height} L ${box.x} ${box.y + box.height} Z`;
  }

  getReflexiveTargetMultX(conn: UMLConnector): number {
    const box = this.getReflexiveBox(conn);
    return box.x + box.width + 8 + (conn.targetMultOffsetX || 0);
  }

  getReflexiveTargetMultY(conn: UMLConnector): number {
    const box = this.getReflexiveBox(conn);
    return box.y + 14 + (conn.targetMultOffsetY || 0);
  }

  getReflexiveSourceMultX(conn: UMLConnector): number {
    const box = this.getReflexiveBox(conn);
    return box.x - 14 + (conn.sourceMultOffsetX || 0);
  }

  getReflexiveSourceMultY(conn: UMLConnector): number {
    const box = this.getReflexiveBox(conn);
    return box.y + box.height + 16 + (conn.sourceMultOffsetY || 0);
  }

  startDragLoopBox(event: MouseEvent, conn: UMLConnector): void {
    event.stopPropagation();
    this.selectedConnector = conn;
    this.draggingLoopConn = conn;
    const node = this.findNode(conn.sourceNodeId);
    if (!node) return;

    const w = conn.loopWidth || 100;
    const nodeH = node.height || 160;

    this.loopStartX = event.clientX;
    this.loopStartY = event.clientY;
    this.loopInitialOX = conn.loopOffsetX !== undefined ? conn.loopOffsetX : -w;
    this.loopInitialOY = conn.loopOffsetY !== undefined ? conn.loopOffsetY : nodeH;
  }

  startResizeLoopBox(event: MouseEvent, conn: UMLConnector, corner: string): void {
    event.stopPropagation();
    this.selectedConnector = conn;
    this.resizingLoopConn = conn;
    this.resizeCorner = corner;

    const w = conn.loopWidth || 100;
    const nodeH = conn.sourceNodeId ? (this.findNode(conn.sourceNodeId)?.height || 160) : 160;

    this.loopStartX = event.clientX;
    this.loopStartY = event.clientY;
    this.loopInitialW = w;
    this.loopInitialH = conn.loopHeight || 140;
    this.loopInitialOX = conn.loopOffsetX !== undefined ? conn.loopOffsetX : -w;
    this.loopInitialOY = conn.loopOffsetY !== undefined ? conn.loopOffsetY : nodeH;
  }

  onMouseMove(event: MouseEvent): void {
    const { x: mouseCanvasX, y: mouseCanvasY } = this.toCanvas(event, event.currentTarget as HTMLElement);
    this.cursorMove.emit({ x: mouseCanvasX, y: mouseCanvasY });

    if (this.draggingNode) {
      this.draggingNode.positionX = mouseCanvasX - this.dragOffsetX;
      this.draggingNode.positionY = mouseCanvasY - this.dragOffsetY;
      this.nodeDragging.emit(this.draggingNode);
    }

    if (this.draggingLabel) {
      this.draggingLabel.positionX = mouseCanvasX - this.labelDragOffsetX;
      this.draggingLabel.positionY = mouseCanvasY - this.labelDragOffsetY;
    }

    if (this.draggingMultiplicity) {
      const deltaX = (event.clientX - this.multDragStartX) / this.zoomLevel;
      const deltaY = (event.clientY - this.multDragStartY) / this.zoomLevel;
      if (this.draggingMultiplicity.type === 'source') {
        this.draggingMultiplicity.connector.sourceMultOffsetX = this.multInitialOffsetX + deltaX;
        this.draggingMultiplicity.connector.sourceMultOffsetY = this.multInitialOffsetY + deltaY;
      } else {
        this.draggingMultiplicity.connector.targetMultOffsetX = this.multInitialOffsetX + deltaX;
        this.draggingMultiplicity.connector.targetMultOffsetY = this.multInitialOffsetY + deltaY;
      }
    }

    if (this.draggingLoopConn) {
      const deltaX = event.clientX - this.loopStartX;
      const deltaY = event.clientY - this.loopStartY;
      this.draggingLoopConn.loopOffsetX = this.loopInitialOX + deltaX;
      this.draggingLoopConn.loopOffsetY = this.loopInitialOY + deltaY;
    }

    if (this.resizingLoopConn) {
      const deltaX = event.clientX - this.loopStartX;
      const deltaY = event.clientY - this.loopStartY;

      if (this.resizeCorner?.includes('e')) {
        this.resizingLoopConn.loopWidth = Math.max(30, this.loopInitialW + deltaX);
      }
      if (this.resizeCorner?.includes('w')) {
        const newW = Math.max(30, this.loopInitialW - deltaX);
        this.resizingLoopConn.loopWidth = newW;
        this.resizingLoopConn.loopOffsetX = this.loopInitialOX + (this.loopInitialW - newW);
      }
      if (this.resizeCorner?.includes('s')) {
        this.resizingLoopConn.loopHeight = Math.max(30, this.loopInitialH + deltaY);
      }
      if (this.resizeCorner?.includes('n')) {
        const newH = Math.max(30, this.loopInitialH - deltaY);
        this.resizingLoopConn.loopHeight = newH;
        this.resizingLoopConn.loopOffsetY = this.loopInitialOY + (this.loopInitialH - newH);
      }
    }
  }

  @HostListener('window:mouseup')
  onMouseUp(): void {
    if (this.draggingNode) {
      this.nodeMoved.emit(this.draggingNode);
      this.draggingNode = null;
    }
    if (this.draggingLabel) {
      this.draggingLabel = null;
    }
    if (this.draggingMultiplicity) {
      const conn = this.draggingMultiplicity.connector;
      this.diagramService.updateConnector(conn.id, {
        sourceMultOffsetX: conn.sourceMultOffsetX,
        sourceMultOffsetY: conn.sourceMultOffsetY,
        targetMultOffsetX: conn.targetMultOffsetX,
        targetMultOffsetY: conn.targetMultOffsetY
      });
      const source = this.findNode(conn.sourceNodeId);
      if (source) this.nodeMoved.emit(source);
      this.draggingMultiplicity = null;
    }
    if (this.draggingLoopConn || this.resizingLoopConn) {
      const conn = this.draggingLoopConn || this.resizingLoopConn;
      const source = this.findNode(conn?.sourceNodeId);
      if (source) this.nodeMoved.emit(source);
      this.draggingLoopConn = null;
      this.resizingLoopConn = null;
    }
  }

  startDragNode(event: MouseEvent, node: UMLNode): void {
    const targetTag = (event.target as HTMLElement).tagName.toUpperCase();
    if (targetTag === 'INPUT' || targetTag === 'BUTTON' || targetTag === 'SELECT') {
      return;
    }
    event.stopPropagation();
    this.selectNode.emit(node);
    this.selectedConnector = null;
    this.editingConnector = null;
    this.draggingNode = node;

    const mouse = this.toCanvas(event, (event.currentTarget as HTMLElement).closest('.canvas-container'));

    this.dragOffsetX = mouse.x - node.positionX;
    this.dragOffsetY = mouse.y - node.positionY;
  }

  onNodeClick(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    if (this.activeConnectorType) {
      if (!this.connectingSourceId) {
        this.connectingSourceId = node.id;
      } else if (this.connectingSourceId === node.id) {
        // Segundo clic en el MISMO nodo: crear asociación reflexiva
        const connType = this.activeConnectorType;
        this.connectingSourceId = null;
        this.createConnector.emit({
          sourceId: node.id,
          targetId: node.id,
          type: connType
        });
      } else {
        // Clic en un nodo DISTINTO: crear el conector A -> B
        const sourceId = this.connectingSourceId;
        const connType = this.activeConnectorType;
        this.connectingSourceId = null;
        this.createConnector.emit({
          sourceId: sourceId,
          targetId: node.id,
          type: connType
        });
      }
    } else {
      this.selectNode.emit(node);
      this.selectedConnector = null;
      this.editingConnector = null;
    }
  }

  onNodeDblClick(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    if (this.activeConnectorType) {
      const connType = this.activeConnectorType;
      this.connectingSourceId = null;
      this.createConnector.emit({
        sourceId: node.id,
        targetId: node.id,
        type: connType
      });
    }
  }

  onCanvasClick(event: MouseEvent): void {
    // El click que llega al soltar tras desplazar la vista no debe deseleccionar
    if (this.panDistance > 4) {
      this.panDistance = 0;
      return;
    }
    this.selectNode.emit(null);
    this.selectedConnector = null;
    this.connectingSourceId = null;
    this.editingNodeId = null;
    this.editingAttrKey = null;
    this.editingMethodKey = null;
    this.editingConnector = null;
    const targetElem = event.target as HTMLElement;
    if (!targetElem.closest('.connector-mult-text')) {
      this.selectedMultiplicity = null;
    }
  }

  onConnectorClick(event: MouseEvent, conn: UMLConnector): void {
    event.stopPropagation();
    event.preventDefault();
    this.selectedConnector = conn;
    this.openConnectorModal(event, conn);
  }

  openConnectorModal(event: MouseEvent, conn: UMLConnector): void {
    event.stopPropagation();
    event.preventDefault();
    this.selectedConnector = conn;
    this.editingConnector = conn;

    const container = document.querySelector('.canvas-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      this.modalPosX = Math.max(20, Math.min(rect.width - 320, event.clientX - rect.left - 40));
      this.modalPosY = Math.max(20, Math.min(rect.height - 380, event.clientY - rect.top - 40));
    } else {
      this.modalPosX = Math.max(20, event.clientX - 100);
      this.modalPosY = Math.max(20, event.clientY - 100);
    }
  }

  onQuickChange(conn: UMLConnector): void {
    const source = this.findNode(conn.sourceNodeId);
    if (source) this.nodeMoved.emit(source);
  }

  getSourceNodeName(conn: UMLConnector | null): string {
    if (!conn) return 'Origen';
    return this.findNode(conn.sourceNodeId)?.name || 'Origen';
  }

  getTargetNodeName(conn: UMLConnector | null): string {
    if (!conn) return 'Destino';
    return this.findNode(conn.targetNodeId)?.name || 'Destino';
  }

  saveConnectorEditDirect(): void {
    if (this.editingConnector) {
      const conn = this.editingConnector;
      this.diagramService.updateConnector(conn.id, {
        type: conn.type,
        sourceMultiplicity: conn.sourceMultiplicity,
        targetMultiplicity: conn.targetMultiplicity,
        label: conn.label,
        sourceMultOffsetX: conn.sourceMultOffsetX,
        sourceMultOffsetY: conn.sourceMultOffsetY,
        targetMultOffsetX: conn.targetMultOffsetX,
        targetMultOffsetY: conn.targetMultOffsetY
      });
      const source = this.findNode(conn.sourceNodeId);
      if (source) this.nodeMoved.emit(source);
    }
  }

  deleteConnectorEvent(connectorId: string): void {
    const idx = this.connectors.findIndex(c => c.id === connectorId);
    if (idx !== -1) {
      this.connectors.splice(idx, 1);
    }
    this.editingConnector = null;
    this.selectedConnector = null;
    this.diagramService.deleteConnector(connectorId);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    if (this.readOnly) return;
    const type = event.dataTransfer?.getData('text/plain');
    if (type) {
      const { x, y } = this.toCanvas(event, event.currentTarget as HTMLElement);
      this.addNodeFromDrop.emit({ type, x, y });
    }
  }

  editNodeName(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    this.editingNodeId = node.id;
  }

  saveNodeName(node: UMLNode): void {
    this.editingNodeId = null;
    this.nodeMoved.emit(node);
  }

  editAttr(event: MouseEvent, node: UMLNode, index: number): void {
    event.stopPropagation();
    this.editingAttrKey = `${node.id}_${index}`;
    this.editingMethodKey = null;
  }

  editMethod(event: MouseEvent, node: UMLNode, index: number): void {
    event.stopPropagation();
    this.editingMethodKey = `${node.id}_${index}`;
    this.editingAttrKey = null;
  }

  saveMemberEdit(node: UMLNode): void {
    this.nodeMoved.emit(node);
  }

  addAttribute(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    if (!node.attributes) node.attributes = [];
    node.attributes.push({ visibility: '+', name: 'newAttr', type: 'String' });
    this.editingAttrKey = `${node.id}_${node.attributes.length - 1}`;
    this.nodeMoved.emit(node);
  }

  deleteAttribute(event: MouseEvent, node: UMLNode, index: number): void {
    event.stopPropagation();
    node.attributes.splice(index, 1);
    this.editingAttrKey = null;
    this.nodeMoved.emit(node);
  }

  addMethod(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    if (!node.methods) node.methods = [];
    node.methods.push({ visibility: '+', name: 'newMethod', returnType: 'void' });
    this.editingMethodKey = `${node.id}_${node.methods.length - 1}`;
    this.nodeMoved.emit(node);
  }

  deleteMethod(event: MouseEvent, node: UMLNode, index: number): void {
    event.stopPropagation();
    node.methods.splice(index, 1);
    this.editingMethodKey = null;
    this.nodeMoved.emit(node);
  }

  changeZoom(delta: number): void {
    const container = document.querySelector('.canvas-container');
    if (container) this.zoomAt(this.zoomLevel + delta, container.clientWidth / 2, container.clientHeight / 2);
  }

  // Convierte la posición del mouse a coordenadas del diagrama
  private toCanvas(event: MouseEvent, container: Element | null): { x: number; y: number } {
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: (event.clientX - rect.left - this.panX) / this.zoomLevel,
      y: (event.clientY - rect.top - this.panY) / this.zoomLevel
    };
  }

  // Aplica el zoom dejando fijo el punto (cx, cy) de la pantalla
  private zoomAt(zoom: number, cx: number, cy: number): void {
    const newZoom = Math.max(this.readOnly ? 0.2 : 0.5, Math.min(2.0, zoom));
    const ratio = newZoom / this.zoomLevel;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.zoomLevel = newZoom;
  }

  fitToNodes(nodes: { positionX: number; positionY: number; width?: number; height?: number; attributes?: unknown[]; methods?: unknown[] }[]): void {
    if (!nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const rows = (node.attributes?.length || 0) + (node.methods?.length || 0);
      minX = Math.min(minX, node.positionX || 0);
      minY = Math.min(minY, node.positionY || 0);
      maxX = Math.max(maxX, (node.positionX || 0) + (node.width || 240));
      maxY = Math.max(maxY, (node.positionY || 0) + (node.height || 80 + rows * 20));
    }
    const container = document.querySelector('.canvas-container');
    const availableW = container ? container.clientWidth : window.innerWidth - 280;
    const availableH = container ? container.clientHeight : window.innerHeight - 80;
    const diagramW = Math.max(maxX - minX, 1);
    const diagramH = Math.max(maxY - minY, 1);
    const zoom = Math.min(availableW / (diagramW + 80), availableH / (diagramH + 80), 1);
    this.zoomLevel = Math.max(this.readOnly ? 0.2 : 0.5, Math.round(zoom * 100) / 100);
    this.centerOn({ x: minX + diagramW / 2, y: minY + diagramH / 2 });
  }

  // Deja el punto (x, y) del diagrama en el centro de la pantalla
  centerOn(point: { x: number; y: number }): void {
    const container = document.querySelector('.canvas-container');
    if (!container) return;
    this.panX = container.clientWidth / 2 - point.x * this.zoomLevel;
    this.panY = container.clientHeight / 2 - point.y * this.zoomLevel;
  }

  // Centro de la pantalla en coordenadas del diagrama
  getViewCenter(): { x: number; y: number } {
    const container = document.querySelector('.canvas-container');
    const width = container ? container.clientWidth : 0;
    const height = container ? container.clientHeight : 0;
    return {
      x: (width / 2 - this.panX) / this.zoomLevel,
      y: (height / 2 - this.panY) / this.zoomLevel
    };
  }

  resetPan(): void {
    this.panX = 0;
    this.panY = 0;
  }

  // La rueda acerca o aleja alrededor del mouse
  onWheel(event: WheelEvent): void {
    if ((event.target as HTMLElement).closest('.connector-modal, .connector-quick-panel')) return;
    event.preventDefault();
    const point = this.getPointerPosition(event, event.currentTarget as HTMLElement);
    this.zoomAt(this.zoomLevel * (event.deltaY < 0 ? 1.1 : 1 / 1.1), point.x, point.y);
  }

  private getPointerPosition(event: MouseEvent, container: HTMLElement): { x: number; y: number } {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  onPointerDown(event: PointerEvent): void {
    // En el editor solo se desplaza con clic izquierdo sobre el fondo
    const isBackgroundLeftClick = event.button === 0 && event.target === event.currentTarget;
    if (!this.readOnly && !isBackgroundLeftClick) return;
    if ((event.target as HTMLElement).closest('.minimap-wrapper, .status-bar')) return;
    this.panDistance = 0;
    const container = event.currentTarget as HTMLElement;
    container.setPointerCapture(event.pointerId);
    this.activePointers.set(event.pointerId, this.getPointerPosition(event, container));
  }

  // Un dedo desplaza la vista; dos dedos también hacen zoom
  onPointerMove(event: PointerEvent): void {
    const previous = this.activePointers.get(event.pointerId);
    if (!previous) return;
    const current = this.getPointerPosition(event, event.currentTarget as HTMLElement);
    this.activePointers.set(event.pointerId, current);

    if (this.activePointers.size === 1) {
      this.panX += current.x - previous.x;
      this.panY += current.y - previous.y;
      this.panDistance += Math.hypot(current.x - previous.x, current.y - previous.y);
      return;
    }

    const other = [...this.activePointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (this.activePointers.size !== 2 || !other) return;

    const previousDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
    const currentDistance = Math.hypot(current.x - other.x, current.y - other.y);
    const middleX = (current.x + other.x) / 2;
    const middleY = (current.y + other.y) / 2;
    this.panX += (current.x - previous.x) / 2;
    this.panY += (current.y - previous.y) / 2;
    if (previousDistance > 0) {
      this.zoomAt(this.zoomLevel * currentDistance / previousDistance, middleX, middleY);
    }
  }

  onPointerEnd(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId);
  }

  getNodeHeight(node: UMLNode | undefined): number {
    if (!node) return 160;
    const measured = this.nodeSizes.get(node.id)?.h;
    if (measured) return measured;
    // Respaldo antes de que la tarjeta se mida por primera vez
    const attrsCount = Math.max(1, node.attributes?.length || 0);
    const methodsCount = Math.max(1, node.methods?.length || 0);
    const calculatedH = 52 + 30 + (attrsCount * 26) + 30 + (methodsCount * 26) + 12;
    return Math.max(node.height || 160, calculatedH);
  }

  getNodeWidth(node: UMLNode | undefined): number {
    return (node && this.nodeSizes.get(node.id)?.w) || 230;
  }

  getConnectionFace(conn: UMLConnector, isTarget: boolean): 'top' | 'bottom' | 'left' | 'right' {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return 'top';

    const sourceW = this.getNodeWidth(source);
    const sourceH = this.getNodeHeight(source);
    const targetW = this.getNodeWidth(target);
    const targetH = this.getNodeHeight(target);

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        return isTarget ? 'left' : 'right';
      } else {
        return isTarget ? 'right' : 'left';
      }
    } else {
      if (dy >= 0) {
        return isTarget ? 'top' : 'bottom';
      } else {
        return isTarget ? 'bottom' : 'top';
      }
    }
  }

  getConnectorOffsetOnFace(conn: UMLConnector, isTarget: boolean): number {
    const nodeId = isTarget ? conn.targetNodeId : conn.sourceNodeId;
    if (!nodeId) return 0;
    const face = this.getConnectionFace(conn, isTarget);

    const sameFaceConns = (this.connectors || []).filter(c => {
      if (c.targetNodeId === nodeId && this.getConnectionFace(c, true) === face) return true;
      if (c.sourceNodeId === nodeId && this.getConnectionFace(c, false) === face) return true;
      return false;
    });

    if (sameFaceConns.length <= 1) return 0;

    sameFaceConns.sort((a, b) => {
      const otherIdA = a.targetNodeId === nodeId ? a.sourceNodeId : a.targetNodeId;
      const otherIdB = b.targetNodeId === nodeId ? b.sourceNodeId : b.targetNodeId;
      const nodeA = this.findNode(otherIdA);
      const nodeB = this.findNode(otherIdB);

      if (face === 'top' || face === 'bottom') {
        const coordA = nodeA ? nodeA.positionX + this.getNodeWidth(nodeA) / 2 : 0;
        const coordB = nodeB ? nodeB.positionX + this.getNodeWidth(nodeB) / 2 : 0;
        return coordA - coordB;
      } else {
        const coordA = nodeA ? nodeA.positionY + this.getNodeHeight(nodeA) / 2 : 0;
        const coordB = nodeB ? nodeB.positionY + this.getNodeHeight(nodeB) / 2 : 0;
        return coordA - coordB;
      }
    });

    const index = sameFaceConns.findIndex(c => c.id === conn.id);
    if (index === -1) return 0;

    const spacing = 36;
    return (index - (sameFaceConns.length - 1) / 2) * spacing;
  }

  getConnectorPath(conn: UMLConnector): string {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return '';

    const sourceW = this.getNodeWidth(source);
    const sourceH = this.getNodeHeight(source);
    const targetW = this.getNodeWidth(target);
    const targetH = this.getNodeHeight(target);

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    const srcOffset = this.getConnectorOffsetOnFace(conn, false);
    const tgtOffset = this.getConnectorOffsetOnFace(conn, true);

    let sx = scx;
    let sy = scy;
    let tx = tcx;
    let ty = tcy;

    let trimOffset = 0;
    if (conn.type === 'Aggregation' || conn.type === 'Composition') {
      trimOffset = 24;
    } else if (conn.type === 'Inheritance' || conn.type === 'Implementation') {
      trimOffset = 14;
    }

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Recorrido horizontal
      sx = dx >= 0 ? source.positionX + sourceW : source.positionX;
      sy = scy + srcOffset;
      const rawTx = dx >= 0 ? target.positionX : target.positionX + targetW;
      tx = dx >= 0 ? rawTx - trimOffset : rawTx + trimOffset;
      ty = tcy + tgtOffset;
      const c1x = sx + (tx - sx) / 2;
      return `M ${sx} ${sy} C ${c1x} ${sy}, ${c1x} ${ty}, ${tx} ${ty}`;
    } else {
      // Recorrido vertical
      sx = scx + srcOffset;
      sy = dy >= 0 ? source.positionY + sourceH : source.positionY;
      const rawTy = dy >= 0 ? target.positionY : target.positionY + targetH;
      tx = tcx + tgtOffset;
      ty = dy >= 0 ? rawTy - trimOffset : rawTy + trimOffset;
      const c1y = sy + (ty - sy) / 2;
      return `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c1y}, ${tx} ${ty}`;
    }
  }

  shouldShowSourceMultiplicity(conn: UMLConnector): boolean {
    if (!conn) return false;
    if (conn.type === 'Inheritance' || conn.type === 'Aggregation' || conn.type === 'Composition') {
      return !!(conn.sourceMultiplicity && conn.sourceMultiplicity.trim() !== '');
    }
    return conn.sourceMultiplicity !== '' && conn.sourceMultiplicity !== undefined && conn.sourceMultiplicity !== null;
  }

  shouldShowTargetMultiplicity(conn: UMLConnector): boolean {
    if (!conn) return false;
    if (conn.type === 'Inheritance' || conn.type === 'Aggregation' || conn.type === 'Composition') {
      return !!(conn.targetMultiplicity && conn.targetMultiplicity.trim() !== '');
    }
    return conn.targetMultiplicity !== '' && conn.targetMultiplicity !== undefined && conn.targetMultiplicity !== null;
  }

  isSelectedMultiplicity(conn: UMLConnector, type: 'source' | 'target'): boolean {
    return this.selectedMultiplicity?.connectorId === conn.id && this.selectedMultiplicity?.type === type;
  }

  selectMultiplicity(conn: UMLConnector, type: 'source' | 'target'): void {
    this.selectedMultiplicity = { connectorId: conn.id, type };
    this.selectedConnector = conn;
  }

  startDragMultiplicity(event: MouseEvent, conn: UMLConnector, type: 'source' | 'target'): void {
    event.stopPropagation();
    this.selectMultiplicity(conn, type);
    this.draggingMultiplicity = { connector: conn, type };
    this.multDragStartX = event.clientX;
    this.multDragStartY = event.clientY;

    if (type === 'source') {
      this.multInitialOffsetX = conn.sourceMultOffsetX || 0;
      this.multInitialOffsetY = conn.sourceMultOffsetY || 0;
    } else {
      this.multInitialOffsetX = conn.targetMultOffsetX || 0;
      this.multInitialOffsetY = conn.targetMultOffsetY || 0;
    }
  }

  getConnectorSourceAnchorX(conn: UMLConnector): number {
    const ep = this.getSourceEndpoint(conn);
    const tep = this.getTargetEndpoint(conn);
    const dx = tep.x - ep.x;
    const dy = tep.y - ep.y;
    const dist = Math.hypot(dx, dy) || 1;
    return ep.x + (dx / dist) * 20;
  }

  getConnectorSourceAnchorY(conn: UMLConnector): number {
    const ep = this.getSourceEndpoint(conn);
    const tep = this.getTargetEndpoint(conn);
    const dx = tep.x - ep.x;
    const dy = tep.y - ep.y;
    const dist = Math.hypot(dx, dy) || 1;
    return ep.y + (dy / dist) * 20;
  }

  getConnectorSourceX(conn: UMLConnector): number {
    const baseX = this.getConnectorSourceAnchorX(conn);
    return baseX + (conn.sourceMultOffsetX || 0);
  }

  getConnectorSourceY(conn: UMLConnector): number {
    const baseY = this.getConnectorSourceAnchorY(conn);
    return baseY + (conn.sourceMultOffsetY || 0);
  }

  getConnectorTargetAnchorX(conn: UMLConnector): number {
    const ep = this.getTargetEndpoint(conn);
    const sep = this.getSourceEndpoint(conn);
    const dx = sep.x - ep.x;
    const dy = sep.y - ep.y;
    const dist = Math.hypot(dx, dy) || 1;
    return ep.x + (dx / dist) * 25;
  }

  getConnectorTargetAnchorY(conn: UMLConnector): number {
    const ep = this.getTargetEndpoint(conn);
    const sep = this.getSourceEndpoint(conn);
    const dx = sep.x - ep.x;
    const dy = sep.y - ep.y;
    const dist = Math.hypot(dx, dy) || 1;
    return ep.y + (dy / dist) * 25;
  }

  getConnectorTargetX(conn: UMLConnector): number {
    const baseX = this.getConnectorTargetAnchorX(conn);
    return baseX + (conn.targetMultOffsetX || 0);
  }

  getConnectorTargetY(conn: UMLConnector): number {
    const baseY = this.getConnectorTargetAnchorY(conn);
    return baseY + (conn.targetMultOffsetY || 0);
  }

  getConnectorMidX(conn: UMLConnector): number {
    const sep = this.getSourceEndpoint(conn);
    const tep = this.getTargetEndpoint(conn);
    return (sep.x + tep.x) / 2;
  }

  getConnectorMidY(conn: UMLConnector): number {
    const sep = this.getSourceEndpoint(conn);
    const tep = this.getTargetEndpoint(conn);
    return (sep.y + tep.y) / 2;
  }

  getAssocClassNode(conn: UMLConnector): UMLNode | undefined {
    if (!conn) return undefined;

    // 1. Resolución directa por id
    if (conn.associationClassNodeId) {
      const node = this.findNode(conn.associationClassNodeId);
      if (node) return node;
    }

    // 2. Resolución por estereotipo y nombre (IA, importación de EA, recarga de la base)
    if (conn.type === 'AssociationClass' || conn.associationClassNodeId) {
      const source = this.findNode(conn.sourceNodeId);
      const target = this.findNode(conn.targetNodeId);

      if (source && target) {
        const name1 = `${source.name}_${target.name}`.toLowerCase();
        const name2 = `${target.name}_${source.name}`.toLowerCase();

        const match = this.nodes?.find(n => 
          n.stereotype === 'AssociationClass' && 
          (n.name?.toLowerCase() === name1 || n.name?.toLowerCase() === name2)
        );

        if (match) return match;
      }

      // Respaldo: cualquier nodo AssociationClass que haya en el lienzo
      const anyAssoc = this.nodes?.find(n => n.stereotype === 'AssociationClass');
      if (anyAssoc) return anyAssoc;
    }

    return undefined;
  }

  getAssocClassTopX(conn: UMLConnector): number {
    const node = this.getAssocClassNode(conn);
    if (!node) return this.getConnectorMidX(conn);
    return node.positionX + (node.width || 230) / 2;
  }

  getAssocClassTopY(conn: UMLConnector): number {
    const node = this.getAssocClassNode(conn);
    if (!node) return this.getConnectorMidY(conn);
    return node.positionY + this.getNodeHeight(node) / 2;
  }


  getSourceEndpoint(conn: UMLConnector): { x: number; y: number; angle: number } {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return { x: 0, y: 0, angle: 0 };

    const sourceW = this.getNodeWidth(source);
    const sourceH = this.getNodeHeight(source);
    const targetW = this.getNodeWidth(target);
    const targetH = this.getNodeHeight(target);

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    const srcOffset = this.getConnectorOffsetOnFace(conn, false);

    if (Math.abs(dx) >= Math.abs(dy)) {
      const ex = dx >= 0 ? source.positionX + sourceW : source.positionX;
      const ey = scy + srcOffset;
      const angle = dx >= 0 ? 0 : Math.PI;
      return { x: ex, y: ey, angle };
    } else {
      const ex = scx + srcOffset;
      const ey = dy >= 0 ? source.positionY + sourceH : source.positionY;
      const angle = dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
      return { x: ex, y: ey, angle };
    }
  }

  getTargetEndpoint(conn: UMLConnector): { x: number; y: number; angle: number } {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return { x: 0, y: 0, angle: 0 };

    const sourceW = this.getNodeWidth(source);
    const sourceH = this.getNodeHeight(source);
    const targetW = this.getNodeWidth(target);
    const targetH = this.getNodeHeight(target);

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    const tgtOffset = this.getConnectorOffsetOnFace(conn, true);

    if (Math.abs(dx) >= Math.abs(dy)) {
      const ex = dx >= 0 ? target.positionX : target.positionX + targetW;
      const ey = tcy + tgtOffset;
      const angle = dx >= 0 ? 0 : Math.PI;
      return { x: ex, y: ey, angle };
    } else {
      const ex = tcx + tgtOffset;
      const ey = dy >= 0 ? target.positionY : target.positionY + targetH;
      const angle = dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
      return { x: ex, y: ey, angle };
    }
  }

  getDiamondPoints(conn: UMLConnector): string {
    const ep = this.getTargetEndpoint(conn);
    const size = 12;
    const width = 7;

    const cos = Math.cos(ep.angle);
    const sin = Math.sin(ep.angle);

    const x0 = ep.x;
    const y0 = ep.y;

    const x1 = ep.x - size * cos + width * sin;
    const y1 = ep.y - size * sin - width * cos;

    const x2 = ep.x - (size * 2) * cos;
    const y2 = ep.y - (size * 2) * sin;

    const x3 = ep.x - size * cos - width * sin;
    const y3 = ep.y - size * sin + width * cos;

    return `${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  }

  getTrianglePoints(conn: UMLConnector): string {
    const ep = this.getTargetEndpoint(conn);
    const size = 14;
    const width = 8;

    const cos = Math.cos(ep.angle);
    const sin = Math.sin(ep.angle);

    const x0 = ep.x;
    const y0 = ep.y;

    const x1 = ep.x - size * cos + width * sin;
    const y1 = ep.y - size * sin - width * cos;

    const x2 = ep.x - size * cos - width * sin;
    const y2 = ep.y - size * sin + width * cos;

    return `${x0},${y0} ${x1},${y1} ${x2},${y2}`;
  }

  getMarkerEnd(type: string): string {
    return 'none';
  }

  getMarkerStart(type: string): string {
    return 'none';
  }
}
