import '../test-init';
import { TestBed } from '@angular/core/testing';
import { WorkOrderStore } from './work-order.store';
import { ApiService } from '../services/api';
import { of } from 'rxjs';
import { WorkOrderDocument } from '../models/work-order.model';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const apiServiceMock = {
  getWorkOrders: vi.fn(),
  getWorkCenters: vi.fn(),
  createWorkOrder: vi.fn(),
  updateWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  updateWorkCenter: vi.fn(),
  getSettings: vi.fn()
};

describe('WorkOrderStore', () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks();
    apiServiceMock.getWorkOrders.mockReturnValue(of([]));
    apiServiceMock.getWorkCenters.mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        WorkOrderStore,
        { provide: ApiService, useValue: apiServiceMock }
      ]
    });

    store = TestBed.inject(WorkOrderStore);
  });

  it('should initialize with default state', () => {
    expect(store.dataSource()).toBe('local');
    expect(store.workCenters().length).toBe(5); // Default centers
  });

  describe('Work Order Operations', () => {
    it('should add work order', () => {
      const initialCount = store.workOrders().length;
      store.addWorkOrder({ name: 'New', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' });
      expect(store.workOrders().length).toBe(initialCount + 1);
    });

    it('should update work order', () => {
      store.setWorkOrders([{ docId: '1', docType: 'workOrder', data: { name: 'Old', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } }]);
      store.updateWorkOrder('1', { name: 'New', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' });
      expect(store.workOrders()[0].data.name).toBe('New');
    });

    it('should delete work order', () => {
      store.setWorkOrders([{ docId: '1', docType: 'workOrder', data: { name: 'Kill', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } }]);
      store.deleteWorkOrder('1');
      expect(store.workOrders().length).toBe(0);
    });
  });

  describe('Work Center Operations', () => {
    it('should update work center name', () => {
      store.updateWorkCenter('wc-1', 'New Machine');
      const wc = store.workCenters().find((c: any) => c.docId === 'wc-1');
      expect(wc.data.name).toBe('New Machine');
    });
  });

  describe('Overlap Detection', () => {
    it('should detect overlap', () => {
      store.setWorkOrders([{ 
        docId: '1', docType: 'workOrder', 
        data: { name: 'A', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } 
      }]);
      const overlap = store.checkOverlap('wc-1', '2026-01-05', '2026-01-15');
      expect(overlap).toBeDefined();
      expect(overlap?.docId).toBe('1');
    });

    it('should allow non-overlapping orders', () => {
      store.setWorkOrders([{ 
        docId: '1', docType: 'workOrder', 
        data: { name: 'A', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } 
      }]);
      const overlap = store.checkOverlap('wc-1', '2026-01-10', '2026-01-20');
      expect(overlap).toBeUndefined();
    });
  });
});
