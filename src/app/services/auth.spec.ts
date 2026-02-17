import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let routerSpy: { navigate: any };

  beforeEach(() => {
    routerSpy = { navigate: vi.fn() };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: Router, useValue: routerSpy }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login successfully as admin', () => {
    service.login('admin', 'admin').subscribe(success => {
      expect(success).toBe(true);
      expect(service.user()).toEqual({ username: 'Admin', role: 'admin' });
      expect(service.isAdmin()).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/']);
    });

    const req = httpMock.expectOne('http://localhost:3000/api/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, user: { username: 'Admin', role: 'admin' } });
  });

  it('should handle login failure', () => {
    service.login('wrong', 'wrong').subscribe(success => {
      expect(success).toBe(false);
      expect(service.user()).toBeNull();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/auth/login');
    req.flush({ success: false, message: 'Invalid credentials' });
  });

  it('should logout correctly', () => {
    // Set initial user (simulate login)
    const adminUser = { username: 'Admin', role: 'admin' as const };
    (service as any).setUser(adminUser); // Access private method for setup
    
    expect(service.isAuthenticated()).toBe(true);

    service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(sessionStorage.getItem('erp_user')).toBeNull();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});
