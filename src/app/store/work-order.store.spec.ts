import { TestBed } from '@angular/core/testing';
import { WorkOrderStore } from './work-order.store';
import { ApiService } from '../services/api';
import { of } from 'rxjs';
import { WorkOrderDocument } from '../models/work-order.model';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock ApiService
const apiServiceMock = {
  getWorkOrders: vi.fn(),
  createWorkOrder: vi.fn(),
  updateWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  getSettings: vi.fn()
};

describe('WorkOrderStore', () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    TestBed.configureTestingModule({
      providers: [
        WorkOrderStore,
        { provide: ApiService, useValue: apiServiceMock }
      ]
    });

    store = TestBed.inject(WorkOrderStore);
  });

  it('should be created', () => {
    expect(store).toBeTruthy();
  });

  it('should initialize with default state', () => {
    expect(store.dataSource()).toBe('local');
    // WorkOrders are set in onInit, which runs on creation.
    // The store initializes with randomized data by default if local storage is empty/invalid.
    expect(store.workOrders().length).toBeGreaterThan(0);
    expect(store.workCenters().length).toBe(5);
  });

  describe('DataSource Switching', () => {
    it('should set dataSource to server and fetch orders', () => {
      const mockServerOrders: WorkOrderDocument[] = [
        { docId: 's1', docType: 'workOrder', data: { name: 'Server Order', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' } }
      ];
      apiServiceMock.getWorkOrders.mockReturnValue(of(mockServerOrders));

      store.setDataSource('server');

      expect(store.dataSource()).toBe('server');
      expect(store.isLoading()).toBe(false);
      expect(apiServiceMock.getWorkOrders).toHaveBeenCalled();
      expect(store.workOrders()).toEqual(mockServerOrders);
    });

    it('should set dataSource to local and load from localStorage', () => {
      const mockLocalOrders: WorkOrderDocument[] = [
        { docId: 'l1', docType: 'workOrder', data: { name: 'Local Order', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' } }
      ];
      
      // Spy on localStorage
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      getItemSpy.mockReturnValue(JSON.stringify(mockLocalOrders));

      store.setDataSource('local');

      expect(store.dataSource()).toBe('local');
      expect(store.workOrders()).toEqual(mockLocalOrders);
      
      getItemSpy.mockRestore();
    });
  });

  describe('CRUD Operations', () => {
    it('should add work order locally', () => {
      store.setDataSource('local');
      const initialCount = store.workOrders().length;
      const newOrderData = { name: 'New Local', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' };

      store.addWorkOrder(newOrderData);

      expect(store.workOrders().length).toBe(initialCount + 1);
      const addedOrder = store.workOrders()[store.workOrders().length - 1]; // Last one
      expect(addedOrder.data.name).toBe('New Local');
      expect(apiServiceMock.createWorkOrder).not.toHaveBeenCalled();
    });

    it('should add work order and sync to server if connected', () => {
      // Setup server mode
      apiServiceMock.getWorkOrders.mockReturnValue(of([]));
      apiServiceMock.createWorkOrder.mockReturnValue(of({} as WorkOrderDocument));
      store.setDataSource('server');

      const newOrderData = { name: 'New Server', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' };

      store.addWorkOrder(newOrderData);

      expect(apiServiceMock.createWorkOrder).toHaveBeenCalled();
    });

    it('should delete work order', () => {
      store.setDataSource('local');
      // Ensure at least one order exists
      if (store.workOrders().length === 0) {
          store.addWorkOrder({ name: 'Temp', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' });
      }
      const order = store.workOrders()[0];
      const docId = order.docId;

      store.deleteWorkOrder(docId);

      expect(store.workOrders().find((o: WorkOrderDocument) => o.docId === docId)).toBeUndefined();
    });
  });

  describe('checkOverlap', () => {
    it('should detect overlapping orders', () => {
      const existingOrder: WorkOrderDocument = { 
        docId: 'o1', docType: 'workOrder', 
        data: { name: 'Existing', startDate: '2023-01-10', endDate: '2023-01-20', status: 'open', workCenterId: 'wc1' } 
      };
      store.setWorkOrders([existingOrder]);

      const overlap = store.checkOverlap('wc1', '2023-01-15', '2023-01-25');
      expect(overlap).toBeDefined();
      expect(overlap?.docId).toBe('o1');
    });

    it('should not detect overlap for different work center', () => {
      const existingOrder: WorkOrderDocument = { 
        docId: 'o1', docType: 'workOrder', 
        data: { name: 'Existing', startDate: '2023-01-10', endDate: '2023-01-20', status: 'open', workCenterId: 'wc1' } 
      };
      store.setWorkOrders([existingOrder]);

      const overlap = store.checkOverlap('wc2', '2023-01-15', '2023-01-25');
      expect(overlap).toBeUndefined();
    });
  });
});
