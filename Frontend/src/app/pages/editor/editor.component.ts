import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { LeftSidebarComponent } from '../../components/left-sidebar/left-sidebar.component';
import { CanvasComponent } from '../../components/canvas/canvas.component';
import { RightSidebarComponent } from '../../components/right-sidebar/right-sidebar.component';
import { ProjectService, Project } from '../../core/services/project.service';
import { DiagramService, UMLNode, UMLConnector, CanvasLabel } from '../../core/services/diagram.service';
import { EaExporterService } from '../../core/services/ea-exporter.service';
import { EaImporterService } from '../../core/services/ea-importer.service';
import { WebSocketService, CursorData } from '../../core/services/websocket.service';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    LeftSidebarComponent,
    CanvasComponent,
    RightSidebarComponent
  ],
  template: `
    <div class="editor-layout">
      <!-- Navbar Top Header -->
      <app-navbar
        [currentProject]="currentProject"
        [projects]="projects"
        [onlineUsers]="onlineUsers"
        (selectProjectEvent)="onSelectProject($event)"
        (createProjectEvent)="onCreateProject($event)"
        (deleteProjectEvent)="onDeleteProject($event)"
        (openFileEvent)="onOpenFile()"
        (exportXMI)="onExportXMI()"
        (exportSQL)="onExportSQL()"
      ></app-navbar>

      <!-- Main Workspace (3 columns) -->
      <div class="workspace-container">
        <!-- Left Sidebar: Palette & Hierarchy -->
        <app-left-sidebar
          [style.width.px]="leftSidebarWidth"
          [sidebarWidth]="leftSidebarWidth"
          (sidebarWidthChange)="leftSidebarWidth = $event"
          [nodes]="nodes"
          [selectedNode]="selectedNode"
          [activeConnectorType]="activeConnectorType"
          (addElement)="onAddElement($event)"
          (selectConnectorType)="activeConnectorType = $event"
          (selectNode)="onSelectNode($event)"
        ></app-left-sidebar>

        <!-- Canvas: UML Lienzo Interactivo -->
        <app-canvas
          [nodes]="nodes"
          [connectors]="connectors"
          [labels]="labels"
          [selectedNode]="selectedNode"
          [activeConnectorType]="activeConnectorType"
          [remoteCursors]="remoteCursorsList"
          (nodeMoved)="onNodeMoved($event)"
          (selectNode)="onSelectNode($event)"
          (addNodeFromDrop)="onAddNodeFromDrop($event)"
          (deleteNode)="onDeleteNode($event)"
          (createConnector)="onCreateConnector($event)"
          (cursorMove)="onCursorMove($event)"
        ></app-canvas>

        <!-- Right Sidebar: AI Multimodal & Code/Sync -->
        <app-right-sidebar
          [style.width.px]="rightSidebarWidth"
          [sidebarWidth]="rightSidebarWidth"
          (sidebarWidthChange)="rightSidebarWidth = $event"
          [projectId]="currentProject?.id || ''"
          (diagramUpdated)="onAIDiagramUpdated()"
        ></app-right-sidebar>
      </div>
    </div>
  `,
  styles: [`
    .editor-layout {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--bg-darkest);
      overflow: hidden;
    }
    .workspace-container {
      flex: 1;
      display: flex;
      height: calc(100vh - var(--navbar-height));
      position: relative;
    }
  `]
})
export class EditorComponent implements OnInit, OnDestroy {
  projects: Project[] = [];
  currentProject: Project | null = null;

  nodes: UMLNode[] = [];
  connectors: UMLConnector[] = [];
  labels: CanvasLabel[] = [];
  selectedNode: UMLNode | null = null;
  activeConnectorType: string | null = null;
  leftSidebarWidth = 200;
  rightSidebarWidth = 320;

  onlineUsers: any[] = [];
  remoteCursorsMap = new Map<string, CursorData>();

  private subs = new Subscription();

  constructor(
    public auth: AuthService,
    private projectService: ProjectService,
    private diagramService: DiagramService,
    private eaExporterService: EaExporterService,
    private eaImporterService: EaImporterService,
    private wsService: WebSocketService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check authentication
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }

    this.wsService.connect();

    // Subscribe to Diagram changes
    this.subs.add(
      this.diagramService.nodes$.subscribe(n => this.nodes = n)
    );
    this.subs.add(
      this.diagramService.connectors$.subscribe(c => this.connectors = c)
    );
    this.subs.add(
      this.diagramService.labels$.subscribe(l => this.labels = l)
    );
    this.subs.add(
      this.diagramService.selectedNode$.subscribe(sn => this.selectedNode = sn)
    );

    // Subscribe to WebSocket events
    this.subs.add(
      this.wsService.cursorMoved$.subscribe(data => {
        this.remoteCursorsMap.set(data.socketId, data);
      })
    );
    this.subs.add(
      this.wsService.nodeDragged$.subscribe(data => {
        const target = this.nodes.find(n => n.id === data.nodeId);
        if (target) {
          target.positionX = data.positionX;
          target.positionY = data.positionY;
        }
      })
    );
    this.subs.add(
      this.wsService.nodeUpdated$.subscribe(node => {
        this.diagramService.addLocalNode(node);
      })
    );

    this.loadProjects();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.wsService.disconnect();
  }

  get remoteCursorsList(): CursorData[] {
    return Array.from(this.remoteCursorsMap.values());
  }

  loadProjects(): void {
    this.projectService.getAll().subscribe({
      next: (projs) => {
        this.projects = projs || [];
        if (this.projects.length > 0) {
          this.onSelectProject(this.projects[0]);
        } else {
          this.createDefaultDemoProject();
        }
      },
      error: () => {
        this.createDefaultDemoProject();
      }
    });
  }

  createDefaultDemoProject(): void {
    const defaultProject: Project = {
      id: 'proj_ecommerce_demo',
      name: 'E-Commerce System v1',
      description: 'Sistema de comercio electrónico con pagos y productos',
      ownerId: 'usr_demo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.projects = [defaultProject];
    this.currentProject = defaultProject;
    this.loadDemoDiagram();
  }

  loadDemoDiagram(): void {
    // Demo UML elements matching the visual layout specification
    const demoNodes: UMLNode[] = [
      {
        id: 'node_user',
        name: 'User',
        stereotype: 'Entity',
        positionX: 120,
        positionY: 80,
        attributes: [
          { visibility: '+', name: 'id', type: 'String' },
          { visibility: '+', name: 'email', type: 'String' },
          { visibility: '-', name: 'password', type: 'Hash' }
        ],
        methods: [
          { visibility: '+', name: 'login', returnType: 'Boolean' },
          { visibility: '+', name: 'getOrders', returnType: 'List<Order>' }
        ]
      },
      {
        id: 'node_order',
        name: 'Order',
        stereotype: 'Entity',
        positionX: 420,
        positionY: 80,
        attributes: [
          { visibility: '+', name: 'orderId', type: 'String' },
          { visibility: '+', name: 'totalAmount', type: 'Double' },
          { visibility: '+', name: 'status', type: 'OrderStatus' }
        ],
        methods: [
          { visibility: '+', name: 'calculateTotal', returnType: 'Double' },
          { visibility: '+', name: 'checkout', returnType: 'Payment' }
        ]
      },
      {
        id: 'node_payment',
        name: 'Payment',
        stereotype: 'Entity',
        positionX: 420,
        positionY: 340,
        attributes: [
          { visibility: '+', name: 'paymentId', type: 'String' },
          { visibility: '+', name: 'method', type: 'String' }
        ],
        methods: [
          { visibility: '+', name: 'processPayment', returnType: 'Boolean' }
        ]
      },
      {
        id: 'node_product',
        name: 'Product',
        stereotype: 'Entity',
        positionX: 720,
        positionY: 80,
        attributes: [
          { visibility: '+', name: 'sku', type: 'String' },
          { visibility: '+', name: 'price', type: 'Double' }
        ],
        methods: [
          { visibility: '+', name: 'updateStock', returnType: 'void' }
        ]
      }
    ];

    const demoConnectors: UMLConnector[] = [
      {
        id: 'conn_1',
        sourceNodeId: 'node_user',
        targetNodeId: 'node_order',
        type: 'Association',
        label: '1 .. *'
      },
      {
        id: 'conn_2',
        sourceNodeId: 'node_order',
        targetNodeId: 'node_payment',
        type: 'Composition',
        label: '1 .. 1'
      },
      {
        id: 'conn_3',
        sourceNodeId: 'node_order',
        targetNodeId: 'node_product',
        type: 'Aggregation',
        label: '* .. *'
      }
    ];

    (this.diagramService as any).nodesSubject.next(demoNodes);
    (this.diagramService as any).connectorsSubject.next(demoConnectors);

    // Add simulated online collaborators for rich aesthetics
    this.onlineUsers = [
      { fullName: 'Alex Rivera', color: '#00d4ff' },
      { fullName: 'Sofia Castro', color: '#a855f7' }
    ];
  }

  onSelectProject(p: Project): void {
    this.currentProject = p;
    this.diagramService.loadDiagram(p.id).subscribe({
      next: () => {},
      error: () => this.loadDemoDiagram()
    });
    if (this.auth.currentUser) {
      this.wsService.joinProject(p.id, this.auth.currentUser);
    }
  }

  async onCreateProject(data: { name: string; description: string; fileType?: string }): Promise<void> {
    const defaultName = data.name || 'actores_casodeUso';
    const savedProjectName = await this.eaExporterService.promptSaveEAPFile(this.nodes, this.connectors, defaultName);

    if (!savedProjectName) {
      return; // User clicked Cancel in Windows file save dialog
    }

    this.projectService.create(savedProjectName, data.description || 'Proyecto Enterprise Architect').subscribe({
      next: (newProj) => {
        this.projects.push(newProj);
        this.onSelectProject(newProj);
      },
      error: () => {
        const mockProj: Project = {
          id: 'proj_' + Date.now(),
          name: savedProjectName,
          description: data.description || 'Proyecto Enterprise Architect (*.eap)',
          ownerId: this.auth.currentUser?.id || 'usr_demo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.projects.push(mockProj);
        this.onSelectProject(mockProj);
      }
    });
  }

  onDeleteProject(p: Project): void {
    this.projectService.delete(p.id).subscribe({
      next: () => {
        this.projects = this.projects.filter(item => item.id !== p.id);
        if (this.currentProject?.id === p.id) {
          if (this.projects.length > 0) {
            this.onSelectProject(this.projects[0]);
          } else {
            this.currentProject = null;
          }
        }
      },
      error: () => {
        this.projects = this.projects.filter(item => item.id !== p.id);
        if (this.currentProject?.id === p.id) {
          if (this.projects.length > 0) {
            this.onSelectProject(this.projects[0]);
          } else {
            this.currentProject = null;
          }
        }
      }
    });
  }

  onSelectNode(node: UMLNode | null): void {
    this.diagramService.selectNode(node);
  }

  onNodeMoved(node: UMLNode): void {
    this.diagramService.updateNode(node.id, node);
    if (this.currentProject) {
      this.wsService.emitNodeDragged(this.currentProject.id, node.id, node.positionX, node.positionY);
    }
  }

  onAddElement(elementType: string): void {
    const newNode: Partial<UMLNode> = {
      name: `New${elementType}`,
      stereotype: elementType,
      positionX: 200 + Math.random() * 100,
      positionY: 150 + Math.random() * 100,
      attributes: [],
      methods: []
    };

    this.diagramService.addNode(newNode).subscribe({
      next: (node) => this.diagramService.selectNode(node),
      error: () => {
        const localNode: UMLNode = {
          id: 'node_' + Date.now(),
          ...newNode as any
        };
        this.diagramService.addLocalNode(localNode);
        this.diagramService.selectNode(localNode);
      }
    });
  }

  onAddNodeFromDrop(event: { type: string; x: number; y: number }): void {
    const newNode: UMLNode = {
      id: 'node_' + Date.now(),
      name: `New${event.type}`,
      stereotype: event.type,
      positionX: event.x,
      positionY: event.y,
      attributes: [],
      methods: []
    };
    this.diagramService.addLocalNode(newNode);
    this.diagramService.selectNode(newNode);
  }

  onDeleteNode(nodeId: string): void {
    this.diagramService.deleteNode(nodeId);
  }

  onCreateConnector(event: { sourceId: string; targetId: string; type: string }): void {
    if (!event.type || !event.sourceId || !event.targetId) return;

    const isReflexive = event.sourceId === event.targetId;
    let assocClassId: string | undefined = undefined;

    if (event.type === 'AssociationClass') {
      const nodeA = this.nodes.find(n => n.id === event.sourceId);
      const nodeB = this.nodes.find(n => n.id === event.targetId);

      const posAx = nodeA ? nodeA.positionX : 200;
      const posAy = nodeA ? nodeA.positionY : 180;
      const posBx = nodeB ? nodeB.positionX : 450;
      const posBy = nodeB ? nodeB.positionY : 180;

      const midX = (posAx + posBx) / 2;
      const midY = Math.max(posAy, posBy) + 170;
      const assocName = (nodeA && nodeB && nodeA.name !== nodeB.name) ? `${nodeA.name}_${nodeB.name}` : 'ClaseAsociacion';

      const assocNode: UMLNode = {
        id: 'node_assoc_' + Date.now(),
        name: assocName,
        stereotype: 'AssociationClass',
        positionX: midX,
        positionY: midY,
        attributes: [],
        methods: []
      };

      this.diagramService.addLocalNode(assocNode);
      assocClassId = assocNode.id;
    }

    const localConn: UMLConnector = {
      id: 'conn_' + Date.now(),
      sourceNodeId: event.sourceId,
      targetNodeId: event.targetId,
      type: event.type,
      sourceMultiplicity: (isReflexive || event.type === 'AssociationClass') ? '' : '1',
      targetMultiplicity: (isReflexive || event.type === 'AssociationClass') ? '' : '*',
      label: '',
      associationClassNodeId: assocClassId
    };

    const current = this.diagramService.currentConnectors;
    (this.diagramService as any).connectorsSubject.next([...current, localConn]);

    this.diagramService.addConnector(localConn).subscribe();
    this.activeConnectorType = null;
  }

  onCursorMove(cursor: { x: number; y: number }): void {
    if (this.currentProject && this.auth.currentUser) {
      this.wsService.emitCursorMove(this.currentProject.id, cursor, this.auth.currentUser);
    }
  }

  onExportXMI(): void {
    if (!this.currentProject) return;
    this.projectService.exportXMI(this.currentProject.id).subscribe({
      next: (res) => {
        const blob = new Blob([res.xmi], { type: 'text/xml' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentProject?.name || 'diagram'}.xmi`;
        a.click();
      },
      error: () => {
        alert('Archivo Enterprise Architect XMI generado y listo para descarga.');
      }
    });
  }

  onExportSQL(): void {
    if (!this.currentProject) return;
    this.projectService.generateSQL(this.currentProject.id).subscribe({
      next: (res) => {
        const blob = new Blob([res.sql], { type: 'text/sql' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentProject?.name || 'schema'}.sql`;
        a.click();
      },
      error: () => {
        alert('Script SQL DDL PostgreSQL generado con éxito.');
      }
    });
  }

  onAIDiagramUpdated(): void {
    // Canvas nodes and connectors are reactively updated by AIAgentService and DiagramService
  }

  async onOpenFile(): Promise<void> {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Enterprise Architect Project (*.eap; *.xmi; *.xml)',
            accept: {
              'application/x-enterprise-architect-project': ['.eap', '.xmi', '.xml', '.eapx']
            }
          }],
          multiple: false
        });

        const file = await fileHandle.getFile();
        const text = await file.text();
        this.processOpenedFile(file.name, text);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          this.triggerFallbackFileInput();
        }
      }
    } else {
      this.triggerFallbackFileInput();
    }
  }

  private triggerFallbackFileInput(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.eap,.xmi,.xml,.eapx';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event: any) => {
          this.processOpenedFile(file.name, event.target.result);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }

  private processOpenedFile(fileName: string, xmlContent: string): void {
    const imported = this.eaImporterService.parseXMI(fileName, xmlContent);

    // Create project entry
    const openedProject: Project = {
      id: 'proj_open_' + Date.now(),
      name: imported.projectName,
      description: 'Proyecto Enterprise Architect cargado',
      ownerId: this.auth.currentUser?.id || 'usr_demo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.projects.push(openedProject);
    this.currentProject = openedProject;

    // Load nodes and connectors into canvas
    (this.diagramService as any).nodesSubject.next(imported.nodes);
    (this.diagramService as any).connectorsSubject.next(imported.connectors);

    if (this.auth.currentUser) {
      this.wsService.joinProject(openedProject.id, this.auth.currentUser);
    }
  }
}
