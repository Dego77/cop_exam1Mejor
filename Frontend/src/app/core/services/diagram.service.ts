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
  private readonly apiUrl = 'http://3.138.124.211:3000/api/diagrams';
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

  private currentProjectId = '';

  loadDiagram(projectId: string): Observable<Diagram> {
    this.currentProjectId = projectId;
    return new Observable(observer => {
      // Clear memory subjects immediately so elements from previous project don't bleed into new project
      this.nodesSubject.next([]);
      this.connectorsSubject.next([]);

      this.http.get<Diagram>(`${this.apiUrl}/${projectId}`, { headers: this.headers }).subscribe({
        next: (d) => {
          this.currentDiagramId = d.id;
          const serverNodes = d.nodes || [];
          let serverConnectors = d.connectors || [];

          // Check if local snapshot has saved connectors for this user/project
          const cached = this.getDiagramLocalSnapshot(projectId);
          if (cached && cached.connectors && cached.connectors.length > 0 && serverConnectors.length === 0) {
            serverConnectors = cached.connectors;
          }

          // Auto-Synthesize Connectors ONLY if neither server nor local snapshot has any saved connectors
          if (serverConnectors.length === 0 && serverNodes.length >= 2 && (!cached || !cached.nodes || cached.nodes.length === 0)) {
            const synthesized = this.autoSynthesizeConnectors(serverNodes);
            if (synthesized.length > 0) {
              serverConnectors = synthesized;
              // Persist to PostgreSQL asynchronously
              synthesized.forEach(c => this.addConnector(c).subscribe());
            }
          }

          serverConnectors = this.deduplicateConnectors(serverConnectors);

          this.nodesSubject.next(serverNodes);
          this.connectorsSubject.next(serverConnectors);
          this.saveDiagramLocalSnapshot(projectId, serverNodes, serverConnectors);
          observer.next({ ...d, connectors: serverConnectors });
          observer.complete();
        },
        error: err => {
          const cached = this.getDiagramLocalSnapshot(projectId);
          if (cached && cached.nodes && cached.nodes.length > 0) {
            let cachedConns = cached.connectors || [];
            this.nodesSubject.next(cached.nodes);
            this.connectorsSubject.next(cachedConns);
            observer.next({ id: '', name: '', nodes: cached.nodes, connectors: cachedConns });
            observer.complete();
          } else {
            observer.error(err);
          }
        }
      });
    });
  }

  clearCanvas(): void {
    this.currentDiagramId = '';
    this.currentProjectId = '';
    this.nodesSubject.next([]);
    this.connectorsSubject.next([]);
    this.selectedNodeSubject.next(null);
    this.labelsSubject.next([]);
  }


  autoSynthesizeConnectors(nodes: UMLNode[]): UMLConnector[] {
    const connectors: UMLConnector[] = [];
    if (!nodes || nodes.length < 2) return connectors;

    // 1. Foreign Key Attribute Matching
    for (let i = 0; i < nodes.length; i++) {
      const srcNode = nodes[i];
      const attrs = srcNode.attributes || [];
      for (const attr of attrs) {
        const attrName = (attr.name || '').trim().toLowerCase();
        if (attrName.length > 2 && (attrName.endsWith('id') || attrName.endsWith('_id'))) {
          const targetNamePart = attrName.replace(/_?id$/i, '');
          if (!targetNamePart) continue;

          const targetNode = nodes.find(n => {
            if (n.id === srcNode.id) return false;
            const nClean = (n.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            return nClean === targetNamePart || nClean.includes(targetNamePart) || targetNamePart.includes(nClean);
          });

          if (targetNode) {
            const exists = connectors.some(c => 
              (c.sourceNodeId === srcNode.id && c.targetNodeId === targetNode.id) ||
              (c.sourceNodeId === targetNode.id && c.targetNodeId === srcNode.id)
            );
            if (!exists) {
              connectors.push({
                id: `conn_fk_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                sourceNodeId: srcNode.id,
                targetNodeId: targetNode.id,
                type: 'Composition',
                sourceMultiplicity: '0..*',
                targetMultiplicity: '1',
                label: ''
              });
            }
          }
        }
      }
    }

    // 2. Specific Domain Matching (Customer -> User, etc.)
    const findNodeByName = (nameStr: string) => {
      const clean = nameStr.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      return nodes.find(n => {
        const nClean = (n.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        return nClean === clean || nClean.includes(clean) || clean.includes(nClean);
      });
    };

    const userNode = findNodeByName('user');
    const customerNode = findNodeByName('customer');
    if (customerNode && userNode && customerNode.id !== userNode.id) {
      const exists = connectors.some(c => c.sourceNodeId === customerNode.id && c.targetNodeId === userNode.id);
      if (!exists) {
        connectors.push({
          id: `conn_inh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          sourceNodeId: customerNode.id,
          targetNodeId: userNode.id,
          type: 'Inheritance',
          sourceMultiplicity: '',
          targetMultiplicity: '',
          label: ''
        });
      }
    }

    // 3. Fallback: Sequential Chain for remaining disconnected nodes
    if (connectors.length === 0 && nodes.length >= 2) {
      for (let i = 0; i < nodes.length - 1; i++) {
        connectors.push({
          id: `conn_chain_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          sourceNodeId: nodes[i + 1].id,
          targetNodeId: nodes[i].id,
          type: i === 0 ? 'Inheritance' : 'Composition',
          sourceMultiplicity: i === 0 ? '' : '0..*',
          targetMultiplicity: i === 0 ? '' : '1',
          label: ''
        });
      }
    }

    return connectors;
  }

  deduplicateConnectors(connectors: UMLConnector[]): UMLConnector[] {
    if (!connectors || connectors.length === 0) return [];
    const unique: UMLConnector[] = [];
    const seen = new Set<string>();

    for (let i = connectors.length - 1; i >= 0; i--) {
      const c = connectors[i];
      if (!c || !c.sourceNodeId || !c.targetNodeId) continue;
      const typeStr = c.type || 'Association';
      const key1 = `${c.sourceNodeId}_${c.targetNodeId}_${typeStr}`;
      const key2 = `${c.targetNodeId}_${c.sourceNodeId}_${typeStr}`;

      if (!seen.has(key1) && !seen.has(key2)) {
        seen.add(key1);
        seen.add(key2);
        unique.unshift(c);
      }
    }
    return unique;
  }

  saveDiagramLocalSnapshot(projectId: string, nodes: UMLNode[], connectors: UMLConnector[]): void {
    if (!projectId) return;
    try {
      const uId = this.auth.currentUser?.id || this.auth.currentUser?.email || 'anon';
      localStorage.setItem(`classforge_diagram_${uId}_${projectId}`, JSON.stringify({ nodes, connectors }));
    } catch (e) {}
  }

  clearLocalSnapshot(projectId: string): void {
    if (!projectId) return;
    try {
      const uId = this.auth.currentUser?.id || this.auth.currentUser?.email || 'anon';
      localStorage.removeItem(`classforge_diagram_${uId}_${projectId}`);
      localStorage.removeItem(`classforge_diagram_snapshot_${projectId}`);
    } catch (e) {}
  }

  getDiagramLocalSnapshot(projectId: string): { nodes: UMLNode[]; connectors: UMLConnector[] } | null {
    if (!projectId) return null;
    try {
      const uId = this.auth.currentUser?.id || this.auth.currentUser?.email || 'anon';
      const raw = localStorage.getItem(`classforge_diagram_${uId}_${projectId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  addNode(node: Partial<UMLNode>): Observable<UMLNode> {
    return new Observable(observer => {
      const ensureDiagramId = (cb: (diagId: string) => void) => {
        if (this.currentDiagramId) {
          cb(this.currentDiagramId);
        } else if (this.currentProjectId) {
          this.http.get<Diagram>(`${this.apiUrl}/${this.currentProjectId}`, { headers: this.headers }).subscribe({
            next: (d) => {
              this.currentDiagramId = d.id;
              cb(d.id);
            },
            error: () => cb('')
          });
        } else {
          cb('');
        }
      };

      ensureDiagramId((diagId) => {
        const tempNode: UMLNode = {
          id: node.id || `node_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          name: node.name || 'NewClass',
          stereotype: node.stereotype || 'Entity',
          attributes: node.attributes || [],
          methods: node.methods || [],
          positionX: node.positionX || 150,
          positionY: node.positionY || 150
        };

        if (!diagId) {
          this.nodesSubject.next([...this.nodesSubject.value, tempNode]);
          observer.next(tempNode);
          observer.complete();
          return;
        }

        const payload = { diagramId: diagId, ...node };
        this.http.post<UMLNode>(`${this.apiUrl}/nodes`, payload, { headers: this.headers }).subscribe({
          next: (n) => {
            const current = this.nodesSubject.value.filter(x => x.id !== tempNode.id);
            this.nodesSubject.next([...current, n]);
            observer.next(n);
            observer.complete();
          },
          error: () => {
            if (!this.nodesSubject.value.some(x => x.id === tempNode.id)) {
              this.nodesSubject.next([...this.nodesSubject.value, tempNode]);
            }
            observer.next(tempNode);
            observer.complete();
          }
        });
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
    const updatedNodes = this.nodesSubject.value.filter(n => n.id !== nodeId);
    const updatedConns = this.connectorsSubject.value.filter(c => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId);
    this.nodesSubject.next(updatedNodes);
    this.connectorsSubject.next(updatedConns);
    if (this.currentProjectId) {
      this.saveDiagramLocalSnapshot(this.currentProjectId, updatedNodes, updatedConns);
    }
  }

  addConnector(conn: Partial<UMLConnector>): Observable<UMLConnector> {
    return new Observable(observer => {
      const ensureDiagramId = (cb: (diagId: string) => void) => {
        if (this.currentDiagramId) {
          cb(this.currentDiagramId);
        } else if (this.currentProjectId) {
          this.http.get<Diagram>(`${this.apiUrl}/${this.currentProjectId}`, { headers: this.headers }).subscribe({
            next: (d) => {
              this.currentDiagramId = d.id;
              cb(d.id);
            },
            error: () => cb('')
          });
        } else {
          cb('');
        }
      };

      ensureDiagramId((diagId) => {
        const tempConn: UMLConnector = {
          id: conn.id || `conn_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          sourceNodeId: conn.sourceNodeId || '',
          targetNodeId: conn.targetNodeId || '',
          type: conn.type || 'Association',
          sourceMultiplicity: conn.sourceMultiplicity || '',
          targetMultiplicity: conn.targetMultiplicity || '',
          label: conn.label || ''
        };

        // Always push to connectorsSubject immediately so line renders on canvas
        const current = this.connectorsSubject.value;
        if (!current.some(c => c.id === tempConn.id || (c.sourceNodeId === tempConn.sourceNodeId && c.targetNodeId === tempConn.targetNodeId && c.type === tempConn.type))) {
          this.connectorsSubject.next([...current, tempConn]);
        }

        if (!diagId) {
          observer.next(tempConn);
          observer.complete();
          return;
        }

        const payload = { diagramId: diagId, ...conn };
        this.http.post<UMLConnector>(`${this.apiUrl}/connectors`, payload, { headers: this.headers }).subscribe({
          next: (savedConn) => {
            const updated = this.connectorsSubject.value.map(c => c.id === tempConn.id ? savedConn : c);
            this.connectorsSubject.next(updated);
            if (this.currentProjectId) {
              this.saveDiagramLocalSnapshot(this.currentProjectId, this.nodesSubject.value, updated);
            }
            observer.next(savedConn);
            observer.complete();
          },
          error: () => {
            observer.next(tempConn);
            observer.complete();
          }
        });
      });
    });
  }

  deleteConnector(connectorId: string): void {
    const targetConn = this.connectorsSubject.value.find(c => c.id === connectorId);
    const isUUID = (str?: string): boolean => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    
    let deleteUrl = `${this.apiUrl}/connectors/${connectorId}`;
    if (!isUUID(connectorId) && targetConn) {
      deleteUrl += `?sourceNodeId=${targetConn.sourceNodeId}&targetNodeId=${targetConn.targetNodeId}&type=${targetConn.type || ''}`;
    }

    this.http.delete(deleteUrl, { headers: this.headers }).subscribe();
    const updatedConns = this.connectorsSubject.value.filter(c => c.id !== connectorId);
    this.connectorsSubject.next(updatedConns);
    if (this.currentProjectId) {
      this.saveDiagramLocalSnapshot(this.currentProjectId, this.nodesSubject.value, updatedConns);
    }
  }

  updateConnector(connectorId: string, changes: Partial<UMLConnector>): void {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectorId);
    if (connectorId && isUUID) {
      this.http.put(`${this.apiUrl}/connectors/${connectorId}`, changes, { headers: this.headers }).subscribe();
    }
    const updatedConns = this.connectorsSubject.value.map(c => c.id === connectorId ? { ...c, ...changes } : c);
    this.connectorsSubject.next(updatedConns);
    if (this.currentProjectId) {
      this.saveDiagramLocalSnapshot(this.currentProjectId, this.nodesSubject.value, updatedConns);
    }
  }

  updateLocalNode(node: UMLNode): void {
    const nodes = this.nodesSubject.value.map(n => n.id === node.id ? node : n);
    this.nodesSubject.next(nodes);
  }

  addLocalNode(node: UMLNode): void {
    const current = this.nodesSubject.value;
    const existingIndex = current.findIndex(n => n.id === node.id || (n.name && n.name.toLowerCase() === node.name?.toLowerCase()));
    
    if (existingIndex >= 0) {
      // Replace existing local node with updated version
      const updatedList = [...current];
      updatedList[existingIndex] = { ...updatedList[existingIndex], ...node };
      this.nodesSubject.next(updatedList);
    } else {
      this.nodesSubject.next([...current, node]);
    }

    const persistNode = (diagramIdToUse: string) => {
      if (!diagramIdToUse) return;
      const payload = {
        diagramId: diagramIdToUse,
        name: node.name,
        stereotype: node.stereotype || 'Entity',
        attributes: node.attributes || [],
        methods: node.methods || [],
        positionX: node.positionX,
        positionY: node.positionY
      };
      this.http.post<UMLNode>(`${this.apiUrl}/nodes`, payload, { headers: this.headers }).subscribe({
        next: (savedNode) => {
          if (this.currentDiagramId === diagramIdToUse) {
            const latestNodes = this.nodesSubject.value.map(n => n.id === node.id ? savedNode : n);
            this.nodesSubject.next(latestNodes);
          }
        },
        error: (err) => console.error('Error al persistir nodo local:', err)
      });
    };

    const isUUID = (str?: string): boolean => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    if (node.id && !isUUID(node.id)) {
      if (this.currentDiagramId) {
        persistNode(this.currentDiagramId);
      } else if (this.currentProjectId) {
        this.http.get<Diagram>(`${this.apiUrl}/${this.currentProjectId}`, { headers: this.headers }).subscribe({
          next: (d) => {
            this.currentDiagramId = d.id;
            persistNode(d.id);
          }
        });
      }
    }
  }

  purgeDiagram(projectId: string): Observable<boolean> {
    return new Observable(observer => {
      if (!projectId) {
        this.nodesSubject.next([]);
        this.connectorsSubject.next([]);
        observer.next(true);
        observer.complete();
        return;
      }
      this.http.delete(`${this.apiUrl}/${projectId}/purge`, { headers: this.headers }).subscribe({
        next: () => {
          this.nodesSubject.next([]);
          this.connectorsSubject.next([]);
          observer.next(true);
          observer.complete();
        },
        error: () => {
          this.nodesSubject.next([]);
          this.connectorsSubject.next([]);
          observer.next(true);
          observer.complete();
        }
      });
    });
  }

  saveCurrentDiagram(explicitProjectId?: string, explicitDiagramId?: string, explicitNodes?: UMLNode[], explicitConnectors?: UMLConnector[]): Observable<boolean> {
    return new Observable(observer => {
      const targetProjectId = explicitProjectId || this.currentProjectId;
      let targetDiagramId = explicitDiagramId || (targetProjectId === this.currentProjectId ? this.currentDiagramId : '');

      const nodes = explicitNodes ? [...explicitNodes] : [...this.nodesSubject.value];
      const connectors = explicitConnectors ? [...explicitConnectors] : [...this.connectorsSubject.value];

      if (nodes.length === 0 && connectors.length === 0) {
        observer.next(true);
        observer.complete();
        return;
      }

      const ensureDiagramId = (): Observable<string> => {
        if (targetDiagramId) return new Observable(obs => { obs.next(targetDiagramId); obs.complete(); });
        if (!targetProjectId) return new Observable(obs => { obs.next(''); obs.complete(); });
        return new Observable(obs => {
          this.http.get<Diagram>(`${this.apiUrl}/${targetProjectId}`, { headers: this.headers }).subscribe({
            next: (d) => {
              if (targetProjectId === this.currentProjectId) {
                this.currentDiagramId = d.id;
              }
              targetDiagramId = d.id;
              obs.next(d.id);
              obs.complete();
            },
            error: () => {
              obs.next('');
              obs.complete();
            }
          });
        });
      };

      ensureDiagramId().subscribe(diagramId => {
        if (!diagramId) {
          if (targetProjectId) {
            this.saveDiagramLocalSnapshot(targetProjectId, nodes, connectors);
          }
          observer.next(false);
          observer.complete();
          return;
        }

        const isUUID = (str?: string): boolean => {
          if (!str) return false;
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        };

        const tempToRealIdMap = new Map<string, string>();
        const updatedNodes: UMLNode[] = [];

        let processedNodes = 0;
        const totalNodes = nodes.length;

        const finishNodesPhase = () => {
          processConnectorsPhase();
        };

        const processConnectorsPhase = () => {
          let processedConnectors = 0;
          const totalConnectors = connectors.length;

          if (totalConnectors === 0) {
            if (targetProjectId === this.currentProjectId && updatedNodes.length > 0) {
              this.nodesSubject.next(updatedNodes);
            }
            if (targetProjectId) {
              this.saveDiagramLocalSnapshot(targetProjectId, updatedNodes.length > 0 ? updatedNodes : nodes, connectors);
            }
            observer.next(true);
            observer.complete();
            return;
          }

          const updatedConnectors: UMLConnector[] = [];

          connectors.forEach(c => {
            const resolvedSourceId = tempToRealIdMap.get(c.sourceNodeId) || (c.sourceNodeId ? tempToRealIdMap.get(c.sourceNodeId.trim().toLowerCase()) : undefined) || c.sourceNodeId;
            const resolvedTargetId = tempToRealIdMap.get(c.targetNodeId) || (c.targetNodeId ? tempToRealIdMap.get(c.targetNodeId.trim().toLowerCase()) : undefined) || c.targetNodeId;
            const resolvedAssocId = c.associationClassNodeId ? (tempToRealIdMap.get(c.associationClassNodeId) || tempToRealIdMap.get(c.associationClassNodeId.trim().toLowerCase()) || c.associationClassNodeId) : undefined;
            const isTempConn = !isUUID(c.id);
            if (isTempConn) {
              const connPayload = {
                diagramId,
                sourceNodeId: resolvedSourceId,
                targetNodeId: resolvedTargetId,
                type: c.type || 'Association',
                sourceMultiplicity: (c.sourceMultiplicity !== undefined && c.sourceMultiplicity !== null) ? c.sourceMultiplicity : '',
                targetMultiplicity: (c.targetMultiplicity !== undefined && c.targetMultiplicity !== null) ? c.targetMultiplicity : '',
                label: c.label || '',
                associationClassNodeId: resolvedAssocId
              };

              this.http.post<UMLConnector>(`${this.apiUrl}/connectors`, connPayload, { headers: this.headers }).subscribe({
                next: (savedConn) => {
                  const finalConn = savedConn ? { ...savedConn, associationClassNodeId: savedConn.associationClassNodeId || resolvedAssocId } : savedConn;
                  updatedConnectors.push(finalConn);
                  processedConnectors++;
                  if (processedConnectors >= totalConnectors) {
                    if (targetProjectId === this.currentProjectId) {
                      if (updatedNodes.length > 0) this.nodesSubject.next(updatedNodes);
                      this.connectorsSubject.next(updatedConnectors);
                    }
                    if (targetProjectId) {
                      this.saveDiagramLocalSnapshot(targetProjectId, updatedNodes.length > 0 ? updatedNodes : nodes, updatedConnectors);
                    }
                    observer.next(true);
                    observer.complete();
                  }
                },
                error: () => {
                  processedConnectors++;
                  if (processedConnectors >= totalConnectors) {
                    if (targetProjectId === this.currentProjectId && updatedNodes.length > 0) {
                      this.nodesSubject.next(updatedNodes);
                    }
                    if (targetProjectId) {
                      this.saveDiagramLocalSnapshot(targetProjectId, updatedNodes.length > 0 ? updatedNodes : nodes, updatedConnectors);
                    }
                    observer.next(true);
                    observer.complete();
                  }
                }
              });
            } else {
              const connPayload = {
                sourceNodeId: resolvedSourceId,
                targetNodeId: resolvedTargetId,
                type: c.type || 'Association',
                sourceMultiplicity: c.sourceMultiplicity !== undefined ? c.sourceMultiplicity : '',
                targetMultiplicity: c.targetMultiplicity !== undefined ? c.targetMultiplicity : '',
                label: c.label || '',
                associationClassNodeId: resolvedAssocId
              };
              this.http.put<UMLConnector>(`${this.apiUrl}/connectors/${c.id}`, connPayload, { headers: this.headers }).subscribe({
                next: (savedConn) => {
                  const finalConn = savedConn ? { ...savedConn, associationClassNodeId: savedConn.associationClassNodeId || resolvedAssocId } : { ...c, sourceNodeId: resolvedSourceId, targetNodeId: resolvedTargetId, associationClassNodeId: resolvedAssocId };
                  updatedConnectors.push(finalConn);
                  processedConnectors++;
                  if (processedConnectors >= totalConnectors) {
                    if (targetProjectId === this.currentProjectId) {
                      if (updatedNodes.length > 0) this.nodesSubject.next(updatedNodes);
                      this.connectorsSubject.next(updatedConnectors);
                    }
                    if (targetProjectId) {
                      this.saveDiagramLocalSnapshot(targetProjectId, updatedNodes.length > 0 ? updatedNodes : nodes, updatedConnectors);
                    }
                    observer.next(true);
                    observer.complete();
                  }
                },
                error: () => {
                  updatedConnectors.push({ ...c, sourceNodeId: resolvedSourceId, targetNodeId: resolvedTargetId });
                  processedConnectors++;
                  if (processedConnectors >= totalConnectors) {
                    if (targetProjectId === this.currentProjectId) {
                      if (updatedNodes.length > 0) this.nodesSubject.next(updatedNodes);
                      this.connectorsSubject.next(updatedConnectors);
                    }
                    if (targetProjectId) {
                      this.saveDiagramLocalSnapshot(targetProjectId, updatedNodes.length > 0 ? updatedNodes : nodes, updatedConnectors);
                    }
                    observer.next(true);
                    observer.complete();
                  }
                }
              });
            }
          });
        };

        if (totalNodes === 0) {
          finishNodesPhase();
          return;
        }

        nodes.forEach(n => {
          const isTempNode = !isUUID(n.id);

          if (isTempNode) {
            const payload = {
              diagramId,
              name: n.name,
              stereotype: n.stereotype || 'Entity',
              attributes: n.attributes || [],
              methods: n.methods || [],
              positionX: n.positionX,
              positionY: n.positionY
            };
            this.http.post<UMLNode>(`${this.apiUrl}/nodes`, payload, { headers: this.headers }).subscribe({
              next: (savedNode) => {
                if (n.id) tempToRealIdMap.set(n.id, savedNode.id);
                if (n.name) {
                  tempToRealIdMap.set(n.name, savedNode.id);
                  tempToRealIdMap.set(n.name.trim().toLowerCase(), savedNode.id);
                }
                updatedNodes.push(savedNode);
                processedNodes++;
                if (processedNodes >= totalNodes) finishNodesPhase();
              },
              error: () => {
                updatedNodes.push(n);
                processedNodes++;
                if (processedNodes >= totalNodes) finishNodesPhase();
              }
            });
          } else {
            const updatePayload = {
              name: n.name,
              stereotype: n.stereotype,
              attributes: n.attributes,
              methods: n.methods,
              positionX: n.positionX,
              positionY: n.positionY
            };
            this.http.put(`${this.apiUrl}/nodes/${n.id}`, updatePayload, { headers: this.headers }).subscribe({
              next: () => {
                updatedNodes.push(n);
                processedNodes++;
                if (processedNodes >= totalNodes) finishNodesPhase();
              },
              error: () => {
                updatedNodes.push(n);
                processedNodes++;
                if (processedNodes >= totalNodes) finishNodesPhase();
              }
            });
          }
        });
      });
    });
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
