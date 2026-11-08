import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ChatPiece {
  text: string;
  bold: boolean;
  mention: boolean;
  className: boolean;
  break: boolean;
}

@Component({
  selector: 'app-chat-text',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngFor="let part of parts">
      <br *ngIf="part.break" />
      <strong *ngIf="!part.break && part.bold" [class.chat-mention]="part.mention" [class.chat-class]="part.className">{{ part.text }}</strong>
      <span *ngIf="!part.break && !part.bold" [class.chat-mention]="part.mention" [class.chat-class]="part.className">{{ part.text }}</span>
    </ng-container>
  `,
  styles: [`
    :host { white-space: pre-wrap; word-break: break-word; }
    .chat-mention { color: var(--cyan); font-weight: 600; }
    .chat-class { color: var(--yellow-accent); font-weight: 600; }
  `]
})
export class ChatTextComponent {
  @Input() text = '';
  @Input() classNames: string[] = [];
  @Input() emphasizeClasses = false;

  get parts(): ChatPiece[] {
    return parseChatPieces(this.text, this.emphasizeClasses ? this.classNames : []);
  }
}

export function parseChatPieces(text: string, classNames: string[]): ChatPiece[] {
  const pieces: ChatPiece[] = [];
  const names = [...classNames].filter((name) => name && name.length > 1).sort((a, b) => b.length - a.length);
  const classAlt = names.map(escapeRegExp).join('|');
  const pattern = new RegExp(`(@Agente IA|@all|@[^\\s@]+${classAlt ? '|' + classAlt : ''})`, 'gi');
  String(text || '').split('\n').forEach((line, index) => {
    if (index > 0) pieces.push({ text: '', bold: false, mention: false, className: false, break: true });
    for (const chunk of line.split(/(\*\*[^*]+\*\*)/g)) {
      if (!chunk) continue;
      const bold = chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4;
      const raw = bold ? chunk.slice(2, -2) : chunk;
      pieces.push(...splitToken(raw, pattern, names, bold));
    }
  });
  return pieces;
}

function splitToken(raw: string, pattern: RegExp, names: string[], bold: boolean): ChatPiece[] {
  const pieces: ChatPiece[] = [];
  pattern.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    if (match.index > cursor) pieces.push(piece(raw.slice(cursor, match.index), bold, false, false));
    const token = match[0];
    const mention = token.startsWith('@');
    const className = !mention && names.some((name) => name.toLocaleLowerCase() === token.toLocaleLowerCase());
    pieces.push(piece(token, bold, mention, className));
    cursor = match.index + token.length;
  }
  if (cursor < raw.length) pieces.push(piece(raw.slice(cursor), bold, false, false));
  return pieces.filter((item) => item.break || item.text);
}

function piece(text: string, bold: boolean, mention: boolean, className: boolean): ChatPiece {
  return { text, bold, mention, className, break: false };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
