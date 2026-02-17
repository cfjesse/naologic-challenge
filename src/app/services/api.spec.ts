import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService, AppSettings } from './api';
import { WorkOrderDocument } from '../models/work-order.model';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService]
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getSettings', () => {
    it('should return settings from API', () => {
      const mockSettings: AppSettings = { timeScale: 'Month', theme: 'dark' };

      service.getSettings().subscribe(settings => {
        expect(settings).toEqual(mockSettings);
      });

      const req = httpMock.expectOne('http://localhost:3000/api/settings');
      expect(req.request.method).toBe('GET');
      req.flush(mockSettings);
    });

    it('should return default settings on error', () => {
      service.getSettings().subscribe(settings => {
        expect(settings).toEqual({ timeScale: 'Day', theme: 'light' });
      });

      const req = httpMock.expectOne('http://localhost:3000/api/settings');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getWorkOrders', () => {
    it('should return work orders from API', () => {
      const mockOrders: WorkOrderDocument[] = [
        { docId: '1', docType: 'workOrder', data: { name: 'Test', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' } }
      ];

      service.getWorkOrders().subscribe(orders => {
        expect(orders.length).toBe(1);
        expect(orders).toEqual(mockOrders);
      });

      const req = httpMock.expectOne('http://localhost:3000/api/orders');
      expect(req.request.method).toBe('GET');
      req.flush(mockOrders);
    });

    it('should return empty array on error', () => {
      service.getWorkOrders().subscribe(orders => {
        expect(orders).toEqual([]);
      });

      const req = httpMock.expectOne('http://localhost:3000/api/orders');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('createWorkOrder', () => {
    it('should post new order', () => {
      const newOrder: WorkOrderDocument = { docId: '2', docType: 'workOrder', data: { name: 'New', startDate: '2023-01-01', endDate: '2023-01-05', status: 'open', workCenterId: 'wc1' } };

      service.createWorkOrder(newOrder).subscribe(order => {
        expect(order).toEqual(newOrder);
      });

      const req = httpMock.expectOne('http://localhost:3000/api/orders');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newOrder);
      req.flush(newOrder);
    });
  });
});
