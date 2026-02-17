import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';

export type UserRole = 'admin' | 'user' | null;

export interface User {
  username: string;
  role: UserRole;
}

interface LoginResponse {
  success: boolean;
  user?: User;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  
  private _currentUser = signal<User | null>(null);
  
  readonly user = this._currentUser.asReadonly();
  readonly role = computed(() => this._currentUser()?.role || null);
  readonly isAuthenticated = computed(() => !!this._currentUser());
  readonly isAdmin = computed(() => this.role() === 'admin');

  constructor() {
    const stored = sessionStorage.getItem('erp_user');
    if (stored) {
      try {
        this._currentUser.set(JSON.parse(stored));
      } catch {}
    }
  }

  login(username: string, password: string): Observable<boolean> {
    return this.http.post<LoginResponse>('http://localhost:3000/api/auth/login', { username, password })
      .pipe(
        map(response => {
          if (response.success && response.user) {
            this.setUser(response.user);
            return true;
          }
          return false;
        }),
        catchError(err => {
          console.warn('Login server unavailable, attempting local fallback', err);
          
          // Fallback to local credential check
          if (username === 'admin' && password === 'admin') {
            this.setUser({ username: 'Admin', role: 'admin' });
            return of(true);
          }
          if (username === 'user' && password === 'user') {
            this.setUser({ username: 'User', role: 'user' });
            return of(true);
          }
          
          return of(false);
        })
      );
  }

  logout(): void {
    this._currentUser.set(null);
    sessionStorage.removeItem('erp_user');
    this.router.navigate(['/login']);
  }

  private setUser(user: User): void {
    this._currentUser.set(user);
    sessionStorage.setItem('erp_user', JSON.stringify(user));
    this.router.navigate(['/']);
  }

  isLoggedIn(): boolean {
    return !!this._currentUser();
  }
}
