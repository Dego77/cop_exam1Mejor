import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://3.138.124.211:3000/api/auth';
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {
    const token = localStorage.getItem('classforge_token');
    const user = localStorage.getItem('classforge_user');
    if (token && user) {
      this.currentUserSubject.next(JSON.parse(user));
    }
  }

  get currentUser(): User | null { return this.currentUserSubject.value; }
  get token(): string | null { return localStorage.getItem('classforge_token'); }
  get isLoggedIn(): boolean { return !!this.token; }

  register(email: string, password: string, fullName: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/register`, { email, password, fullName }).pipe(
      tap((res: any) => this.saveSession(res))
    );
  }

  login(email: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, { email, password }).pipe(
      tap((res: any) => this.saveSession(res))
    );
  }

  logout(): void {
    localStorage.removeItem('classforge_token');
    localStorage.removeItem('classforge_user');
    
    // Clear all user-specific projects cache from localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('classforge_projects_cache')) {
        localStorage.removeItem(key);
      }
    });

    this.currentUserSubject.next(null);
  }


  private saveSession(res: any): void {
    localStorage.setItem('classforge_token', res.token);
    localStorage.setItem('classforge_user', JSON.stringify(res.user));
    this.currentUserSubject.next(res.user);
  }
}
