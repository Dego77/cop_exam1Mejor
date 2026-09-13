import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
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
      (dragover)="onDragOver($event)"
      (drop)="onDrop($event)"
      (mousemove)="onMouseMove($event)"
      (click)="onCanvasClick($event)"
      (dblclick)="onCanvasDblClick($event)"
    >
      <!-- Unified Canvas Viewport (Scales SVG Connectors, Nodes, Labels & Cursors 1:1) -->
      <div 
        class="canvas-viewport"
        [style.transform]="'scale(' + zoomLevel + ')'"
        [style.transform-origin]="'0 0'"
      >
        <!-- SVG Connectors Layer (z-index: 25) -->
        <svg class="svg-layer">
        <defs>
          <!-- Association / Dependency Arrow -->
          <marker id="arrow" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="10" markerHeight="10" orient="auto">
            <path d="M 1 1 L 13 7 L 1 13" fill="none" stroke="#00d4ff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
          </marker>
          <!-- Inheritance Triangle -->
          <marker id="inheritance" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="12" markerHeight="12" orient="auto">
            <path d="M 1 1 L 13 7 L 1 13 Z" fill="#ffffff" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
          <!-- Composition Solid Diamond -->
          <marker id="composition" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="14" markerHeight="14" orient="auto">
            <path d="M 1 8 L 8 1 L 15 8 L 8 15 Z" fill="#000000" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
          <!-- Aggregation Hollow White Diamond (Image 2 style) -->
          <marker id="aggregation" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="14" markerHeight="14" orient="auto">
            <path d="M 1 8 L 8 1 L 15 8 L 8 15 Z" fill="#ffffff" stroke="#00d4ff" stroke-width="2" stroke-linejoin="miter" />
          </marker>
        </defs>

        <!-- Render Connectors -->
        <g *ngFor="let conn of connectors">
          <!-- Standard Non-Reflexive Connectors -->
          <ng-container *ngIf="!isReflexive(conn)">
            <!-- Invisible 16px Hitbox Path for Super Easy Line Clicking -->
            <path 
              [attr.d]="getConnectorPath(conn)" 
              class="connector-hitbox"
              (click)="onConnectorClick($event, conn)"
              (dblclick)="onConnectorClick($event, conn)"
            />

            <!-- Visible Connector Line Path -->
            <path 
              [attr.d]="getConnectorPath(conn)" 
              class="connector-line"
              [class.selected]="selectedConnector?.id === conn.id || editingConnector?.id === conn.id"
              [attr.stroke-dasharray]="(conn.type === 'Implementation' || conn.type === 'Dependency') ? '6 4' : 'none'"
              (click)="onConnectorClick($event, conn)"
              (dblclick)="onConnectorClick($event, conn)"
            />

            <!-- Direct SVG Aggregation Hollow White Diamond Shape -->
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

            <!-- Direct SVG Composition Solid Black Diamond Shape -->
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

            <!-- Direct SVG Inheritance / Implementation Triangle Shape -->
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

            <!-- Source Multiplicity (Near Source Class) -->
            <g *ngIf="shouldShowSourceMultiplicity(conn)">
              <!-- Enterprise Architect Dashed Guide Line (ONLY WHEN SELECTED) -->
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

              <!-- Multiplicity Text -->
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

              <!-- Enterprise Architect 4 Corner Selection Handle Box -->
              <g *ngIf="isSelectedMultiplicity(conn, 'source')">
                <rect [attr.x]="getConnectorSourceX(conn) - 12" [attr.y]="getConnectorSourceY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) + 12" [attr.y]="getConnectorSourceY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) - 12" [attr.y]="getConnectorSourceY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorSourceX(conn) + 12" [attr.y]="getConnectorSourceY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Target Multiplicity (Near Target Class) -->
            <g *ngIf="shouldShowTargetMultiplicity(conn)">
              <!-- Enterprise Architect Dashed Guide Line (ONLY WHEN SELECTED) -->
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

              <!-- Multiplicity Text -->
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

              <!-- Enterprise Architect 4 Corner Selection Handle Box -->
              <g *ngIf="isSelectedMultiplicity(conn, 'target')">
                <rect [attr.x]="getConnectorTargetX(conn) - 12" [attr.y]="getConnectorTargetY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) + 12" [attr.y]="getConnectorTargetY(conn) - 22" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) - 12" [attr.y]="getConnectorTargetY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getConnectorTargetX(conn) + 12" [attr.y]="getConnectorTargetY(conn) - 2"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Relationship Label / Name (Center) -->
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

            <!-- Association Class Dashed Connecting Line -->
            <line 
              *ngIf="conn.associationClassNodeId"
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

          <!-- Reflexive / Self Association Loop Connectors -->
          <ng-container *ngIf="conn.sourceNodeId === conn.targetNodeId">
            <!-- Hitbox -->
            <path 
              [attr.d]="getReflexivePath(conn)" 
              class="connector-hitbox"
              (click)="onConnectorClick($event, conn)"
              (mousedown)="startDragLoopBox($event, conn)"
            />

            <!-- Visible Reflexive Loop Line -->
            <path 
              [attr.d]="getReflexivePath(conn)" 
              class="connector-line"
              [class.selected]="selectedConnector?.id === conn.id || editingConnector?.id === conn.id"
              [attr.stroke-dasharray]="(conn.type === 'Implementation' || conn.type === 'Dependency') ? '6 4' : 'none'"
              style="cursor: move; pointer-events: all; stroke-width: 2.5px; filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));"
              (click)="onConnectorClick($event, conn)"
              (mousedown)="startDragLoopBox($event, conn)"
            />

            <!-- Reflexive Loop Target Multiplicity -->
            <g *ngIf="conn.targetMultiplicity">
              <!-- Enterprise Architect Dashed Guide Line (ONLY WHEN SELECTED) -->
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

              <!-- Enterprise Architect 4 Corner Selection Handle Box -->
              <g *ngIf="isSelectedMultiplicity(conn, 'target')">
                <rect [attr.x]="getReflexiveTargetMultX(conn) - 12" [attr.y]="getReflexiveTargetMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) + 12" [attr.y]="getReflexiveTargetMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) - 12" [attr.y]="getReflexiveTargetMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveTargetMultX(conn) + 12" [attr.y]="getReflexiveTargetMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- Reflexive Loop Source Multiplicity -->
            <g *ngIf="conn.sourceMultiplicity">
              <!-- Enterprise Architect Dashed Guide Line (ONLY WHEN SELECTED) -->
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

              <!-- Enterprise Architect 4 Corner Selection Handle Box -->
              <g *ngIf="isSelectedMultiplicity(conn, 'source')">
                <rect [attr.x]="getReflexiveSourceMultX(conn) - 12" [attr.y]="getReflexiveSourceMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) + 12" [attr.y]="getReflexiveSourceMultY(conn) - 14" width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) - 12" [attr.y]="getReflexiveSourceMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
                <rect [attr.x]="getReflexiveSourceMultX(conn) + 12" [attr.y]="getReflexiveSourceMultY(conn) + 6"  width="5" height="5" fill="#00d4ff" stroke="#000" stroke-width="0.5" />
              </g>
            </g>

            <!-- 4 Corner Interactive Handles when Selected/Editing -->
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

      <!-- UML Class Nodes Layer (z-index: 20) -->
      <div class="nodes-layer">
        <div 
          *ngFor="let node of nodes" 
          class="uml-card glass-panel"
          [class.selected]="selectedNode?.id === node.id"
          [class.connecting-source]="connectingSourceId === node.id"
          [style.left.px]="node.positionX"
          [style.top.px]="node.positionY"
          (mousedown)="startDragNode($event, node)"
          (click)="onNodeClick($event, node)"
          (dblclick)="onNodeDblClick($event, node)"
        >
          <!-- Stereotype & Class Header -->
          <div class="card-header">
            <span class="stereotype">«{{ node.stereotype || 'Entity' }}»</span>
            <div class="header-name-row">
              <span 
                *ngIf="editingNodeId !== node.id" 
                class="class-name editable-title" 
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

          <!-- Attributes Divider & List -->
          <div class="card-section">
            <div class="section-header">
              <span>Atributos</span>
              <button class="icon-btn-sm" (click)="addAttribute($event, node)" title="Añadir atributo">+</button>
            </div>
            
            <div *ngFor="let attr of node.attributes; let i = index">
              <!-- View Mode -->
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

              <!-- Edit Mode -->
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

          <!-- Methods Divider & List -->
          <div class="card-section">
            <div class="section-header">
              <span>Métodos</span>
              <button class="icon-btn-sm" (click)="addMethod($event, node)" title="Añadir método">+</button>
            </div>

            <div *ngFor="let m of node.methods; let i = index">
              <!-- View Mode -->
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

              <!-- Edit Mode -->
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

        <!-- Canvas Free-Text Labels / Notes Layer (z-index: 22) -->
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

        <!-- Live Collaborator Cursors Overlay -->
        <div 
          class="remote-cursor" 
          *ngFor="let c of remoteCursors"
          [style.left.px]="c.cursor.x"
          [style.top.px]="c.cursor.y"
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

      <!-- Connector Multiplicity Editor Floating Popup Modal (z-index: 200) -->
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
          <!-- Source Multiplicity -->
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

          <!-- Target Multiplicity -->
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

          <!-- Connector Type -->
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

          <!-- Relationship Label -->
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

      <!-- Persistent Top-Right Connector Quick Control Panel -->
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

      <!-- Navigation Minimap Overlay Widget -->
      <app-minimap
        [nodes]="nodes"
        [connectors]="connectors"
        [remoteCursors]="remoteCursors"
        [zoomLevel]="zoomLevel"
      ></app-minimap>

      <!-- Bottom Status & Control Bar -->
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
export class CanvasComponent {
  @Input() nodes: UMLNode[] = [];
  @Input() connectors: UMLConnector[] = [];
  @Input() labels: CanvasLabel[] = [];
  @Input() selectedNode: UMLNode | null = null;
  @Input() activeConnectorType: string | null = null;
  @Input() remoteCursors: any[] = [];

  @Output() nodeMoved = new EventEmitter<UMLNode>();
  @Output() selectNode = new EventEmitter<UMLNode | null>();
  @Output() addNodeFromDrop = new EventEmitter<{ type: string; x: number; y: number }>();
  @Output() deleteNode = new EventEmitter<string>();
  @Output() createConnector = new EventEmitter<{ sourceId: string; targetId: string; type: string }>();
  @Output() cursorMove = new EventEmitter<{ x: number; y: number }>();

  showGrid = true;
  zoomLevel = 1.0;
  Math = Math;

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

  multOptions = ['+1', '+*', '+0..1', '+1..*', '1', '0..1', '1..*', '0..*', '*', '1..1'];
  dataTypeOptions = ['Int', 'String', 'Double', 'Bool', 'Date', 'Char', 'Long', 'Arrays'];

  // Reflexive Loop drag & resize properties
  draggingLoopConn: UMLConnector | null = null;
  resizingLoopConn: UMLConnector | null = null;
  resizeCorner: string | null = null;
  loopStartX = 0;
  loopStartY = 0;
  loopInitialW = 90;
  loopInitialH = 130;
  loopInitialOX = -50;
  loopInitialOY = 30;

  // Multiplicity Dragging Properties (Enterprise Architect Style)
  selectedMultiplicity: { connectorId: string; type: 'source' | 'target' } | null = null;
  draggingMultiplicity: { connector: UMLConnector; type: 'source' | 'target' } | null = null;
  multDragStartX = 0;
  multDragStartY = 0;
  multInitialOffsetX = 0;
  multInitialOffsetY = 0;

  constructor(public diagramService: DiagramService) {}

  onCanvasDblClick(event: MouseEvent): void {
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
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(20, (event.clientX - rect.left) / this.zoomLevel);
    const y = Math.max(20, (event.clientY - rect.top) / this.zoomLevel);

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

    const container = (event.currentTarget as HTMLElement).closest('.canvas-container');
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
    const mouseCanvasX = (event.clientX - rect.left) / this.zoomLevel;
    const mouseCanvasY = (event.clientY - rect.top) / this.zoomLevel;

    this.labelDragOffsetX = mouseCanvasX - label.positionX;
    this.labelDragOffsetY = mouseCanvasY - label.positionY;
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

    // Anchor top-right corner of loop box to bottom-left corner of node (like reference image)
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
    // Closed 4-sided rectangle
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
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseCanvasX = (event.clientX - rect.left) / this.zoomLevel;
    const mouseCanvasY = (event.clientY - rect.top) / this.zoomLevel;
    this.cursorMove.emit({ x: mouseCanvasX, y: mouseCanvasY });

    if (this.draggingNode) {
      this.draggingNode.positionX = Math.max(0, mouseCanvasX - this.dragOffsetX);
      this.draggingNode.positionY = Math.max(0, mouseCanvasY - this.dragOffsetY);
    }

    if (this.draggingLabel) {
      this.draggingLabel.positionX = Math.max(0, mouseCanvasX - this.labelDragOffsetX);
      this.draggingLabel.positionY = Math.max(0, mouseCanvasY - this.labelDragOffsetY);
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

    const container = (event.currentTarget as HTMLElement).closest('.canvas-container');
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
    const mouseCanvasX = (event.clientX - rect.left) / this.zoomLevel;
    const mouseCanvasY = (event.clientY - rect.top) / this.zoomLevel;

    this.dragOffsetX = mouseCanvasX - node.positionX;
    this.dragOffsetY = mouseCanvasY - node.positionY;
  }

  onNodeClick(event: MouseEvent, node: UMLNode): void {
    event.stopPropagation();
    if (this.activeConnectorType) {
      if (!this.connectingSourceId) {
        this.connectingSourceId = node.id;
      } else if (this.connectingSourceId === node.id) {
        // Second click on SAME node: CREATE REFLEXIVE ASSOCIATION
        const connType = this.activeConnectorType;
        this.connectingSourceId = null;
        this.createConnector.emit({
          sourceId: node.id,
          targetId: node.id,
          type: connType
        });
      } else {
        // Click on DIFFERENT node: CREATE CONNECTOR A -> B
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
    const type = event.dataTransfer?.getData('text/plain');
    if (type) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
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
    this.zoomLevel = Math.max(0.5, Math.min(2.0, this.zoomLevel + delta));
  }

  getConnectorPath(conn: UMLConnector): string {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return '';

    const sourceW = source.width || 230;
    const sourceH = source.height || 160;
    const targetW = target.width || 230;
    const targetH = target.height || 160;

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

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
      // Horizontal routing
      sx = dx >= 0 ? source.positionX + sourceW : source.positionX;
      sy = scy;
      const rawTx = dx >= 0 ? target.positionX : target.positionX + targetW;
      tx = dx >= 0 ? rawTx - trimOffset : rawTx + trimOffset;
      ty = tcy;
      const c1x = sx + (tx - sx) / 2;
      return `M ${sx} ${sy} C ${c1x} ${sy}, ${c1x} ${ty}, ${tx} ${ty}`;
    } else {
      // Vertical routing
      sx = scx;
      sy = dy >= 0 ? source.positionY + sourceH : source.positionY;
      const rawTy = dy >= 0 ? target.positionY : target.positionY + targetH;
      tx = tcx;
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

  getAssocClassTopX(conn: UMLConnector): number {
    if (!conn.associationClassNodeId) return 0;
    const node = this.findNode(conn.associationClassNodeId);
    if (!node) return 0;
    return node.positionX + (node.width || 230) / 2;
  }

  getAssocClassTopY(conn: UMLConnector): number {
    if (!conn.associationClassNodeId) return 0;
    const node = this.findNode(conn.associationClassNodeId);
    if (!node) return 0;
    return node.positionY + (node.height || 160) / 2;
  }

  getSourceEndpoint(conn: UMLConnector): { x: number; y: number; angle: number } {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return { x: 0, y: 0, angle: 0 };

    const sourceW = source.width || 230;
    const sourceH = source.height || 160;
    const targetW = target.width || 230;
    const targetH = target.height || 160;

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const ex = dx >= 0 ? source.positionX + sourceW : source.positionX;
      const ey = scy;
      const angle = dx >= 0 ? 0 : Math.PI;
      return { x: ex, y: ey, angle };
    } else {
      const ex = scx;
      const ey = dy >= 0 ? source.positionY + sourceH : source.positionY;
      const angle = dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
      return { x: ex, y: ey, angle };
    }
  }

  getTargetEndpoint(conn: UMLConnector): { x: number; y: number; angle: number } {
    const source = this.findNode(conn.sourceNodeId);
    const target = this.findNode(conn.targetNodeId);
    if (!source || !target) return { x: 0, y: 0, angle: 0 };

    const sourceW = source.width || 230;
    const sourceH = source.height || 160;
    const targetW = target.width || 230;
    const targetH = target.height || 160;

    const scx = source.positionX + sourceW / 2;
    const scy = source.positionY + sourceH / 2;
    const tcx = target.positionX + targetW / 2;
    const tcy = target.positionY + targetH / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const ex = dx >= 0 ? target.positionX : target.positionX + targetW;
      const ey = tcy;
      const angle = dx >= 0 ? 0 : Math.PI;
      return { x: ex, y: ey, angle };
    } else {
      const ex = tcx;
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
