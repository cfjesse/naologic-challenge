import '../test-init';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService, AppSettings } from './api';
import { WorkOrderDocument, WorkCenterDocument } from '../models/work-order.model';
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
  });

  describe('updateSettings', () => {
    it('should post updated settings', () => {
      const settings: Partial<AppSettings> = { theme: 'dark' };
      service.updateSettings(settings).subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/settings');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(settings);
      req.flush(settings);
    });
  });

  describe('Work Orders', () => {
    it('should get all orders', () => {
      service.getWorkOrders().subscribe();
      const req = httpMock.expectOne('http://localhost:3000/api/orders');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should update work order', () => {
      const data = { name: 'Updated' };
      service.updateWorkOrder('123', data).subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/orders/123');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(data);
      req.flush({});
    });

    it('should delete work order', () => {
      service.deleteWorkOrder('123').subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/orders/123');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('Work Centers', () => {
    it('should get work centers', () => {
      service.getWorkCenters().subscribe();
      const req = httpMock.expectOne('http://localhost:3000/api/work-centers');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should create work center', () => {
      const center: WorkCenterDocument = {
        docId: 'wc-99',
        docType: 'workCenter',
        data: { name: 'Packaging B' }
      };
      service.createWorkCenter(center).subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/work-centers');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(center);
      req.flush(center);
    });

    it('should delete work center', () => {
      service.deleteWorkCenter('wc-99').subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/work-centers/wc-99');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('Batch Generation and Reset', () => {
    it('should generate orders from API', () => {
      service.generateOrders().subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/orders/generate');
      expect(req.request.method).toBe('POST');
      req.flush([]);
    });

    it('should reset data from API', () => {
      service.resetData().subscribe();

      const req = httpMock.expectOne('http://localhost:3000/api/reset');
      expect(req.request.method).toBe('POST');
      req.flush({ workCenters: [], workOrders: [], settings: { timeScale: 'Day', theme: 'light' } });
    });
  });
});
