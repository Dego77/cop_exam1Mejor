import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';

export interface SupportResponse {
  message: string;
  suggestedAction?: string;
  targetSelector?: string;
  stepGuide?: string[];
  quickReplies?: string[];
}

export interface SupportChatMessage {
  sender: 'USER' | 'AGENT';
  text: string;
  stepGuide?: string[];
  targetSelector?: string;
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class SupportAgentService {
  private readonly apiUrl = 'http://localhost:3000/api/ai/support';

  // Toggle state: Interactive mode ON/OFF
  private interactiveModeSubject = new BehaviorSubject<boolean>(true);
  public isInteractiveMode$ = this.interactiveModeSubject.asObservable();

  // Highlighted UI element for screen assistance
  private highlightSelectorSubject = new BehaviorSubject<string | null>(null);
  public highlightSelector$ = this.highlightSelectorSubject.asObservable();

  // Active tip for the floating mascot/bubble in Editor
  private activeMascotTipSubject = new BehaviorSubject<string | null>(
    '💡 ¡Hola! Estoy en modo activo para darte consejos y guiarte en el Canvas.'
  );
  public activeMascotTip$ = this.activeMascotTipSubject.asObservable();

  // Chat message history
  private chatHistorySubject = new BehaviorSubject<SupportChatMessage[]>([
    {
      sender: 'AGENT',
      text: '👋 ¡Hola! Soy tu Agente de Soporte de ClassForge. ¿En qué puedo ayudarte hoy sobre el uso de la plataforma o resolución de dudas?',
      timestamp: new Date()
    }
  ]);
  public chatHistory$ = this.chatHistorySubject.asObservable();

  constructor(private http: HttpClient, private auth: AuthService) {}

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  public toggleInteractiveMode(enabled?: boolean): void {
    const newState = enabled !== undefined ? enabled : !this.interactiveModeSubject.value;
    this.interactiveModeSubject.next(newState);

    if (!newState) {
      this.clearHighlight();
      this.activeMascotTipSubject.next(null);
    } else {
      this.activeMascotTipSubject.next('💡 Asistencia Activa encendida. ¡Te señalaré herramientas si lo necesitas!');
    }
  }

  public get isInteractiveModeValue(): boolean {
    return this.interactiveModeSubject.value;
  }

  public setHighlight(selector: string | null): void {
    this.highlightSelectorSubject.next(selector);
  }

  public clearHighlight(): void {
    this.highlightSelectorSubject.next(null);
  }

  public setMascotTip(tip: string | null): void {
    if (this.interactiveModeSubject.value) {
      this.activeMascotTipSubject.next(tip);
    }
  }

  public askAgent(question: string): Observable<SupportResponse> {
    // Append user message
    const current = this.chatHistorySubject.value;
    this.chatHistorySubject.next([
      ...current,
      { sender: 'USER', text: question, timestamp: new Date() }
    ]);

    const isInteractiveMode = this.interactiveModeSubject.value;

    return this.http.post<SupportResponse>(
      this.apiUrl,
      { prompt: question, isInteractiveMode },
      { headers: this.headers }
    ).pipe(
      tap((res) => {
        const history = this.chatHistorySubject.value;
        this.chatHistorySubject.next([
          ...history,
          {
            sender: 'AGENT',
            text: res.message,
            stepGuide: res.stepGuide,
            targetSelector: res.targetSelector,
            timestamp: new Date()
          }
        ]);

        if (isInteractiveMode && res.targetSelector) {
          this.setHighlight(res.targetSelector);
          this.setMascotTip(`👉 ${res.message}`);
        }
      }),
      catchError((err) => {
        const history = this.chatHistorySubject.value;
        const fallbackText = `Para cualquier duda en ClassForge: puedes agregar clases desde la barra izquierda, conectarlas y generar tu código SQL desde el menú superior.`;
        this.chatHistorySubject.next([
          ...history,
          { sender: 'AGENT', text: fallbackText, timestamp: new Date() }
        ]);
        return of({
          message: fallbackText,
          suggestedAction: 'NONE'
        });
      })
    );
  }
}
