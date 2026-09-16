import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

interface UmlNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hue: number;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-page">
      <!-- Fondo Dinámico Ambient -->
      <div class="bg-layer">
        <div class="orb orb-cyan"></div>
        <div class="orb orb-violet"></div>
        <div class="orb orb-indigo"></div>
        <div class="grid"></div>
      </div>

      <!-- Canvas Interactivo Nodos UML -->
      <canvas #netCanvas class="net-canvas"></canvas>

      <!-- Viñeta Radial de Enfoque -->
      <div class="vignette"></div>

      <!-- Tarjeta de Login ClassForge -->
      <div class="login-card glass-panel animate-fade-in">
        <div class="card-brand">
          <div class="brand-logo">
            <img src="/assets/images/Logores.png" (error)="onLogoError($event)" alt="ClassForge Logo" class="brand-logo-img" />
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
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .login-page {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #05070d;
      position: relative;
      overflow: hidden;
    }

    /* Capas del fondo */
    .bg-layer {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }

    .orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.35;
      mix-blend-mode: screen;
    }

    .orb-cyan {
      width: 520px;
      height: 520px;
      background: #22d3ee;
      top: -10%;
      left: -8%;
      animation: float-a 26s ease-in-out infinite;
    }

    .orb-violet {
      width: 600px;
      height: 600px;
      background: #7c3aed;
      bottom: -15%;
      right: -10%;
      animation: float-b 32s ease-in-out infinite;
    }

    .orb-indigo {
      width: 420px;
      height: 420px;
      background: #312e81;
      top: 35%;
      left: 55%;
      animation: float-c 22s ease-in-out infinite;
    }

    @keyframes float-a {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(60px, 80px) scale(1.15); }
    }

    @keyframes float-b {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(-70px, -50px) scale(1.1); }
    }

    @keyframes float-c {
      0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.25; }
      50% { transform: translate(-40px, 40px) scale(1.2); opacity: 0.4; }
    }

    .grid {
      position: absolute;
      inset: -2px;
      background-image:
        linear-gradient(rgba(120, 150, 255, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(120, 150, 255, 0.05) 1px, transparent 1px);
      background-size: 42px 42px;
      animation: grid-drift 60s linear infinite;
      -webkit-mask-image: radial-gradient(ellipse at 50% 40%, black 40%, transparent 85%);
      mask-image: radial-gradient(ellipse at 50% 40%, black 40%, transparent 85%);
    }

    @keyframes grid-drift {
      0% { background-position: 0 0; }
      100% { background-position: 420px 420px; }
    }

    .net-canvas {
      position: fixed;
      inset: 0;
      z-index: 1;
      pointer-events: none;
    }

    .vignette {
      position: fixed;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      background: radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(5, 7, 13, 0.75) 100%);
    }

    /* Tarjeta de Login */
    .login-card {
      position: relative;
      z-index: 10;
      width: 380px;
      padding: 32px;
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
      overflow: hidden;
    }

    .brand-logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
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
export class LoginComponent implements AfterViewInit, OnDestroy {
  @ViewChild('netCanvas') netCanvas!: ElementRef<HTMLCanvasElement>;

  isLogin = true;
  email = '';
  password = '';
  fullName = '';
  loading = false;
  errorMessage = '';

  private animFrameId: number | null = null;
  private resizeHandler: (() => void) | null = null;
  private nodes: UmlNode[] = [];

  constructor(private auth: AuthService, private router: Router) {}

  ngAfterViewInit(): void {
    this.initCanvasAnimation();
  }

  ngOnDestroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
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
        img.parentElement.innerHTML = '<span>❖</span>';
      }
    }
  }

  private initCanvasAnimation(): void {
    if (!this.netCanvas) return;
    const canvas = this.netCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    this.resizeHandler = resize;
    window.addEventListener('resize', resize);
    resize();

    const count = 22;
    const linkDist = 190;
    this.nodes = [];

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    for (let i = 0; i < count; i++) {
      this.nodes.push({
        x: rand(0, window.innerWidth),
        y: rand(0, window.innerHeight),
        vx: rand(-0.10, 0.10),
        vy: rand(-0.08, 0.08),
        w: rand(20, 34),
        h: rand(14, 22),
        hue: Math.random() > 0.5 ? 190 : 265
      });
    }

    const step = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // Mover nodos con rebote suave
      for (const n of this.nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -40 || n.x > w + 40) n.vx *= -1;
        if (n.y < -40 || n.y > h + 40) n.vy *= -1;
      }

      // Conexiones de diagrama de clases
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          const a = this.nodes[i];
          const b = this.nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            const alpha = (1 - dist / linkDist) * 0.22;
            ctx.strokeStyle = `hsla(200, 90%, 70%, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Dibujar mini class boxes
      for (const n of this.nodes) {
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.strokeStyle = `hsla(${n.hue}, 90%, 70%, 0.55)`;
        ctx.fillStyle = `hsla(${n.hue}, 90%, 60%, 0.06)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(-n.w / 2, -n.h / 2, n.w, n.h);
        ctx.fill();
        ctx.stroke();

        // Línea de cabecera de clase
        ctx.beginPath();
        ctx.moveTo(-n.w / 2, -n.h / 2 + n.h * 0.4);
        ctx.lineTo(n.w / 2, -n.h / 2 + n.h * 0.4);
        ctx.stroke();
        ctx.restore();
      }

      this.animFrameId = requestAnimationFrame(step);
    };

    step();
  }

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
