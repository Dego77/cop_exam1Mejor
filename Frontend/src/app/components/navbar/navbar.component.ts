import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
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
            <img src="/assets/images/Logores.png" (error)="onLogoError($event)" alt="ClassForge Logo" class="brand-logo-img" />
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

        <!-- Toolbar cápsula de cristal unificada (Estilo IDE Pro / Imagen 2) -->
        <div class="action-pill-bar">
          <button 
            class="pill-btn" 
            [class.active-cyan]="activeAction === 'open'"
            (click)="selectAction('open', 'open')" 
            title="Abrir proyecto Enterprise Architect (*.eap)"
          >
            <svg class="pill-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="pill-label">Abrir</span>
          </button>

          <button 
            class="pill-btn" 
            [class.active-cyan]="activeAction === 'save'"
            (click)="selectAction('save', 'save')" 
            title="Guardar cambios del diagrama en la base de datos"
          >
            <svg class="pill-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span class="pill-label">Guardar</span>
          </button>

          <div class="pill-divider"></div>

          <button 
            class="pill-btn" 
            [class.active-cyan]="activeAction === 'json'"
            (click)="selectAction('json', 'json')" 
            title="Generar esquema JSON del diagrama"
          >
            <svg class="pill-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"></path>
              <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"></path>
            </svg>
            <span class="pill-label">Exportar JSON</span>
          </button>

          <button 
            class="pill-btn" 
            [class.active-cyan]="activeAction === 'backend'"
            (click)="selectAction('backend', 'backend')" 
            title="Generar y descargar Backend Spring Boot (.ZIP)"
          >
            <svg class="pill-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
            <span class="pill-label">Generar backend</span>
          </button>

          <div class="pill-divider"></div>

          <button 
            class="pill-btn icon-only" 
            [class.active-cyan]="activeAction === 'help'"
            (click)="selectAction('help', 'help')" 
            title="Ir a la interfaz de Ayuda"
          >
            <svg class="pill-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </button>
        </div>


          <div class="dropdown-menu" *ngIf="showProjectMenu">
            <div class="dropdown-header">MIS PROYECTOS</div>
            <div class="projects-list-container">
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
              class="avatar tooltip-wrapper" 
              *ngFor="let u of onlineUsers"
              [ngClass]="{'online-live': u.isOnline, 'offline-user': !u.isOnline}"
              [style.background]="u.color || '#00d4ff'"
              (click)="openUserPopover(u, $event)"
              style="cursor: pointer;"
              title="Haz clic para ver información y tiempo de trabajo"
            >
              {{ u.fullName?.charAt(0) || 'U' }}
              <span class="tooltip-text">
                {{ u.fullName }} {{ u.isOwner ? '(Dueño)' : '' }} - {{ u.isOnline ? '🟢 En vivo' : '⚪ Desconectado' }}
              </span>
            </div>
          </div>
          <button *ngIf="isOwner" class="btn btn-ghost btn-sm invite-btn" (click)="openInviteModal()" title="Invitar colaborador">
            <span>+ Invitar</span>
          </button>
        </div>
      </div>

      <!-- User Profile & Realtime Timer Popover Modal -->
      <div class="modal-backdrop" *ngIf="showUserPopover" (click)="closeUserPopover()">
        <div class="modal-card glass-panel user-profile-card" (click)="$event.stopPropagation()">
          <div class="ea-modal-header">
            <span>👤 Perfil de Colaborador</span>
            <button class="icon-btn text-muted" (click)="closeUserPopover()" style="border:none;background:none;cursor:pointer;font-size:16px;">✕</button>
          </div>
          
          <div class="user-popover-content">
            <div class="user-avatar-large" [style.background]="selectedUserObj?.color || '#00d4ff'">
              {{ selectedUserObj?.fullName?.charAt(0) || 'U' }}
            </div>

            <div class="user-info-details">
              <h3 class="user-info-name">
                {{ selectedUserObj?.fullName }}
                <span class="owner-badge" *ngIf="selectedUserObj?.isOwner">👑 Propietario</span>
                <span class="collab-badge" *ngIf="!selectedUserObj?.isOwner">👤 Colaborador</span>
              </h3>
              <p class="user-info-email">✉️ {{ selectedUserObj?.email || 'Sin correo público' }}</p>
              
              <div class="user-status-pill" [class.online]="selectedUserObj?.isOnline">
                <span class="status-dot"></span>
                <span>{{ selectedUserObj?.isOnline ? 'En vivo (Conectado)' : 'Desconectado' }}</span>
              </div>
            </div>

            <div class="realtime-timer-box">
              <span class="timer-label">⏱️ Tiempo activo en esta sesión:</span>
              <span class="timer-value">{{ liveTimeString }}</span>
            </div>

            <button class="btn btn-primary btn-block history-btn" (click)="openWorkHistoryModal(selectedUserObj)">
              📜 Ver Historial de Trabajo Completo
            </button>
          </div>
        </div>
      </div>

      <!-- Work Session History Modal -->
      <div class="modal-backdrop" *ngIf="showHistoryModal" (click)="closeHistoryModal()">
        <div class="modal-card glass-panel history-modal-card" (click)="$event.stopPropagation()">
          <div class="ea-modal-header">
            <span>📊 Historial de Sesiones de Trabajo — {{ selectedUserObj?.fullName }}</span>
            <button class="icon-btn text-muted" (click)="closeHistoryModal()" style="border:none;background:none;cursor:pointer;font-size:16px;">✕</button>
          </div>

          <div class="history-modal-body">
            <div class="history-summary-box">
              <div class="summary-item">
                <span class="sum-label">Horas Totales Trabajadas:</span>
                <span class="sum-val">{{ formatSeconds(historyTotalSeconds) }}</span>
              </div>
              <div class="summary-item">
                <span class="sum-label">Total de Sesiones:</span>
                <span class="sum-val">{{ historySessions.length }}</span>
              </div>
            </div>

            <div class="history-loading" *ngIf="isLoadingHistory">
              <span>⏳ Cargando historial de sesiones de PostgreSQL...</span>
            </div>

            <div class="history-table-container" *ngIf="!isLoadingHistory">
              <table class="history-table" *ngIf="historySessions.length > 0; else noHistory">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Hora Inicio</th>
                    <th>Hora Fin</th>
                    <th>Duración</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let s of historySessions">
                    <td>{{ s.startTime | date:'dd/MM/yyyy' }}</td>
                    <td>{{ s.startTime | date:'HH:mm:ss' }}</td>
                    <td>
                      <span *ngIf="s.endTime">{{ s.endTime | date:'HH:mm:ss' }}</span>
                      <span *ngIf="!s.endTime" class="badge-online">🟢 En curso</span>
                    </td>
                    <td>
                      <span class="duration-pill">{{ formatSessionDuration(s) }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <ng-template #noHistory>
                <div class="empty-history">
                  <span>ℹ️ No hay sesiones de trabajo registradas previamente para este usuario.</span>
                </div>
              </ng-template>
            </div>
          </div>

          <div class="ea-modal-footer">
            <button class="btn btn-ghost" (click)="closeHistoryModal()">Cerrar</button>
          </div>
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
              <span>Cerrar Sesión</span>
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
      overflow: hidden;
    }
    .brand-logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
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
    /* Toolbar Cápsula de Cristal Unificada (Imagen 1) */
    .action-pill-bar {
      display: inline-flex;
      align-items: center;
      background: rgba(10, 14, 26, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 3px 6px;
      margin-left: 12px;
      gap: 2px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(12px);
    }

    .pill-btn {
      background: transparent;
      border: none;
      outline: none;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }

    .pill-svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      flex-shrink: 0;
      transition: stroke 0.2s ease, transform 0.15s ease;
    }

    .pill-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #f1f5f9;
    }

    .pill-btn:hover .pill-svg {
      stroke: #f1f5f9;
    }

    /* Selección Dinámica Cyan Pill (Imagen 2) */
    .pill-btn.active-cyan,
    .pill-btn.active-cyan:hover {
      background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%) !important;
      color: #04202a !important;
      font-weight: 700 !important;
      box-shadow: 0 0 16px rgba(34, 211, 238, 0.4), 0 2px 8px rgba(6, 182, 212, 0.3) !important;
    }

    .pill-btn.active-cyan .pill-svg,
    .pill-btn.active-cyan:hover .pill-svg {
      stroke: #04202a !important;
    }

    .pill-btn.icon-only {
      padding: 6px 8px;
      border-radius: 50%;
    }

    .pill-divider {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.08);
      margin: 0 3px;
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
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 11px;
      color: #fff;
      position: relative;
      transition: all 0.25s ease;
      cursor: default;
    }
    .collab-avatars .avatar.online-live {
      border: 2px solid #22c55e;
      box-shadow: 0 0 10px rgba(34, 197, 94, 0.75);
      z-index: 2;
    }
    .collab-avatars .avatar.offline-user {
      border: 2px solid rgba(255, 255, 255, 0.25);
      opacity: 0.55;
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
    .projects-list-container {
      max-height: 250px;
      overflow-y: auto;
      padding-right: 2px;
    }
    .projects-list-container::-webkit-scrollbar {
      width: 5px;
    }
    .projects-list-container::-webkit-scrollbar-track {
      background: transparent;
    }
    .projects-list-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }
    .projects-list-container::-webkit-scrollbar-thumb:hover {
      background: #00d4ff;
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

    /* User Profile Popover & History Modal */
    .user-profile-card {
      width: 420px;
      padding: 20px;
      gap: 16px;
      box-shadow: 0 0 30px rgba(0, 212, 255, 0.25);
    }
    .user-popover-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      padding: 10px 0;
    }
    .user-avatar-large {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      box-shadow: 0 0 16px rgba(0, 212, 255, 0.4);
    }
    .user-info-details {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .user-info-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .owner-badge {
      font-size: 10px;
      background: rgba(255, 184, 0, 0.2);
      color: #ffb800;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255, 184, 0, 0.4);
    }
    .collab-badge {
      font-size: 10px;
      background: rgba(0, 212, 255, 0.15);
      color: var(--cyan);
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid rgba(0, 212, 255, 0.3);
    }
    .user-info-email {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .user-status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .user-status-pill.online {
      color: #10b981;
      font-weight: 600;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .user-status-pill.online .status-dot {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    .realtime-timer-box {
      width: 100%;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .timer-label {
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .timer-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px;
      font-weight: 800;
      color: var(--cyan);
      text-shadow: 0 0 10px rgba(0, 212, 255, 0.6);
    }
    .btn-block {
      width: 100%;
    }
    .history-modal-card {
      width: 600px;
      max-width: 90vw;
      padding: 20px;
    }
    .history-modal-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 10px;
    }
    .history-summary-box {
      display: flex;
      gap: 16px;
      background: rgba(0, 0, 0, 0.3);
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .summary-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sum-label {
      font-size: 11px;
      color: var(--text-muted);
    }
    .sum-val {
      font-size: 16px;
      font-weight: 700;
      color: var(--cyan);
    }
    .history-table-container {
      max-height: 280px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .history-table th {
      background: rgba(0, 0, 0, 0.4);
      padding: 8px 12px;
      text-align: left;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
    }
    .history-table td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      color: var(--text-primary);
    }
    .badge-online {
      color: #10b981;
      font-weight: 600;
    }
    .duration-pill {
      font-family: 'JetBrains Mono', monospace;
      color: var(--cyan);
    }
    .empty-history {
      padding: 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
    .history-loading {
      padding: 20px;
      text-align: center;
      color: var(--cyan);
      font-size: 13px;
    }
  `]
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Input() currentProject: Project | null = null;
  @Input() projects: Project[] = [];
  @Input() onlineUsers: any[] = [];
  @Output() selectProjectEvent = new EventEmitter<Project>();
  @Output() createProjectEvent = new EventEmitter<{ name: string; description: string; fileType?: string }>();
  @Output() deleteProjectEvent = new EventEmitter<Project>();
  @Output() openFileEvent = new EventEmitter<void>();
  @Output() saveProjectEvent = new EventEmitter<void>();
  @Output() exportXMI = new EventEmitter<void>();
  @Output() exportSQL = new EventEmitter<void>();
  @Output() exportJSON = new EventEmitter<void>();
  @Output() exportBackend = new EventEmitter<void>();
  @Output() projectInvited = new EventEmitter<void>();


  activeAction: string = 'backend';

  selectAction(action: string, trigger?: string): void {
    this.activeAction = action;
    if (trigger === 'open') this.openFileEvent.emit();
    else if (trigger === 'save') this.saveProjectEvent.emit();
    else if (trigger === 'json') this.exportJSON.emit();
    else if (trigger === 'backend') this.exportBackend.emit();
    else if (trigger === 'help') this.openHelpView();
  }

  onLogoError(event: any): void {
    const img = event.target as HTMLImageElement;
    if (img.src.endsWith('Logores.png')) {
      img.src = '/assets/images/logo.png';
    } else if (img.src.endsWith('logo.png')) {
      img.src = '/assets/images/logo.avif';
    } else if (img.src.endsWith('logo.avif')) {
      img.style.display = 'none';
      if (img.parentElement) {
        img.parentElement.innerHTML = '<span class="logo-icon">❖</span>';
      }
    }
  }

  showProjectMenu = false;

  showUserMenu = false;
  showNewModal = false;
  showInviteModal = false;

  selectedUserObj: any = null;
  showUserPopover = false;
  showHistoryModal = false;
  historySessions: any[] = [];
  historyTotalSeconds = 0;
  isLoadingHistory = false;
  liveTimeString = '00h 00m 00s';
  private timerInterval: any = null;

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

  get isOwner(): boolean {
    if (!this.currentProject || !this.currentUser) return true;
    const ownerId = (this.currentProject as any).ownerId || (this.currentProject as any).owner?.id;
    if (ownerId != null) {
      return String(ownerId) === String(this.currentUser.id);
    }
    return true;
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
        this.projectInvited.emit();
      },
      error: (err) => alert(err?.error?.error || 'Error al enviar invitación')
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  openUserPopover(u: any, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedUserObj = u;
    this.showUserPopover = true;
    this.startLiveTimer();
  }

  closeUserPopover(): void {
    this.showUserPopover = false;
    this.stopLiveTimer();
  }

  startLiveTimer(): void {
    this.stopLiveTimer();
    this.updateLiveTime();
    this.timerInterval = setInterval(() => {
      this.updateLiveTime();
    }, 1000);
  }

  stopLiveTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateLiveTime(): void {
    if (!this.selectedUserObj) {
      this.liveTimeString = '00h 00m 00s';
      return;
    }
    const joinedAtStr = this.selectedUserObj.joinedAt || (this.selectedUserObj.isOnline ? new Date().toISOString() : null);
    if (!joinedAtStr || !this.selectedUserObj.isOnline) {
      this.liveTimeString = 'Sesión no activa';
      return;
    }

    const start = new Date(joinedAtStr).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - start) / 1000));
    this.liveTimeString = this.formatSeconds(diffSec);
  }

  formatSeconds(totalSec: number): string {
    if (totalSec <= 0) return '00h 00m 00s';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
  }

  formatSessionDuration(s: any): string {
    if (s.duration != null) return this.formatSeconds(s.duration);
    if (!s.endTime && s.startTime) {
      const diff = Math.floor((Date.now() - new Date(s.startTime).getTime()) / 1000);
      return this.formatSeconds(Math.max(0, diff));
    }
    return '00h 00m 00s';
  }

  openWorkHistoryModal(u: any): void {
    if (!this.currentProject) return;
    this.showUserPopover = false;
    this.showHistoryModal = true;
    this.isLoadingHistory = true;
    this.historySessions = [];
    this.historyTotalSeconds = 0;

    const userId = u.id ? Number(u.id) : undefined;
    this.projectService.getWorkHistory(this.currentProject.id, userId).subscribe({
      next: (res) => {
        this.isLoadingHistory = false;
        this.historySessions = res.sessions || [];
        this.historyTotalSeconds = res.totalDurationSeconds || 0;
      },
      error: (err) => {
        this.isLoadingHistory = false;
        console.error('Error al cargar historial de trabajo:', err);
      }
    });
  }

  closeHistoryModal(): void {
    this.showHistoryModal = false;
  }

  openHelpView(): void {
    this.router.navigate(['/help']);
  }

  ngOnDestroy(): void {
    this.stopLiveTimer();
  }
}
