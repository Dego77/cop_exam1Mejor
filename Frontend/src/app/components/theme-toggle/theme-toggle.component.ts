import { Component } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <!-- Toggle de tema: luna = oscuro, sol = claro -->
    <button
      type="button"
      class="theme-toggle"
      [class.is-light]="theme.isLight"
      (click)="theme.toggle()"
      [attr.aria-label]="theme.isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'"
      [title]="theme.isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'"
    >
      <span class="tt-bg tt-bg-night"></span>
      <span class="tt-bg tt-bg-day"></span>
      <svg class="tt-stars" viewBox="0 0 56 26" aria-hidden="true">
        <path d="M12 6 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1z" />
        <path d="M22 14 l.7 1.6 1.6 .7 -1.6 .7 -.7 1.6 -.7 -1.6 -1.6 -.7 1.6 -.7z" />
        <circle cx="7" cy="17" r="1" />
        <circle cx="18" cy="5" r=".8" />
        <circle cx="26" cy="21" r=".8" />
      </svg>
      <svg class="tt-clouds" viewBox="0 0 56 26" aria-hidden="true">
        <path d="M26 26 a6 6 0 0 1 5-8 a7 7 0 0 1 12-3 a6 6 0 0 1 10 2 a5 5 0 0 1 4 9z" />
        <path class="tt-cloud-back" d="M32 26 a5 5 0 0 1 6-6 a6 6 0 0 1 10-1 a5 5 0 0 1 8 3 v4z" />
      </svg>
      <span class="tt-knob">
        <span class="tt-crater c1"></span>
        <span class="tt-crater c2"></span>
        <span class="tt-crater c3"></span>
      </span>
    </button>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }
    .theme-toggle {
      position: relative;
      width: 56px;
      height: 26px;
      border-radius: 99px;
      border: none;
      padding: 0;
      cursor: pointer;
      overflow: hidden;
      flex-shrink: 0;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
      transition: box-shadow 0.25s ease, transform 0.15s ease;
    }
    .theme-toggle:hover {
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 12px rgba(124, 58, 237, 0.55);
    }
    .theme-toggle.is-light:hover {
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15), 0 0 12px rgba(91, 192, 240, 0.6);
    }
    .theme-toggle:active {
      transform: scale(0.96);
    }
    .theme-toggle:focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
    }
    .tt-bg {
      position: absolute;
      inset: 0;
      transition: opacity 0.45s ease;
    }
    .tt-bg-night {
      background:
        radial-gradient(circle at 78% 50%, rgba(124, 108, 214, 0.9) 0 11px, rgba(98, 84, 180, 0.9) 11px 15px, transparent 15px),
        linear-gradient(90deg, #3b3f7a 0%, #4b4796 55%, #6a5acd 100%);
    }
    .tt-bg-day {
      opacity: 0;
      background:
        radial-gradient(circle at 22% 50%, rgba(255, 255, 255, 0.35) 0 13px, rgba(255, 255, 255, 0.18) 13px 18px, transparent 18px),
        linear-gradient(90deg, #a8dcf7 0%, #86cff5 55%, #5bc0f0 100%);
    }
    .theme-toggle.is-light .tt-bg-night { opacity: 0; }
    .theme-toggle.is-light .tt-bg-day { opacity: 1; }

    .tt-stars, .tt-clouds {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .tt-stars { fill: #ffffff; }
    .tt-clouds { fill: #ffffff; opacity: 0; transform: translateY(8px); }
    .tt-cloud-back { fill: #e3f4fd; }
    .theme-toggle.is-light .tt-stars { opacity: 0; transform: translateY(-6px); }
    .theme-toggle.is-light .tt-clouds { opacity: 1; transform: translateY(0); }

    .tt-knob {
      position: absolute;
      top: 3px;
      left: 33px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #e4e0f5;
      box-shadow: inset -2px -2px 3px rgba(98, 84, 180, 0.35), 0 1px 3px rgba(0, 0, 0, 0.3);
      transition: left 0.45s cubic-bezier(0.16, 1, 0.3, 1), background 0.45s ease, box-shadow 0.45s ease;
    }
    .theme-toggle.is-light .tt-knob {
      left: 3px;
      background: #ffd24d;
      box-shadow: inset -2px -2px 3px rgba(240, 160, 20, 0.45), 0 0 8px rgba(255, 210, 77, 0.8);
    }
    .tt-crater {
      position: absolute;
      border-radius: 50%;
      background: #c4bce6;
      transition: opacity 0.3s ease;
    }
    .tt-crater.c1 { width: 6px; height: 6px; top: 9px; left: 10px; }
    .tt-crater.c2 { width: 4px; height: 4px; top: 12px; left: 4px; }
    .tt-crater.c3 { width: 3px; height: 3px; top: 4px; left: 12px; }
    .theme-toggle.is-light .tt-crater { opacity: 0; }

    @media (prefers-reduced-motion: reduce) {
      .theme-toggle *, .theme-toggle { transition: none !important; }
    }
  `]
})
export class ThemeToggleComponent {
  constructor(public theme: ThemeService) {}
}
