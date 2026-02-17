// Application Routes
import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './services/auth';

const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

const adminGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/work-order-timeline/work-order-timeline').then(
        (m) => m.WorkOrderTimelineComponent
      ),
  },
  {
    path: 'data-source',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./components/data-source-selector/data-source-selector').then(
        (m) => m.DataSourceSelectorComponent
      ),
  },
  { path: '**', redirectTo: '' }
];
