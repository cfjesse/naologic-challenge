import './test-init';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from './services/auth';
import { RouterModule } from '@angular/router';
import { signal } from '@angular/core';

describe('App', () => {
  let authServiceMock: any;

  beforeEach(async () => {
    authServiceMock = {
      isLoggedIn: vi.fn().mockReturnValue(true),
      isAdmin: signal(true),
      logout: vi.fn(),
      user: signal({ username: 'Test' })
    };

    await TestBed.configureTestingModule({
      imports: [App, RouterModule.forRoot([])],
      providers: [
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render navbar when logged in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.navbar')).toBeTruthy();
    expect(compiled.querySelector('.brand-primary')?.textContent).toContain('NAOLOGIC');
  });
});
