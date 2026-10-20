import '../test-init';
import { TestBed } from '@angular/core/testing';
import { WorkOrderStore } from './work-order.store';
import { ApiService } from '../services/api';
import { of } from 'rxjs';
import { WorkOrderDocument } from '../models/work-order.model';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockCenters = [
  { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line A', isDefault: true } },
  { docId: 'wc-2', docType: 'workCenter', data: { name: 'CNC Machine 1', isDefault: true } },
  { docId: 'wc-3', docType: 'workCenter', data: { name: 'Assembly Station', isDefault: true } },
  { docId: 'wc-4', docType: 'workCenter', data: { name: 'Quality Control', isDefault: true } },
  { docId: 'wc-5', docType: 'workCenter', data: { name: 'Packaging Line', isDefault: true } },
];

const apiServiceMock = {
  getWorkOrders: vi.fn(),
  getWorkCenters: vi.fn(),
  createWorkOrder: vi.fn(),
  updateWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  createWorkCenter: vi.fn(),
  updateWorkCenter: vi.fn(),
  deleteWorkCenter: vi.fn(),
  getSettings: vi.fn(),
  reloadAll: vi.fn(),
  generateOrders: vi.fn(),
  resetData: vi.fn(),
  ordersSignal: vi.fn().mockReturnValue([]),
  centersSignal: vi.fn().mockReturnValue([]),
};

describe('WorkOrderStore', () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks();
    apiServiceMock.getWorkOrders.mockReturnValue(of([]));
    apiServiceMock.getWorkCenters.mockReturnValue(of(mockCenters));
    apiServiceMock.createWorkOrder.mockReturnValue(of({}));
    apiServiceMock.updateWorkOrder.mockReturnValue(of({}));
    apiServiceMock.deleteWorkOrder.mockReturnValue(of({}));
    apiServiceMock.createWorkCenter.mockReturnValue(of({}));
    apiServiceMock.updateWorkCenter.mockReturnValue(of({}));
    apiServiceMock.deleteWorkCenter.mockReturnValue(of({}));
    apiServiceMock.generateOrders.mockReturnValue(of([]));
    apiServiceMock.resetData.mockReturnValue(of({ workCenters: mockCenters, workOrders: [], settings: {} }));

    TestBed.configureTestingModule({
      providers: [
        WorkOrderStore,
        { provide: ApiService, useValue: apiServiceMock }
      ]
    });

    store = TestBed.inject(WorkOrderStore);
  });

  it('should initialize with default state and pull from API', () => {
    expect(store.dataSource()).toBe('server');
    expect(store.workCenters().length).toBe(5);
    expect(apiServiceMock.getWorkCenters).toHaveBeenCalled();
    expect(apiServiceMock.getWorkOrders).toHaveBeenCalled();
  });

  describe('Work Order Operations', () => {
    it('should add work order and call API', () => {
      const initialCount = store.workOrders().length;
      store.addWorkOrder({ name: 'New', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' });
      expect(store.workOrders().length).toBe(initialCount + 1);
      expect(apiServiceMock.createWorkOrder).toHaveBeenCalled();
    });

    it('should update work order and call API', () => {
      store.setWorkOrders([{ docId: '1', docType: 'workOrder', data: { name: 'Old', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } }]);
      store.updateWorkOrder('1', { name: 'New', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' });
      expect(store.workOrders()[0].data.name).toBe('New');
      expect(apiServiceMock.updateWorkOrder).toHaveBeenCalledWith('1', expect.anything());
    });

    it('should delete work order and call API', () => {
      store.setWorkOrders([{ docId: '1', docType: 'workOrder', data: { name: 'Kill', startDate: '2026-01-01', endDate: '2026-01-10', status: 'open', workCenterId: 'wc-1' } }]);
      store.deleteWorkOrder('1');
      expect(store.workOrders().length).toBe(0);
      expect(apiServiceMock.deleteWorkOrder).toHaveBeenCalledWith('1');
    });
  });

  describe('Work Center Operations', () => {
    it('should add work center and call API', () => {
      const initialCount = store.workCenters().length;
      const created = store.addWorkCenter('Robotics Bay');
      expect(store.workCenters().length).toBe(initialCount + 1);
      expect(created.data.name).toBe('Robotics Bay');
      expect(apiServiceMock.createWorkCenter).toHaveBeenCalled();
    });

    it('should update work center name and call API', () => {
      store.updateWorkCenter('wc-1', 'New Machine');
      const wc = store.workCenters().find((c: any) => c.docId === 'wc-1');
      expect(wc.data.name).toBe('New Machine');
      expect(apiServiceMock.updateWorkCenter).toHaveBeenCalledWith('wc-1', { name: 'New Machine' });
    });

    it('should delete work center and call API', () => {
      store.deleteWorkCenter('wc-1');
      expect(store.workCenters().some((c: any) => c.docId === 'wc-1')).toBe(false);
      expect(apiServiceMock.deleteWorkCenter).toHaveBeenCalledWith('wc-1');
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

  describe('Data Actions', () => {
    it('should refresh data from API', () => {
      store.refreshData();
      expect(apiServiceMock.reloadAll).toHaveBeenCalled();
      expect(apiServiceMock.getWorkCenters).toHaveBeenCalled();
      expect(apiServiceMock.getWorkOrders).toHaveBeenCalled();
    });

    it('should generate new data from API', () => {
      store.generateNewData();
      expect(apiServiceMock.generateOrders).toHaveBeenCalled();
    });

    it('should reset to defaults from API', () => {
      store.resetToDefaults();
      expect(apiServiceMock.resetData).toHaveBeenCalled();
    });
  });
});
