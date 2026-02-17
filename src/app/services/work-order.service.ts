import { Injectable, signal, computed } from '@angular/core';
import {
  WorkCenterDocument,
  WorkOrderDocument,
  WorkOrderStatus,
} from '../models/work-order.model';

/**
 * WorkOrderService — injectable data layer for work centers & work orders.
 *
 * Responsibilities:
 *  - Holds all work center and work order state as signals
 *  - Provides CRUD operations for work orders
 *  - Persists to localStorage for page-refresh survival (bonus)
 *  - Overlap detection logic
 *
 * @upgrade Add HTTP integration for real backend
 */
@Injectable({ providedIn: 'root' })
export class WorkOrderService {
  private readonly STORAGE_KEY = 'naologic_work_orders';
  private readonly WC_STORAGE_KEY = 'naologic_work_centers';

  /* ── Work Centers (5+, realistic manufacturing names) ── */
  readonly workCenters = signal<WorkCenterDocument[]>(this.loadWorkCenters());

  /* ── Work Orders (8+, all 4 statuses, multiple on same center) ── */
  readonly workOrders = signal<WorkOrderDocument[]>(this.loadWorkOrders());

  /* ── UUID generator ── */
  static generateId(): string {
    // crypto.randomUUID() — native UUID v4
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: RFC 4122-compliant UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* ── CRUD ── */

  addWorkOrder(data: WorkOrderDocument['data']): WorkOrderDocument {
    const newOrder: WorkOrderDocument = {
      docId: WorkOrderService.generateId(),
      docType: 'workOrder',
      data: { ...data },
    };
    this.workOrders.update((orders) => [...orders, newOrder]);
    this.persist();
    return newOrder;
  }

  updateWorkOrder(docId: string, data: WorkOrderDocument['data']): void {
    this.workOrders.update((orders) =>
      orders.map((o) => (o.docId === docId ? { ...o, data: { ...data } } : o))
    );
    this.persist();
  }

  deleteWorkOrder(docId: string): void {
    this.workOrders.update((orders) => orders.filter((o) => o.docId !== docId));
    this.persist();
  }

  /**
   * Overlap detection — checks whether a proposed date range overlaps
   * with any existing work order on the same work center.
   *
   * Two date ranges [A_start, A_end) and [B_start, B_end) overlap iff
   * A_start < B_end AND A_end > B_start.
   *
   * @param workCenterId  The work center to check
   * @param startDate     ISO start date of the proposed range
   * @param endDate       ISO end date of the proposed range
   * @param excludeDocId  Optional: exclude this order (for edit mode)
   * @returns The conflicting order, or null if no overlap
   */
  checkOverlap(
    workCenterId: string,
    startDate: string,
    endDate: string,
    excludeDocId?: string,
  ): WorkOrderDocument | null {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    const existing = this.workOrders().filter(
      (o) => o.data.workCenterId === workCenterId && o.docId !== excludeDocId
    );

    for (const o of existing) {
      const oStart = new Date(o.data.startDate).getTime();
      const oEnd = new Date(o.data.endDate).getTime();
      if (start < oEnd && end > oStart) {
        return o;
      }
    }
    return null;
  }

  getOrdersForWorkCenter(workCenterId: string): WorkOrderDocument[] {
    return this.workOrders().filter((o) => o.data.workCenterId === workCenterId);
  }

  getWorkCenterName(workCenterId: string): string {
    const wc = this.workCenters().find((w) => w.docId === workCenterId);
    return wc ? wc.data.name : workCenterId;
  }

  /* ── localStorage persistence ── */

  private persist(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.workOrders()));
    } catch {
      // localStorage may be unavailable (SSR, private browsing quota)
    }
  }

  private loadWorkOrders(): WorkOrderDocument[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WorkOrderDocument[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fall through to defaults
    }
    return this.getDefaultWorkOrders();
  }

  private loadWorkCenters(): WorkCenterDocument[] {
    return [
      { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line A' } },
      { docId: 'wc-2', docType: 'workCenter', data: { name: 'CNC Machine 1' } },
      { docId: 'wc-3', docType: 'workCenter', data: { name: 'Assembly Station' } },
      { docId: 'wc-4', docType: 'workCenter', data: { name: 'Quality Control' } },
      { docId: 'wc-5', docType: 'workCenter', data: { name: 'Packaging Line' } },
    ];
  }

  /**
   * Default sample data: 9 work orders across 5 work centers, all 4 statuses.
   * Work centers wc-1, wc-3, and wc-5 each have multiple non-overlapping orders.
   */
  private getDefaultWorkOrders(): WorkOrderDocument[] {
    return [
      {
        docId: '550e8400-e29b-41d4-a716-446655440001',
        docType: 'workOrder',
        data: { name: 'Centrix Ltd', workCenterId: 'wc-1', status: 'complete', startDate: '2024-08-10', endDate: '2024-10-05' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440002',
        docType: 'workOrder',
        data: { name: 'Rodriques Electrics', workCenterId: 'wc-2', status: 'in-progress', startDate: '2024-09-15', endDate: '2024-11-01' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440003',
        docType: 'workOrder',
        data: { name: 'Konsulting Inc', workCenterId: 'wc-3', status: 'in-progress', startDate: '2024-08-20', endDate: '2024-11-10' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440004',
        docType: 'workOrder',
        data: { name: 'Compleks Systems', workCenterId: 'wc-3', status: 'open', startDate: '2024-11-12', endDate: '2025-02-15' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440005',
        docType: 'workOrder',
        data: { name: 'McMarrow Distribution', workCenterId: 'wc-4', status: 'blocked', startDate: '2024-09-01', endDate: '2025-01-20' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440006',
        docType: 'workOrder',
        data: { name: 'Spartan Assembly', workCenterId: 'wc-5', status: 'open', startDate: '2024-10-01', endDate: '2024-12-15' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440007',
        docType: 'workOrder',
        data: { name: 'Nordic Components', workCenterId: 'wc-1', status: 'in-progress', startDate: '2024-11-01', endDate: '2025-01-10' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440008',
        docType: 'workOrder',
        data: { name: 'Precision Tooling', workCenterId: 'wc-2', status: 'blocked', startDate: '2024-11-15', endDate: '2025-02-28' },
      },
      {
        docId: '550e8400-e29b-41d4-a716-446655440009',
        docType: 'workOrder',
        data: { name: 'Apex Manufacturing', workCenterId: 'wc-5', status: 'complete', startDate: '2025-01-05', endDate: '2025-03-01' },
      },
    ];
  }
}
