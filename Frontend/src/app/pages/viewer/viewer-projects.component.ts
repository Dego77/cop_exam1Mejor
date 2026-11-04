import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService, Project } from '../../core/services/project.service';

// "Modo Ver" (app móvil): lista de proyectos que el usuario posee o donde colabora, para abrirlos en solo lectura
@Component({
  selector: 'app-viewer-projects',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="viewer-projects">
      <header class="vp-header">
        <div class="vp-title">
          <span class="vp-brand">ClassForge</span>
          <span class="vp-badge">👁 Modo Ver</span>
        </div>
        <button class="vp-logout" (click)="logout()">Salir</button>
      </header>

      <p class="vp-hello" *ngIf="userName">Hola, <strong>{{ userName }}</strong>. Elige un proyecto para verlo en tiempo real.</p>

      <div class="vp-state" *ngIf="loading">Cargando proyectos...</div>
      <div class="vp-state vp-error" *ngIf="error">{{ error }}</div>

      <ng-container *ngIf="!loading && !error">
        <section>
          <h2 class="vp-section">Mis proyectos</h2>
          <div class="vp-empty" *ngIf="owned.length === 0">No tienes proyectos propios.</div>
          <button class="vp-card" *ngFor="let p of owned" (click)="open(p)">
            <span class="vp-card-name">{{ p.name }}</span>
            <span class="vp-card-meta">Propietario · {{ p.updatedAt | date:'dd/MM/yyyy HH:mm' }}</span>
          </button>
        </section>

        <section>
          <h2 class="vp-section">Compartidos conmigo</h2>
          <div class="vp-empty" *ngIf="shared.length === 0">Nadie te ha invitado a un proyecto todavía.</div>
          <button class="vp-card" *ngFor="let p of shared" (click)="open(p)">
            <span class="vp-card-name">{{ p.name }}</span>
            <span class="vp-card-meta">Colaborador · {{ p.updatedAt | date:'dd/MM/yyyy HH:mm' }}</span>
          </button>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bg-darkest);
      color: var(--text-primary);
    }
    .viewer-projects {
      max-width: 640px;
      margin: 0 auto;
      padding: 16px;
    }
    .vp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .vp-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vp-brand {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-bright);
    }
    .vp-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--cyan-glow);
      color: var(--cyan);
      border: 1px solid var(--border-active);
    }
    .vp-logout {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 6px 12px;
      cursor: pointer;
    }
    .vp-hello {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    .vp-section {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin: 18px 0 8px;
    }
    .vp-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      width: 100%;
      padding: 14px 16px;
      margin-bottom: 8px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
    }
    .vp-card:active,
    .vp-card:hover {
      border-color: var(--border-hover);
      background: var(--bg-card-hover);
    }
    .vp-card-name {
      font-size: 15px;
      font-weight: 600;
    }
    .vp-card-meta {
      font-size: 11px;
      color: var(--text-muted);
    }
    .vp-state,
    .vp-empty {
      font-size: 13px;
      color: var(--text-muted);
      padding: 8px 0;
    }
    .vp-error {
      color: var(--red);
    }
  `]
})
export class ViewerProjectsComponent implements OnInit {
  owned: Project[] = [];
  shared: Project[] = [];
  loading = true;
  error = '';
  userName = '';

  constructor(
    private auth: AuthService,
    private projectService: ProjectService,
    private router: Router
  ) { }

  ngOnInit(): void {
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/view' } });
      return;
    }
    this.userName = this.auth.currentUser?.fullName || '';

    this.projectService.getAll().subscribe({
      next: (res: any) => {
        this.loading = false;
        if (Array.isArray(res)) {
          this.owned = res;
        } else {
          this.owned = Array.isArray(res?.owned) ? res.owned : [];
          this.shared = Array.isArray(res?.shared) ? res.shared : [];
        }
      },
      error: () => {
        this.loading = false;
        this.error = 'No se pudieron cargar los proyectos.';
      }
    });
  }

  open(project: Project): void {
    this.router.navigate(['/view', project.id]);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login'], { queryParams: { returnUrl: '/view' } });
  }
}
