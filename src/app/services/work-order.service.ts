import { Injectable, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
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
  // Use a new key to force reload of default data with correct dates
  private readonly STORAGE_KEY = 'naologic_work_orders_v2';
  private readonly WC_STORAGE_KEY = 'naologic_work_centers';

  /* ── Work Centers (5+, realistic manufacturing names) ── */
  readonly workCenters = signal<WorkCenterDocument[]>(this.loadWorkCenters());

  /* ── Work Orders (8+, all 4 statuses, multiple on same center) ── */
  readonly workOrders = signal<WorkOrderDocument[]>(this.loadWorkOrders());

  /* ── UUID generator ── */
  static generateId(): string {
    return uuidv4();
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
   * UPDATED to align with current date (Feb 2026).
   */
  private getDefaultWorkOrders(): WorkOrderDocument[] {
    return [
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Centrix Ltd', workCenterId: 'wc-1', status: 'complete', startDate: '2026-01-10', endDate: '2026-02-05' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Rodriques Electrics', workCenterId: 'wc-2', status: 'in-progress', startDate: '2026-02-15', endDate: '2026-04-01' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Konsulting Inc', workCenterId: 'wc-3', status: 'in-progress', startDate: '2026-01-20', endDate: '2026-02-28' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Compleks Systems', workCenterId: 'wc-3', status: 'open', startDate: '2026-03-01', endDate: '2026-04-10' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'McMarrow Distribution', workCenterId: 'wc-4', status: 'blocked', startDate: '2026-02-01', endDate: '2026-05-01' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Spartan Assembly', workCenterId: 'wc-5', status: 'open', startDate: '2026-02-20', endDate: '2026-03-15' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Nordic Components', workCenterId: 'wc-1', status: 'in-progress', startDate: '2026-02-10', endDate: '2026-03-20' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Precision Tooling', workCenterId: 'wc-2', status: 'blocked', startDate: '2026-03-15', endDate: '2026-06-01' },
      },
      {
        docId: uuidv4(),
        docType: 'workOrder',
        data: { name: 'Apex Manufacturing', workCenterId: 'wc-5', status: 'complete', startDate: '2026-01-05', endDate: '2026-02-15' },
      },
    ];
  }
}
