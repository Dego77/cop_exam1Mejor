import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-page">
      <!-- Background Ambient Neon Glows -->
      <div class="bg-glow glow-cyan"></div>
      <div class="bg-glow glow-violet"></div>

      <div class="login-card glass-panel animate-fade-in">
        <div class="card-brand">
          <div class="brand-logo">
            <span>❖</span>
          </div>
          <h2>ClassForge</h2>
          <p class="brand-sub">Modelado UML 2.5 Colaborativo & Agente IA Multimodal</p>
        </div>

        <div class="tab-group mode-tabs">
          <button 
            class="tab-btn" 
            [class.active]="isLogin"
            (click)="isLogin = true"
          >
            Iniciar Sesión
          </button>
          <button 
            class="tab-btn" 
            [class.active]="!isLogin"
            (click)="isLogin = false"
          >
            Registrarse
          </button>
        </div>

        <form (ngSubmit)="onSubmit()" class="login-form">
          <div class="form-group" *ngIf="!isLogin">
            <label>Nombre Completo</label>
            <input 
              type="text" 
              class="input-field" 
              [(ngModel)]="fullName" 
              name="fullName" 
              placeholder="Ej. Alex Rivera" 
              required 
            />
          </div>

          <div class="form-group">
            <label>Correo Electrónico</label>
            <input 
              type="email" 
              class="input-field" 
              [(ngModel)]="email" 
              name="email" 
              placeholder="usuario@ejemplo.com" 
              required 
            />
          </div>

          <div class="form-group">
            <label>Contraseña</label>
            <input 
              type="password" 
              class="input-field" 
              [(ngModel)]="password" 
              name="password" 
              placeholder="••••••••" 
              required 
            />
          </div>

          <div class="error-alert" *ngIf="errorMessage">
            {{ errorMessage }}
          </div>

          <button type="submit" class="btn btn-primary submit-btn" [disabled]="loading">
            <span *ngIf="!loading">{{ isLogin ? 'Ingresar a ClassForge' : 'Crear Cuenta' }}</span>
            <span *ngIf="loading" class="animate-pulse">Cargando...</span>
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-darkest);
      position: relative;
      overflow: hidden;
    }
    .bg-glow {
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      filter: blur(100px);
      opacity: 0.15;
      pointer-events: none;
    }
    .glow-cyan {
      top: 10%;
      left: 15%;
      background: var(--cyan);
    }
    .glow-violet {
      bottom: 10%;
      right: 15%;
      background: var(--violet);
    }
    .login-card {
      width: 380px;
      padding: 32px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .card-brand {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .brand-logo {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, var(--cyan), var(--violet));
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000;
      font-weight: bold;
      font-size: 20px;
      box-shadow: 0 0 20px var(--cyan-glow);
    }
    .card-brand h2 {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-bright);
    }
    .brand-sub {
      font-size: 11px;
      color: var(--text-muted);
    }
    .mode-tabs {
      margin-top: 4px;
    }
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
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
    .error-alert {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--red);
      font-size: 11px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
    }
    .submit-btn {
      width: 100%;
      justify-content: center;
      padding: 10px;
      margin-top: 6px;
    }
  `]
})
export class LoginComponent {
  isLogin = true;
  email = '';
  password = '';
  fullName = '';
  loading = false;
  errorMessage = '';

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    this.errorMessage = '';
    if (!this.email || !this.password) {
      this.errorMessage = 'Por favor ingresa todos los campos.';
      return;
    }

    this.loading = true;
    if (this.isLogin) {
      this.auth.login(this.email, this.password).subscribe({
        next: () => {
          this.loading = false;
          this.router.navigate(['/editor']);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err.error?.error || 'Error al iniciar sesión. Verifique sus credenciales.';
        }
      });
    } else {
      this.auth.register(this.email, this.password, this.fullName || 'Usuario ClassForge').subscribe({
        next: () => {
          this.loading = false;
          this.router.navigate(['/editor']);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err.error?.error || 'Error al registrar usuario.';
        }
      });
    }
  }
}
