import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkOrderService } from './work-order.service';
import { WorkOrderDocument } from '../models/work-order.model';

// Mock localStorage if needed, but jsdom provides it.
// Mock uuid if needed, but it's fine.

describe('WorkOrderService Overlap Logic', () => {
  let service: WorkOrderService;

  beforeEach(() => {
    // Clear localStorage to prevent interference
    localStorage.clear();
    service = new WorkOrderService();
    (service.workOrders as any).set([]);
  });

  it('should allow non-overlapping orders', () => {
    const existing: WorkOrderDocument = {
      docId: '1', docType: 'workOrder',
      data: { name: 'A', workCenterId: 'wc-1', status: 'open', startDate: '2026-01-01', endDate: '2026-01-05' }
    };
    (service.workOrders as any).set([existing]);

    // Check after
    const overlap1 = service.checkOverlap('wc-1', '2026-01-05', '2026-01-10');
    expect(overlap1).toBeNull();

    // Check before
    const overlap2 = service.checkOverlap('wc-1', '2025-12-25', '2026-01-01');
    expect(overlap2).toBeNull();
  });

  it('should detect overlap (partial)', () => {
    const existing: WorkOrderDocument = {
      docId: '1', docType: 'workOrder',
      data: { name: 'A', workCenterId: 'wc-1', status: 'open', startDate: '2026-01-01', endDate: '2026-01-05' }
    };
    (service.workOrders as any).set([existing]);

    // Starts before, ends inside
    expect(service.checkOverlap('wc-1', '2025-12-31', '2026-01-02')).not.toBeNull();
    
    // Starts inside, ends after
    expect(service.checkOverlap('wc-1', '2026-01-04', '2026-01-06')).not.toBeNull();
  });

  it('should detect overlap (engulfing/engulfed)', () => {
    const existing: WorkOrderDocument = {
      docId: '1', docType: 'workOrder',
      data: { name: 'A', workCenterId: 'wc-1', status: 'open', startDate: '2026-01-05', endDate: '2026-01-10' }
    };
    (service.workOrders as any).set([existing]);

     // Existing is inside new
    expect(service.checkOverlap('wc-1', '2026-01-01', '2026-01-15')).not.toBeNull();
    
    // New is inside existing
    expect(service.checkOverlap('wc-1', '2026-01-06', '2026-01-09')).not.toBeNull();
  });

  it('should ignore other work centers', () => {
    const existing: WorkOrderDocument = {
      docId: '1', docType: 'workOrder',
      data: { name: 'A', workCenterId: 'wc-1', status: 'open', startDate: '2026-01-01', endDate: '2026-01-05' }
    };
    (service.workOrders as any).set([existing]);

    // Same dates, different WC
    expect(service.checkOverlap('wc-2', '2026-01-01', '2026-01-05')).toBeNull();
  });

  it('should exclude self when editing', () => {
    const existing: WorkOrderDocument = {
      docId: '1', docType: 'workOrder',
      data: { name: 'A', workCenterId: 'wc-1', status: 'open', startDate: '2026-01-01', endDate: '2026-01-05' }
    };
    (service.workOrders as any).set([existing]);

    // Check overlap with strictly self
    expect(service.checkOverlap('wc-1', '2026-01-02', '2026-01-04', '1')).toBeNull();
  });
});
