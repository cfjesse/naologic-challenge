import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TimeScale, WorkOrderDocument } from '../models/work-order.model';

export interface AppSettings {
  timeScale: TimeScale;
  theme: 'light' | 'dark';
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:3000/api';

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.baseUrl}/settings`).pipe(
      catchError(err => {
        console.error('Failed to fetch settings from API, falling back to default', err);
        return of({ timeScale: 'Day', theme: 'light' } as AppSettings);
      })
    );
  }

  updateSettings(settings: Partial<AppSettings>): Observable<AppSettings> {
    return this.http.post<AppSettings>(`${this.baseUrl}/settings`, settings).pipe(
      catchError(err => {
        console.error('Failed to save settings to API', err);
        throw err;
      })
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
    return this.http.post<WorkOrderDocument>(`${this.baseUrl}/orders`, order);
  }

  updateWorkOrder(docId: string, data: Partial<WorkOrderDocument['data']>): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/orders/${docId}`, data);
  }

  deleteWorkOrder(docId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/orders/${docId}`);
  }
}
