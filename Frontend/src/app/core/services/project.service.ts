import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  collaborators?: any[];
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly apiUrl = 'http://3.138.124.211:3000/api/projects';

  constructor(private http: HttpClient, private auth: AuthService) {}

  private get headers(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json'
    });
  }

  getAll(): Observable<Project[]> {
    return this.http.get<Project[]>(this.apiUrl, { headers: this.headers });
  }

  getById(id: string): Observable<Project> {
    return this.http.get<Project>(`${this.apiUrl}/${id}`, { headers: this.headers });
  }

  create(name: string, description: string): Observable<Project> {
    return this.http.post<Project>(this.apiUrl, { name, description }, { headers: this.headers });
  }

  update(id: string, changes: Partial<Project>): Observable<Project> {
    return this.http.put<Project>(`${this.apiUrl}/${id}`, changes, { headers: this.headers });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`, { headers: this.headers });
  }

  addCollaborator(projectId: string, email: string, role: string): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/${projectId}/collaborators`,
      { email, role },
      { headers: this.headers }
    );
  }

  getWorkHistory(projectId: string, userId?: number): Observable<{ sessions: any[]; totalDurationSeconds: number }> {
    const url = userId 
      ? `${this.apiUrl}/${projectId}/work-history?userId=${userId}` 
      : `${this.apiUrl}/${projectId}/work-history`;
    return this.http.get<{ sessions: any[]; totalDurationSeconds: number }>(url, { headers: this.headers });
  }

  generateSQL(projectId: string): Observable<{ sql: string }> {
    return this.http.post<{ sql: string }>(
      `http://3.138.124.211:3000/api/sql/generate/${projectId}`,
      {},
      { headers: this.headers }
    );
  }

  exportXMI(projectId: string): Observable<{ xmi: string }> {
    return this.http.get<{ xmi: string }>(
      `http://3.138.124.211:3000/api/architect/export/${projectId}`,
      { headers: this.headers }
    );
  }

  importXMI(projectId: string, xmi: string): Observable<any> {
    return this.http.post(
      `http://3.138.124.211:3000/api/architect/import/${projectId}`,
      { xmi },
      { headers: this.headers }
    );
  }

  exportCanonicalJson(projectId: string, nodes?: any[], connectors?: any[], projectName?: string): Observable<any> {
    return this.http.post<any>(
      `http://3.138.124.211:3000/api/architect/export-json`,
      { projectId, nodes, connectors, projectName },
      { headers: this.headers }
    );
  }

  downloadSpringBootZip(projectId: string, nodes?: any[], connectors?: any[], projectName?: string): Observable<Blob> {
    return this.http.post(
      `http://3.138.124.211:3000/api/architect/generate-springboot`,
      { projectId, nodes, connectors, projectName },
      {
        headers: new HttpHeaders({
          Authorization: `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json'
        }),
        responseType: 'blob'
      }
    );
  }
}

