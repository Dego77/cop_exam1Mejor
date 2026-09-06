import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, User } from '../../core/services/auth.service';
import { ProjectService, Project } from '../../core/services/project.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="navbar">
      <div class="navbar-left">
        <div class="brand">
          <div class="brand-logo">
            <span class="logo-icon">❖</span>
          </div>
          <span class="brand-name">ClassForge</span>
          <span class="badge badge-cyan">UML v2.5</span>
        </div>

        <div class="project-selector-wrapper">
          <button class="btn btn-ghost project-btn" (click)="toggleProjectMenu()">
            <span class="project-icon">📁</span>
            <span class="project-title">{{ currentProject?.name || 'Seleccionar Proyecto...' }}</span>
            <span class="arrow-down">▼</span>
          </button>

        <button class="btn open-file-btn" (click)="openFileEvent.emit()" title="Abrir proyecto Enterprise Architect (*.eap)">
          <span>📂 Open File</span>
        </button>

          <div class="dropdown-menu" *ngIf="showProjectMenu">
            <div class="dropdown-header">MIS PROYECTOS</div>
            <div 
              class="dropdown-item project-item-row" 
              *ngFor="let p of projects" 
              [class.active]="p.id === currentProject?.id"
              (click)="selectProject(p)"
            >
              <div class="project-info">
                <span class="project-name">{{ p.name }}</span>
                <span class="item-desc" *ngIf="p.description">{{ p.description }}</span>
              </div>
              <button 
                class="btn-delete-project text-danger" 
                (click)="deleteProject($event, p)" 
                title="Eliminar Proyecto"
              >
                ✕
              </button>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item new-proj-item" (click)="openNewProjectModal()">
              <span>+ Crear Nuevo Proyecto</span>
            </button>
          </div>
        </div>
      </div>

      <div class="navbar-center">
        <div class="collaborators-bar">
          <span class="collab-label">En vivo:</span>
          <div class="collab-avatars">
            <div 
              class="avatar avatar-cyan tooltip-wrapper" 
              *ngFor="let u of onlineUsers"
              [style.background]="u.color || '#00d4ff'"
            >
              {{ u.fullName?.charAt(0) || 'U' }}
              <span class="tooltip-text">{{ u.fullName }} (Activo)</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm invite-btn" (click)="openInviteModal()">
            <span>+ Invitar</span>
          </button>
        </div>
      </div>

      <div class="navbar-right">
        <button class="btn btn-ghost" (click)="exportXMI.emit()" title="Exportar archivo Enterprise Architect XMI">
          <span>📦 Export XMI</span>
        </button>
        <button class="btn btn-violet" (click)="exportSQL.emit()" title="Generar script DDL PostgreSQL">
          <span>⚡ Generar SQL</span>
        </button>

        <div class="user-menu-wrapper">
          <button class="btn btn-ghost user-btn" (click)="toggleUserMenu()">
            <div class="avatar avatar-violet">
              {{ currentUser?.fullName?.charAt(0) || 'U' }}
            </div>
            <span class="user-name">{{ currentUser?.fullName }}</span>
          </button>

          <div class="dropdown-menu dropdown-right" *ngIf="showUserMenu">
            <div class="dropdown-header">{{ currentUser?.email }}</div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item text-danger" (click)="logout()">
              <span>🚪 Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </div>

      <!-- New Project Modal (Enterprise Architect Save As) -->
      <div class="modal-backdrop" *ngIf="showNewModal">
        <div class="modal-card glass-panel modal-ea-style">
          <div class="ea-modal-header">
            <span>❖ Guardar Proyecto Enterprise Architect</span>
            <button class="icon-btn-sm" (click)="showNewModal = false">✕</button>
          </div>

          <div class="modal-body-ea">
            <div class="form-group">
              <label>Nombre:</label>
              <input 
                type="text" 
                class="input-field-ea" 
                [(ngModel)]="newProjectName" 
                placeholder="Ej. actores_casodeUso" 
                autoFocus 
              />
            </div>

            <div class="form-group">
              <label>Tipo:</label>
              <select class="input-field-ea select-ea" [(ngModel)]="projectFileType">
                <option value="eap">Enterprise Architect Project (*.eap)</option>
                <option value="xmi">Enterprise Architect XML (*.xmi)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Descripción / Notas:</label>
              <textarea class="input-field-ea" [(ngModel)]="newProjectDesc" rows="2" placeholder="Notas del modelo UML..."></textarea>
            </div>
          </div>

          <div class="ea-modal-footer">
            <button class="btn btn-ghost" (click)="showNewModal = false">Cancelar</button>
            <button class="btn btn-primary" (click)="createProject()">Guardar</button>
          </div>
        </div>
      </div>

      <!-- Invite Modal -->
      <div class="modal-backdrop" *ngIf="showInviteModal">
        <div class="modal-card glass-panel">
          <h3>Invitar Colaborador</h3>
          <div class="form-group">
            <label>Correo Electrónico</label>
            <input type="email" class="input-field" [(ngModel)]="inviteEmail" placeholder="colaborador@ejemplo.com" />
          </div>
          <div class="form-group">
            <label>Rol</label>
            <select class="input-field" [(ngModel)]="inviteRole">
              <option value="editor">Editor (Lectura y Escritura)</option>
              <option value="viewer">Viewer (Sólo Lectura)</option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" (click)="showInviteModal = false">Cancelar</button>
            <button class="btn btn-primary" (click)="sendInvite()">Enviar Invitación</button>
          </div>
        </div>
      </div>
    </header>
  `,
  styles: [`
    .navbar {
      height: var(--navbar-height);
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 100;
      position: relative;
    }
    .navbar-left, .navbar-center, .navbar-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .brand-logo {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, var(--cyan), var(--violet));
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000;
      font-weight: bold;
      box-shadow: 0 0 12px var(--cyan-glow);
    }
    .brand-name {
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.5px;
      color: var(--text-bright);
    }
    .project-selector-wrapper, .user-menu-wrapper {
      position: relative;
    }
    .project-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .open-file-btn {
      background: #f59e0b !important;
      color: #0f172a !important;
      font-weight: 700 !important;
      border: 1px solid #d97706 !important;
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      margin-left: 8px;
    }
    .open-file-btn:hover {
      background: #fbbf24 !important;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    }
    .project-title {
      font-weight: 600;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .arrow-down {
      font-size: 8px;
      opacity: 0.6;
    }
    .collaborators-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-dark);
      padding: 4px 12px;
      border-radius: 99px;
      border: 1px solid var(--border);
    }
    .collab-label {
      font-size: 11px;
      color: var(--text-muted);
    }
    .collab-avatars {
      display: flex;
      margin-left: 4px;
    }
    .collab-avatars .avatar {
      margin-left: -6px;
    }
    .invite-btn {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 99px;
    }
    .user-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
    }
    .dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      width: 220px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      z-index: 200;
      padding: 6px 0;
    }
    .dropdown-right {
      left: auto;
      right: 0;
    }
    .dropdown-header {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .dropdown-item {
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-primary);
      transition: var(--transition);
      background: transparent;
      border: none;
      width: 100%;
      text-align: left;
    }
    .dropdown-item:hover {
      background: var(--bg-surface);
      color: var(--cyan);
    }
    .dropdown-item.active {
      color: var(--cyan);
      font-weight: 600;
    }
    .project-item-row {
      flex-direction: row !important;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .project-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .project-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn-delete-project {
      background: transparent;
      border: none;
      color: var(--red);
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.15s ease, opacity 0.15s ease;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .btn-delete-project:hover {
      opacity: 1;
      background: rgba(239, 68, 68, 0.25);
    }
    .new-proj-item {
      color: var(--cyan);
      font-weight: 600;
    }
    .dropdown-divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }
    .text-danger {
      color: var(--red);
    }
    .text-danger:hover {
      color: #ff6666;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-card {
      width: 400px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
    .modal-ea-style {
      width: 440px;
      padding: 18px;
      gap: 14px;
      box-shadow: var(--shadow-lg);
    }
    .ea-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 700;
      font-size: 13px;
      color: var(--cyan);
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    .modal-body-ea {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .input-field-ea {
      width: 100%;
      padding: 6px 10px;
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
    }
    .input-field-ea:focus {
      border-color: var(--cyan);
      outline: none;
    }
    .select-ea {
      cursor: pointer;
      color: var(--cyan);
      font-weight: 600;
    }
    .ea-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid var(--border);
      padding-top: 10px;
      margin-top: 4px;
    }
  `]
})
export class NavbarComponent implements OnInit {
  @Input() currentProject: Project | null = null;
  @Input() projects: Project[] = [];
  @Input() onlineUsers: any[] = [];
  @Output() selectProjectEvent = new EventEmitter<Project>();
  @Output() createProjectEvent = new EventEmitter<{ name: string; description: string; fileType?: string }>();
  @Output() deleteProjectEvent = new EventEmitter<Project>();
  @Output() openFileEvent = new EventEmitter<void>();
  @Output() exportXMI = new EventEmitter<void>();
  @Output() exportSQL = new EventEmitter<void>();

  showProjectMenu = false;
  showUserMenu = false;
  showNewModal = false;
  showInviteModal = false;

  newProjectName = '';
  newProjectDesc = '';
  projectFileType = 'eap';
  inviteEmail = '';
  inviteRole = 'editor';

  constructor(public auth: AuthService, private projectService: ProjectService, private router: Router) {}

  ngOnInit(): void {}

  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  toggleProjectMenu(): void {
    this.showProjectMenu = !this.showProjectMenu;
    this.showUserMenu = false;
  }

  toggleUserMenu(): void {
    this.showUserMenu = !this.showUserMenu;
    this.showProjectMenu = false;
  }

  selectProject(p: Project): void {
    this.selectProjectEvent.emit(p);
    this.showProjectMenu = false;
  }

  deleteProject(event: MouseEvent, p: Project): void {
    event.stopPropagation();
    if (confirm(`¿Estás seguro de que deseas eliminar el proyecto "${p.name}"?`)) {
      this.deleteProjectEvent.emit(p);
    }
  }

  openNewProjectModal(): void {
    this.showProjectMenu = false;
    this.createProjectEvent.emit({
      name: 'actores_casodeUso',
      description: '',
      fileType: 'eap'
    });
  }

  createProject(): void {
    if (!this.newProjectName.trim()) return;
    this.createProjectEvent.emit({
      name: this.newProjectName,
      description: this.newProjectDesc,
      fileType: this.projectFileType
    });
    this.newProjectName = '';
    this.newProjectDesc = '';
    this.showNewModal = false;
  }

  openInviteModal(): void {
    this.showInviteModal = true;
  }

  sendInvite(): void {
    if (!this.inviteEmail.trim() || !this.currentProject) return;
    this.projectService.addCollaborator(this.currentProject.id, this.inviteEmail, this.inviteRole).subscribe({
      next: () => {
        alert(`Invitación enviada a ${this.inviteEmail}`);
        this.inviteEmail = '';
        this.showInviteModal = false;
      },
      error: () => alert('Error al enviar invitación')
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
