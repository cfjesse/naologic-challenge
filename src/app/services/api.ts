import { Injectable, inject, computed, signal, effect } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { TimeScale, WorkOrderDocument, WorkCenterDocument, WorkOrderStatus } from '../models/work-order.model';
import { ThemeService, AppTheme } from './theme.service';

export interface AppSettings {
  timeScale: TimeScale;
  theme: 'light' | 'dark';
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly themeService = inject(ThemeService);
  private readonly SETTINGS_STORAGE_KEY = 'naologic_erp_settings';

  private readonly baseUrl = (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost')
    ? '/api'
    : 'http://localhost:3000/api';

  /* ── Session Storage Helpers ── */
  loadSettingsFromSession(): AppSettings {
    const defaultSettings: AppSettings = { timeScale: 'Day', theme: this.themeService.theme() };
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const storedTheme = window.sessionStorage.getItem('theme') as 'light' | 'dark' | null;
        const stored = window.sessionStorage.getItem(this.SETTINGS_STORAGE_KEY);
        let parsed = {};
        if (stored) {
          parsed = JSON.parse(stored);
        }
        const combined = { ...defaultSettings, ...parsed };
        if (storedTheme === 'light' || storedTheme === 'dark') {
          combined.theme = storedTheme;
        }
        return combined;
      } catch (err) {
        console.warn('ApiService: Error loading settings from sessionStorage', err);
      }
    }
    return defaultSettings;
  }

  saveSettingsToSession(settings: AppSettings): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(this.SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        if (settings.theme) {
          window.sessionStorage.setItem('theme', settings.theme);
        }
      } catch (err) {
        console.warn('ApiService: Error saving settings to sessionStorage', err);
      }
    }
  }

  clearSessionSettings(): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(this.SETTINGS_STORAGE_KEY);
        window.sessionStorage.removeItem('theme');
      } catch (err) {
        console.warn('ApiService: Error clearing settings from sessionStorage', err);
      }
    }
    const defaultSettings: AppSettings = { timeScale: 'Day', theme: 'dark' };
    this._settingsState.set(defaultSettings);
    this.themeService.setTheme('dark');
  }

  /* ── Theme Delegation to Signal ThemeService ── */
  applyTheme(theme: 'light' | 'dark'): void {
    this.themeService.setTheme(theme);
  }

  /* ── Reactive State & Resources ── */
  private readonly _settingsState = signal<AppSettings>(this.loadSettingsFromSession());

  /* ── Signal-based HTTP Resources (Angular 19/20/21 httpResource) ── */
  readonly settingsResource = httpResource<AppSettings>(() => `${this.baseUrl}/settings`, {
    defaultValue: this.loadSettingsFromSession()
  });

  readonly ordersResource = httpResource<WorkOrderDocument[]>(() => `${this.baseUrl}/orders`, {
    defaultValue: []
  });

  readonly centersResource = httpResource<WorkCenterDocument[]>(() => `${this.baseUrl}/work-centers`, {
    defaultValue: []
  });

  /* ── Reactive Resource using rxResource ── */
  readonly liveOrdersRxResource = rxResource({
    defaultValue: [] as WorkOrderDocument[],
    stream: () => this.http.get<WorkOrderDocument[]>(`${this.baseUrl}/orders`).pipe(
      catchError(() => of([] as WorkOrderDocument[]))
    )
  });

  /* ── Signal Getters ── */
  readonly settingsSignal = computed<AppSettings>(() => {
    const resourceVal = this.settingsResource.value();
    const stateVal = this._settingsState();
    return resourceVal ? { ...stateVal, ...resourceVal } : stateVal;
  });

  readonly currentTheme = computed<'light' | 'dark'>(() => {
    return this.themeService.theme();
  });

  readonly ordersSignal = this.ordersResource.value;
  readonly centersSignal = this.centersResource.value;
  readonly isLoadingSignal = computed(
    () => this.ordersResource.isLoading() || this.centersResource.isLoading()
  );

  constructor() {
    // When remote settings resolve with a theme, sync with ThemeService
    effect(() => {
      const remoteSettings = this.settingsResource.value();
      if (remoteSettings?.theme && (remoteSettings.theme === 'light' || remoteSettings.theme === 'dark')) {
        this.themeService.setTheme(remoteSettings.theme);
      }
    });
  }

  /* ── Reload Trigger Methods ── */
  reloadAll(): void {
    this.settingsResource.reload();
    this.ordersResource.reload();
    this.centersResource.reload();
    this.liveOrdersRxResource.reload();
  }

  reloadOrders(): void {
    this.ordersResource.reload();
    this.liveOrdersRxResource.reload();
  }

  reloadCenters(): void {
    this.centersResource.reload();
  }

  /* ── CRUD Operations with Automatic Resource Synchronization ── */

  // Settings
  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.baseUrl}/settings`).pipe(
      tap(settings => {
        if (settings) {
          this._settingsState.set(settings);
          this.saveSettingsToSession(settings);
          if (settings.theme) {
            this.applyTheme(settings.theme);
          }
        }
      }),
      catchError(err => {
        console.error('Failed to fetch settings from API, falling back to session/default', err);
        return of(this.loadSettingsFromSession());
      })
    );
  }

  updateSettings(settings: Partial<AppSettings>): Observable<AppSettings> {
    const current = this.loadSettingsFromSession();
    const updated: AppSettings = { ...current, ...settings };
    this._settingsState.set(updated);
    this.saveSettingsToSession(updated);
    if (updated.theme) {
      this.applyTheme(updated.theme);
    }

    return this.http.post<AppSettings>(`${this.baseUrl}/settings`, settings).pipe(
      tap(() => this.settingsResource.reload()),
      catchError(err => {
        console.error('Failed to save settings to API', err);
        throw err;
      })
    );
  }

  setTheme(theme: 'light' | 'dark'): Observable<AppSettings> {
    this.themeService.setTheme(theme);
    return this.updateSettings({ theme });
  }

  toggleTheme(): Observable<AppSettings> {
    const nextTheme: 'light' | 'dark' = this.themeService.toggleTheme();
    return this.updateSettings({ theme: nextTheme });
  }

  // Lookups & Dropdowns
  getStatuses(): Observable<{ value: WorkOrderStatus; label: string; colorClass: string }[]> {
    return this.http.get<{ value: WorkOrderStatus; label: string; colorClass: string }[]>(`${this.baseUrl}/statuses`).pipe(
      catchError(() => of([
        { value: 'open' as WorkOrderStatus, label: 'Open', colorClass: 'status-open' },
        { value: 'in-progress' as WorkOrderStatus, label: 'In Progress', colorClass: 'status-in-progress' },
        { value: 'complete' as WorkOrderStatus, label: 'Complete', colorClass: 'status-complete' },
        { value: 'blocked' as WorkOrderStatus, label: 'Blocked', colorClass: 'status-blocked' },
      ]))
    );
  }

  getTimescales(): Observable<TimeScale[]> {
    return this.http.get<TimeScale[]>(`${this.baseUrl}/timescales`).pipe(
      catchError(() => of(['Day', 'Week', 'Month'] as TimeScale[]))
    );
  }

  // Work Orders
  getWorkOrders(): Observable<WorkOrderDocument[]> {
    return this.http.get<WorkOrderDocument[]>(`${this.baseUrl}/orders`).pipe(
      catchError(err => {
        console.error('API: Failed to fetch work orders', err);
        return of([]);
      })
    );
  }

  createWorkOrder(order: WorkOrderDocument): Observable<WorkOrderDocument> {
    return this.http.post<WorkOrderDocument>(`${this.baseUrl}/orders`, order).pipe(
      tap(() => this.reloadOrders())
    );
  }

  updateWorkOrder(docId: string, data: Partial<WorkOrderDocument['data']>): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/orders/${docId}`, data).pipe(
      tap(() => this.reloadOrders())
    );
  }

  deleteWorkOrder(docId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/orders/${docId}`).pipe(
      tap(() => this.reloadOrders())
    );
  }

  // Work Centers
  getWorkCenters(): Observable<WorkCenterDocument[]> {
    return this.http.get<WorkCenterDocument[]>(`${this.baseUrl}/work-centers`).pipe(
      catchError(err => {
        console.error('API: Failed to fetch work centers', err);
        return of([]);
      })
    );
  }

  createWorkCenter(center: WorkCenterDocument): Observable<WorkCenterDocument> {
    return this.http.post<WorkCenterDocument>(`${this.baseUrl}/work-centers`, center).pipe(
      tap(() => this.reloadCenters())
    );
  }

  updateWorkCenter(docId: string, data: Partial<WorkCenterDocument['data']>): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/work-centers/${docId}`, data).pipe(
      tap(() => this.reloadCenters())
    );
  }

  deleteWorkCenter(docId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/work-centers/${docId}`).pipe(
      tap(() => this.reloadCenters())
    );
  }

  // Batch Generation & Reset
  generateOrders(): Observable<WorkOrderDocument[]> {
    return this.http.post<WorkOrderDocument[]>(`${this.baseUrl}/orders/generate`, {}).pipe(
      tap(() => this.reloadOrders())
    );
  }

  resetData(): Observable<{ workCenters: WorkCenterDocument[]; workOrders: WorkOrderDocument[]; settings: AppSettings }> {
    return this.http.post<{ workCenters: WorkCenterDocument[]; workOrders: WorkOrderDocument[]; settings: AppSettings }>(`${this.baseUrl}/reset`, {}).pipe(
      tap(() => {
        this.clearSessionSettings();
        this.reloadAll();
      })
    );
  }
}
