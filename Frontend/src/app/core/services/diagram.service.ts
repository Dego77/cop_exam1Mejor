import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface UMLNode {
  id: string;
  name: string;
  stereotype: string;
  attributes: any[];
  methods: any[];
  positionX: number;
  positionY: number;
  width?: number;
  height?: number;
}

export interface UMLConnector {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceMultOffsetX?: number;
  sourceMultOffsetY?: number;
  targetMultOffsetX?: number;
  targetMultOffsetY?: number;
  label?: string;
  loopWidth?: number;
  loopHeight?: number;
  loopOffsetX?: number;
  loopOffsetY?: number;
  associationClassNodeId?: string;
}

export interface CanvasLabel {
  id: string;
  text: string;
  positionX: number;
  positionY: number;
}

export interface Diagram {
  id: string;
  name: string;
  nodes: UMLNode[];
  connectors: UMLConnector[];
}

@Injectable({ providedIn: 'root' })
export class DiagramService {
  private readonly apiUrl = 'http://localhost:3000/api/diagrams';
  private nodesSubject = new BehaviorSubject<UMLNode[]>([]);
  private connectorsSubject = new BehaviorSubject<UMLConnector[]>([]);
  private selectedNodeSubject = new BehaviorSubject<UMLNode | null>(null);
  private labelsSubject = new BehaviorSubject<CanvasLabel[]>([]);
  private currentDiagramId = '';

  nodes$ = this.nodesSubject.asObservable();
  connectors$ = this.connectorsSubject.asObservable();
  selectedNode$ = this.selectedNodeSubject.asObservable();
  labels$ = this.labelsSubject.asObservable();

  constructor(private http: HttpClient, private auth: AuthService) {}

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  loadDiagram(projectId: string): Observable<Diagram> {
    return new Observable(observer => {
      this.http.get<Diagram>(`${this.apiUrl}/${projectId}`, { headers: this.headers }).subscribe({
        next: (d) => {
          this.currentDiagramId = d.id;
          this.nodesSubject.next(d.nodes || []);
          this.connectorsSubject.next(d.connectors || []);
          observer.next(d);
          observer.complete();
        },
        error: err => observer.error(err)
      });
    });
  }

  addNode(node: Partial<UMLNode>): Observable<UMLNode> {
    return new Observable(observer => {
      const payload = { diagramId: this.currentDiagramId, ...node };
      this.http.post<UMLNode>(`${this.apiUrl}/nodes`, payload, { headers: this.headers }).subscribe({
        next: (n) => {
          const current = this.nodesSubject.value;
          this.nodesSubject.next([...current, n]);
          observer.next(n);
          observer.complete();
        },
        error: err => observer.error(err)
      });
    });
  }

  updateNode(nodeId: string, changes: Partial<UMLNode>): void {
    this.http.put(`${this.apiUrl}/nodes/${nodeId}`, changes, { headers: this.headers }).subscribe();
    const nodes = this.nodesSubject.value.map(n => n.id === nodeId ? { ...n, ...changes } : n);
    this.nodesSubject.next(nodes);
  }

  deleteNode(nodeId: string): void {
    this.http.delete(`${this.apiUrl}/nodes/${nodeId}`, { headers: this.headers }).subscribe();
    this.nodesSubject.next(this.nodesSubject.value.filter(n => n.id !== nodeId));
    this.connectorsSubject.next(
      this.connectorsSubject.value.filter(c => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId)
    );
  }

  addConnector(conn: Partial<UMLConnector>): Observable<UMLConnector> {
    return new Observable(observer => {
      const payload = { diagramId: this.currentDiagramId, ...conn };
      this.http.post<UMLConnector>(`${this.apiUrl}/connectors`, payload, { headers: this.headers }).subscribe({
        next: (c) => {
          this.connectorsSubject.next([...this.connectorsSubject.value, c]);
          observer.next(c);
          observer.complete();
        },
        error: err => observer.error(err)
      });
    });
  }

  deleteConnector(connectorId: string): void {
    this.http.delete(`${this.apiUrl}/connectors/${connectorId}`, { headers: this.headers }).subscribe();
    this.connectorsSubject.next(this.connectorsSubject.value.filter(c => c.id !== connectorId));
  }

  updateLocalNode(node: UMLNode): void {
    const nodes = this.nodesSubject.value.map(n => n.id === node.id ? node : n);
    this.nodesSubject.next(nodes);
  }

  addLocalNode(node: UMLNode): void {
    const current = this.nodesSubject.value;
    if (!current.find(n => n.id === node.id)) {
      this.nodesSubject.next([...current, node]);
    }
  }

  selectNode(node: UMLNode | null): void { this.selectedNodeSubject.next(node); }

  addLabel(label: CanvasLabel): void {
    this.labelsSubject.next([...this.labelsSubject.value, label]);
  }

  updateLabel(id: string, text: string): void {
    const updated = this.labelsSubject.value.map(l => l.id === id ? { ...l, text } : l);
    this.labelsSubject.next(updated);
  }

  deleteLabel(id: string): void {
    this.labelsSubject.next(this.labelsSubject.value.filter(l => l.id !== id));
  }

  get currentNodes(): UMLNode[] { return this.nodesSubject.value; }
  get currentConnectors(): UMLConnector[] { return this.connectorsSubject.value; }
  get currentLabels(): CanvasLabel[] { return this.labelsSubject.value; }
  get diagramId(): string { return this.currentDiagramId; }
}
