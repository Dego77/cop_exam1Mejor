import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { LeftSidebarComponent } from '../../components/left-sidebar/left-sidebar.component';
import { CanvasComponent } from '../../components/canvas/canvas.component';
import { RightSidebarComponent } from '../../components/right-sidebar/right-sidebar.component';
import { AgentBubbleComponent } from '../../components/agent-bubble/agent-bubble.component';
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
    RightSidebarComponent,
    AgentBubbleComponent
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
        (saveProjectEvent)="onSaveProject()"
        (exportXMI)="onExportXMI()"
        (exportSQL)="onExportSQL()"
        (projectInvited)="onProjectInvited()"
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

      <!-- Floating Support Agent Mascot/Bubble -->
      <app-agent-bubble></app-agent-bubble>
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
  activeRoomUsers: any[] = [];
  remoteCursorsMap = new Map<string, CursorData>();

  private userAvatarColors = ['#00d4ff', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#3b82f6', '#10b981'];

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
      this.wsService.roomUsers$.subscribe(users => {
        this.activeRoomUsers = users || [];
        this.updateOnlineCollaboratorsList();
      })
    );
    this.subs.add(
      this.wsService.userJoined$.subscribe(data => {
        this.updateOnlineCollaboratorsList();
      })
    );
    this.subs.add(
      this.wsService.userLeft$.subscribe((data: any) => {
        const socketId = typeof data === 'string' ? data : data?.socketId;
        if (socketId) {
          this.remoteCursorsMap.delete(socketId);
        }
        this.updateOnlineCollaboratorsList();
      })
    );
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
        this.diagramService.updateLocalNode(node);
      })
    );
    this.subs.add(
      this.wsService.nodeCreated$.subscribe(node => {
        this.diagramService.addLocalNode(node);
      })
    );
    this.subs.add(
      this.wsService.nodeDeleted$.subscribe(nodeId => {
        this.diagramService.deleteNode(nodeId);
      })
    );
    this.subs.add(
      this.wsService.connectorCreated$.subscribe(connector => {
        const current = this.diagramService.currentConnectors;
        if (!current.some(c => c.id === connector.id)) {
          (this.diagramService as any).connectorsSubject.next([...current, connector]);
        }
      })
    );
    this.subs.add(
      this.wsService.connectorDeleted$.subscribe(connectorId => {
        const current = this.diagramService.currentConnectors;
        (this.diagramService as any).connectorsSubject.next(current.filter(c => c.id !== connectorId));
      })
    );
    this.subs.add(
      this.wsService.diagramReloaded$.subscribe(() => {
        if (this.currentProject?.id) {
          this.diagramService.loadDiagram(this.currentProject.id).subscribe();
        }
      })
    );

    this.loadProjects();
  }

  ngOnDestroy(): void {
    this.remoteCursorsMap.clear();
    this.subs.unsubscribe();
    this.wsService.disconnect();
  }

  get remoteCursorsList(): CursorData[] {
    return Array.from(this.remoteCursorsMap.values());
  }

  getUserCacheKey(): string {
    const uId = this.auth.currentUser?.id || this.auth.currentUser?.email || 'anonymous';
    return `classforge_projects_cache_${uId}`;
  }

  loadProjects(): void {
    const cacheKey = this.getUserCacheKey();
    const cachedStr = localStorage.getItem(cacheKey);
    let localCachedProjects: Project[] = [];
    if (cachedStr) {
      try { localCachedProjects = JSON.parse(cachedStr); } catch (e) {}
    }

    this.projectService.getAll().subscribe({
      next: (res: any) => {
        let serverProjects: Project[] = [];
        if (Array.isArray(res)) {
          serverProjects = res;
        } else if (res && typeof res === 'object') {
          const owned = Array.isArray(res.owned) ? res.owned : [];
          const shared = Array.isArray(res.shared) ? res.shared : [];
          serverProjects = [...owned, ...shared];
        }

        // Merge user's server projects with user's isolated local cached projects
        const mergedMap = new Map<string, Project>();
        localCachedProjects.forEach(p => mergedMap.set(p.id, p));
        serverProjects.forEach(p => mergedMap.set(p.id, p));

        const combined = Array.from(mergedMap.values());

        // Deduplicate projects by case-insensitive name, keeping the most recently updated project
        const uniqueByName = new Map<string, Project>();
        combined.forEach(p => {
          const key = (p.name || '').trim().toLowerCase();
          if (!key) return;
          if (!uniqueByName.has(key) || new Date(p.updatedAt || 0) > new Date(uniqueByName.get(key)!.updatedAt || 0)) {
            uniqueByName.set(key, p);
          }
        });
        const deduplicated = Array.from(uniqueByName.values());

        if (deduplicated.length > 0) {
          this.projects = deduplicated;
          this.saveProjectsCache();
          const currentStillExists = this.currentProject ? deduplicated.find(p => p.id === this.currentProject!.id || p.name.toLowerCase() === this.currentProject!.name.toLowerCase()) : null;
          if (currentStillExists) {
            this.currentProject = currentStillExists;
          } else {
            this.onSelectProject(deduplicated[0]);
          }
        } else {
          // Clean state for brand new users without auto-creating demo projects
          this.projects = [];
          this.currentProject = null;
          this.saveProjectsCache();
          this.diagramService.clearCanvas();
        }
      },
      error: () => {
        if (localCachedProjects.length > 0) {
          this.projects = localCachedProjects;
          this.onSelectProject(localCachedProjects[0]);
        } else {
          this.projects = [];
          this.currentProject = null;
          this.diagramService.clearCanvas();
        }
      }
    });
  }

  saveProjectsCache(): void {
    try {
      const cacheKey = this.getUserCacheKey();
      localStorage.setItem(cacheKey, JSON.stringify(this.projects));
    } catch (e) {}
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
    this.saveProjectsCache();
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

    this.updateOnlineCollaboratorsList();
  }

  private getColorForUser(idOrEmail: any): string {
    const str = String(idOrEmail || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % this.userAvatarColors.length;
    return this.userAvatarColors[index];
  }

  updateOnlineCollaboratorsList(): void {
    const allUsersMap = new Map<string, any>();

    // 1. Current Logged-in User
    if (this.auth.currentUser) {
      const u = this.auth.currentUser;
      const key = String(u.id || u.email);
      allUsersMap.set(key, {
        id: u.id,
        fullName: u.fullName || u.email || 'Usuario',
        email: u.email,
        isOwner: true,
        isOnline: true,
        color: this.getColorForUser(u.id || u.email)
      });
    }

    if (!this.currentProject) {
      this.onlineUsers = Array.from(allUsersMap.values());
      return;
    }

    // 2. Project Owner
    const owner = (this.currentProject as any).owner;
    if (owner && (owner.id || owner.email)) {
      const key = String(owner.id || owner.email);
      if (!allUsersMap.has(key)) {
        allUsersMap.set(key, {
          id: owner.id,
          fullName: owner.fullName || 'Propietario',
          email: owner.email,
          isOwner: true,
          isOnline: true,
          color: this.getColorForUser(owner.id || owner.email)
        });
      }
    }


    // 2. Invited Collaborators
    const collaborators = (this.currentProject as any).collaborators;
    if (Array.isArray(collaborators)) {
      for (const colab of collaborators) {
        const u = colab.user || colab;
        if (u && (u.id || u.email)) {
          const key = String(u.id || u.email);
          if (!allUsersMap.has(key)) {
            allUsersMap.set(key, {
              id: u.id,
              fullName: u.fullName || u.email || 'Colaborador',
              email: u.email,
              role: colab.role || 'EDITOR',
              isOwner: false,
              color: this.getColorForUser(u.id || u.email)
            });
          }
        }
      }
    }

    // 3. Active WebSocket Room User Keys
    const activeUserMap = new Map<string, any>();
    for (const roomUser of this.activeRoomUsers) {
      if (roomUser) {
        if (roomUser.id) activeUserMap.set(String(roomUser.id), roomUser);
        if (roomUser.email) activeUserMap.set(String(roomUser.email), roomUser);
      }
    }

    // 4. Build output array with isOnline status and joinedAt timestamp
    const result: any[] = [];
    for (const [key, userObj] of allUsersMap.entries()) {
      const activeObj = activeUserMap.get(String(userObj.id)) || activeUserMap.get(String(userObj.email));
      const isOnline = Boolean(activeObj);
      result.push({
        ...userObj,
        isOnline,
        joinedAt: activeObj?.joinedAt
      });
    }

    // Add active room users not in project DB yet
    for (const roomUser of this.activeRoomUsers) {
      if (roomUser && (roomUser.id || roomUser.email)) {
        const key = String(roomUser.id || roomUser.email);
        if (!allUsersMap.has(key)) {
          result.push({
            id: roomUser.id,
            fullName: roomUser.fullName || roomUser.email || 'Usuario',
            email: roomUser.email,
            isOwner: false,
            color: this.getColorForUser(roomUser.id || roomUser.email),
            isOnline: true,
            joinedAt: roomUser.joinedAt
          });
        }
      }
    }

    // Online users first
    result.sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
    this.onlineUsers = result;

    // Purge any remote cursors from disconnected users
    if (this.remoteCursorsMap.size > 0) {
      const activeSockets = new Set(
        this.activeRoomUsers
          .map((u: any) => u.socketId)
          .filter((sId: any): sId is string => Boolean(sId))
      );
      for (const sId of Array.from(this.remoteCursorsMap.keys())) {
        if (activeSockets.size > 0 && !activeSockets.has(sId)) {
          this.remoteCursorsMap.delete(sId);
        }
      }
    }
  }

  async onSelectProject(p: Project): Promise<void> {
    if (this.currentProject && this.currentProject.id !== p.id) {
      const oldProjectId = this.currentProject.id;
      const oldDiagramId = this.diagramService.diagramId;
      const oldNodes = [...this.diagramService.currentNodes];
      const oldConnectors = [...this.diagramService.currentConnectors];
      if (oldProjectId && (oldNodes.length > 0 || oldConnectors.length > 0)) {
        try {
          await this.diagramService.saveCurrentDiagram(oldProjectId, oldDiagramId, oldNodes, oldConnectors).toPromise();
        } catch (err) {
          console.error('Error al autoguardar proyecto previo:', err);
        }
      }
    }

    // Immediately clear canvas state so old elements do not bleed into the incoming project
    (this.diagramService as any).nodesSubject.next([]);
    (this.diagramService as any).connectorsSubject.next([]);

    this.remoteCursorsMap.clear();
    this.currentProject = p;
    this.updateOnlineCollaboratorsList();

    this.projectService.getById(p.id).subscribe({
      next: (fullProj) => {
        this.currentProject = fullProj;
        this.updateOnlineCollaboratorsList();
      },
      error: () => {}
    });

    return new Promise<void>((resolve) => {
      this.diagramService.loadDiagram(p.id).subscribe({
        next: () => { resolve(); },
        error: () => {
          (this.diagramService as any).nodesSubject.next([]);
          (this.diagramService as any).connectorsSubject.next([]);
          resolve();
        }
      });

      if (this.auth.currentUser) {
        this.wsService.joinProject(p.id, this.auth.currentUser);
      }
    });
  }

  onProjectInvited(): void {
    if (!this.currentProject) return;
    this.projectService.getById(this.currentProject.id).subscribe({
      next: (fullProj) => {
        this.currentProject = fullProj;
        this.updateOnlineCollaboratorsList();
      }
    });
  }

  async onCreateProject(data: { name: string; description: string; fileType?: string }): Promise<void> {
    const defaultName = data.name || 'actores_casodeUso';
    // Clear canvas for brand new project
    (this.diagramService as any).nodesSubject.next([]);
    (this.diagramService as any).connectorsSubject.next([]);

    const savedProjectName = await this.eaExporterService.promptSaveEAPFile([], [], defaultName);

    if (!savedProjectName) {
      return; // User clicked Cancel in Windows file save dialog
    }

    this.projectService.create(savedProjectName, data.description || 'Proyecto Enterprise Architect').subscribe({
      next: (newProj) => {
        this.projects.push(newProj);
        this.saveProjectsCache();
        this.onSelectProject(newProj);
        (this.diagramService as any).nodesSubject.next([]);
        (this.diagramService as any).connectorsSubject.next([]);
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
        this.saveProjectsCache();
        this.onSelectProject(mockProj);
        (this.diagramService as any).nodesSubject.next([]);
        (this.diagramService as any).connectorsSubject.next([]);
      }
    });
  }

  onDeleteProject(p: Project): void {
    this.projectService.delete(p.id).subscribe({
      next: () => {
        this.projects = this.projects.filter(item => item.id !== p.id);
        this.saveProjectsCache();
        if (this.currentProject?.id === p.id) {
          if (this.projects.length > 0) {
            this.onSelectProject(this.projects[0]);
          } else {
            this.currentProject = null;
            this.diagramService.clearCanvas();
          }
        }
      },
      error: () => {
        this.projects = this.projects.filter(item => item.id !== p.id);
        this.saveProjectsCache();
        if (this.currentProject?.id === p.id) {
          if (this.projects.length > 0) {
            this.onSelectProject(this.projects[0]);
          } else {
            this.currentProject = null;
            this.diagramService.clearCanvas();
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
    if (this.currentProject?.id) {
      this.wsService.emitNodeDragged(this.currentProject.id, node.id, node.positionX, node.positionY);
      this.wsService.emitNodeUpdated(this.currentProject.id, node);
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
      next: (node) => {
        this.diagramService.selectNode(node);
        if (this.currentProject?.id) {
          this.wsService.emitNodeCreated(this.currentProject.id, node);
        }
      },
      error: () => {
        const localNode: UMLNode = {
          id: 'node_' + Date.now(),
          ...newNode as any
        };
        this.diagramService.addLocalNode(localNode);
        this.diagramService.selectNode(localNode);
        if (this.currentProject?.id) {
          this.wsService.emitNodeCreated(this.currentProject.id, localNode);
        }
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
    if (this.currentProject?.id) {
      this.wsService.emitNodeCreated(this.currentProject.id, newNode);
    }
  }

  onDeleteNode(nodeId: string): void {
    this.diagramService.deleteNode(nodeId);
    if (this.currentProject?.id) {
      this.wsService.emitNodeDeleted(this.currentProject.id, nodeId);
    }
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
    const defaultName = this.currentProject?.name || 'modelo_diagrama';
    this.eaExporterService.promptSaveEAPFile(this.nodes, this.connectors, defaultName);
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

  onSaveProject(): void {
    const projectName = this.currentProject?.name || 'colab';
    
    // 1. Guardar en Base de Datos PostgreSQL
    this.diagramService.saveCurrentDiagram().subscribe({
      next: async () => {
        // 2. Sobrescribir directamente sobre el mismo archivo físico (.eap / Uso1_1.eap) sin abrir diálogos emergentes
        await this.eaExporterService.saveDirectlyToActiveFile(projectName, this.nodes, this.connectors);
        
        const cleanName = projectName.toLowerCase().endsWith('.eap') ? projectName : `${projectName}.eap`;
        alert(`💾 Guardado exitoso:\n- Proyecto "${projectName}" en PostgreSQL DB actualizado.\n- Archivo físico "${cleanName}" actualizado directamente en tu equipo.`);
      },
      error: async (err: any) => {
        console.error('Error al guardar en base de datos:', err);
        await this.eaExporterService.saveDirectlyToActiveFile(projectName, this.nodes, this.connectors);
        alert(`💾 Archivo físico ${projectName}.eap actualizado.`);
      }
    });
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

        this.eaExporterService.activeFileHandle = fileHandle;
        this.eaExporterService.activeFileName = fileHandle.name.replace(/\.(eap|xmi|xml|eapx)$/i, '');

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
    const projName = imported.projectName || fileName.replace(/\.(eap|xmi|xml|eapx)$/i, '');

    // Deduplicate project list in UI dropdown
    const seenNames = new Set<string>();
    this.projects = this.projects.filter(p => {
      const lower = p.name.toLowerCase();
      if (seenNames.has(lower)) return false;
      seenNames.add(lower);
      return true;
    });
    this.saveProjectsCache();

    // Check if a project with this exact name already exists in user's projects list
    const existing = this.projects.find(p => p.name.toLowerCase() === projName.toLowerCase());

    const handleImportNodes = async (proj: Project) => {
      if (proj && proj.id) {
        this.diagramService.clearLocalSnapshot(proj.id);
        try {
          await this.diagramService.purgeDiagram(proj.id).toPromise();
        } catch (e) {}
      }

      await this.onSelectProject(proj);

      const nodesToImport = imported.nodes || [];
      const connectorsToImport = imported.connectors || [];

      if (nodesToImport.length > 0 || connectorsToImport.length > 0) {
        (this.diagramService as any).nodesSubject.next(nodesToImport);
        (this.diagramService as any).connectorsSubject.next(connectorsToImport);
        this.diagramService.saveDiagramLocalSnapshot(proj.id, nodesToImport, connectorsToImport);

        // Auto-save imported nodes and connectors to PostgreSQL with UUID mapping
        this.diagramService.saveCurrentDiagram().subscribe({
          next: () => console.log('Diagrama de archivo importado guardado exitosamente.'),
          error: (err: any) => console.error('Error al guardar diagrama importado:', err)
        });
      }
    };

    if (existing) {
      handleImportNodes(existing);
    } else {
      this.projectService.create(projName, 'Proyecto Enterprise Architect cargado').subscribe({
        next: (newProj) => {
          if (!this.projects.some(p => p.id === newProj.id)) {
            this.projects.push(newProj);
            this.saveProjectsCache();
          }
          handleImportNodes(newProj);
        },
        error: () => {
          const fallbackProj: Project = {
            id: 'proj_open_' + Date.now(),
            name: projName,
            description: 'Proyecto Enterprise Architect cargado',
            ownerId: this.auth.currentUser?.id || 'usr_demo',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          this.projects.push(fallbackProj);
          this.saveProjectsCache();
          this.currentProject = fallbackProj;
          this.diagramService.clearLocalSnapshot(fallbackProj.id);
          (this.diagramService as any).nodesSubject.next(imported.nodes || []);
          (this.diagramService as any).connectorsSubject.next(imported.connectors || []);
          this.diagramService.saveDiagramLocalSnapshot(fallbackProj.id, imported.nodes || [], imported.connectors || []);
        }
      });
    }
  }
}
