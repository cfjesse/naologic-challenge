import '../../test-init';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkOrderTimelineComponent } from './work-order-timeline';
import { WorkOrderStore } from '../../store/work-order.store';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { NgbOffcanvas, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkOrderDocument, WorkCenterDocument } from '../../models/work-order.model';

describe('WorkOrderTimelineComponent', () => {
  let component: WorkOrderTimelineComponent;
  let fixture: ComponentFixture<WorkOrderTimelineComponent>;
  let storeMock: any;
  let authMock: any;
  let apiMock: any;

  beforeEach(async () => {
    storeMock = {
      workCenters: signal([
        { docId: 'wc-1', docType: 'workCenter', data: { name: 'Line 1' } }
      ] as WorkCenterDocument[]),
      workOrders: signal([] as WorkOrderDocument[]),
      filteredWorkOrders: signal([] as WorkOrderDocument[]),
      statusFilter: signal('all'),
      dataSource: signal('local'),
      isLoading: signal(false),
      setStatusFilter: vi.fn(),
      updateWorkOrder: vi.fn(),
      addWorkOrder: vi.fn(),
      deleteWorkOrder: vi.fn(),
      updateWorkCenter: vi.fn()
    };

    authMock = {
      isAdmin: signal(true),
      user: signal({ username: 'Admin', role: 'admin' }),
      isAuthenticated: signal(true),
      isLoggedIn: vi.fn().mockReturnValue(true)
    };

    apiMock = {
      getSettings: vi.fn().mockReturnValue(of({ timeScale: 'Day' })),
      updateSettings: vi.fn().mockReturnValue(of({})),
    };

    const offcanvasMock = {
      open: vi.fn().mockReturnValue({ componentInstance: {}, result: Promise.resolve() }),
    };

    const modalMock = {
      open: vi.fn().mockReturnValue({ componentInstance: {}, result: Promise.resolve() }),
    };

    await TestBed.configureTestingModule({
      imports: [WorkOrderTimelineComponent],
      providers: [
        { provide: WorkOrderStore, useValue: storeMock },
        { provide: AuthService, useValue: authMock },
        { provide: ApiService, useValue: apiMock },
        { provide: NgbOffcanvas, useValue: offcanvasMock },
        { provide: NgbModal, useValue: modalMock },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkOrderTimelineComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render work center names', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.wc-name')?.textContent).toContain('Line 1');
  });

  it('should call setStatusFilter through the store', () => {
    component['store'].setStatusFilter('complete');
    expect(storeMock.setStatusFilter).toHaveBeenCalledWith('complete');
  });
});
