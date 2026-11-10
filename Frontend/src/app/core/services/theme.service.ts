import { Injectable } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'classforge-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  theme: Theme = 'dark';
  private transitionTimer: any = null;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    this.theme = saved === 'light' ? 'light' : 'dark';
    this.apply(false);
  }

  get isLight(): boolean {
    return this.theme === 'light';
  }

  toggle(): void {
    this.theme = this.isLight ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, this.theme);
    } catch {}
    this.apply(true);
  }

  private apply(animate: boolean): void {
    const root = document.documentElement;
    if (animate) {
      // Fade suave de colores durante el cambio de tema
      root.classList.add('theme-transition');
      clearTimeout(this.transitionTimer);
      this.transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 450);
    }
    root.setAttribute('data-theme', this.theme);
  }
}
