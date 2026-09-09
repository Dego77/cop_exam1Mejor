import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="help-container">
      <div class="help-header">
        <div class="header-left">
          <button class="back-btn" (click)="goBack()" title="Volver al Editor">
            <span>← Volver al Editor</span>
          </button>
          <span class="help-title">❓ Sección de Ayuda</span>
        </div>
      </div>
      <div class="help-body">
        <!-- Interfaz vacía con fondo black oscuro para futuras adiciones -->
      </div>
    </div>
  `,
  styles: [`
    .help-container {
      width: 100vw;
      height: 100vh;
      background-color: #000000;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .help-header {
      height: 56px;
      background: #141926;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .back-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 6px;
      color: #00d4ff;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s ease;
    }
    .back-btn:hover {
      background: rgba(0, 212, 255, 0.25);
      border-color: #00d4ff;
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.4);
    }
    .help-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 0.5px;
    }
    .help-body {
      flex: 1;
      background-color: #0a0d14;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `]
})
export class HelpComponent {
  constructor(private router: Router) {}

  goBack(): void {
    this.router.navigate(['/editor']);
  }
}
