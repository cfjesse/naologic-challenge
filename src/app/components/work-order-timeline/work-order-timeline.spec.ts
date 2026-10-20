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
      dataSource: signal('server'),
      isLoading: signal(false),
      setStatusFilter: vi.fn(),
      updateWorkOrder: vi.fn(),
      addWorkOrder: vi.fn(),
      deleteWorkOrder: vi.fn(),
      updateWorkCenter: vi.fn(),
      addWorkCenter: vi.fn(),
      checkOverlap: vi.fn().mockReturnValue(undefined),
      refreshData: vi.fn(),
      generateNewData: vi.fn(),
      resetToDefaults: vi.fn(),
    };

    authMock = {
      isAdmin: signal(true),
      user: signal({ username: 'Admin', role: 'admin' }),
      isAuthenticated: signal(true),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    apiMock = {
      settingsSignal: signal({ timeScale: 'Day', theme: 'light' }),
      getSettings: vi.fn().mockReturnValue(of({ timeScale: 'Day' })),
      updateSettings: vi.fn().mockReturnValue(of({})),
      getTimescales: vi.fn().mockReturnValue(of(['Day', 'Week', 'Month'])),
      getStatuses: vi.fn().mockReturnValue(of([
        { value: 'open', label: 'Open', colorClass: 'status-open' },
        { value: 'in-progress', label: 'In Progress', colorClass: 'status-in-progress' },
        { value: 'complete', label: 'Complete', colorClass: 'status-complete' },
        { value: 'blocked', label: 'Blocked', colorClass: 'status-blocked' },
      ])),
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

  it('should open add work center modal and add work center', () => {
    component.openAddWorkCenter();
    expect(component.addWorkCenterVisible).toBe(true);

    component.newWorkCenterName = 'Stamping Press';
    component.confirmAddWorkCenter();
    expect(storeMock.addWorkCenter).toHaveBeenCalledWith('Stamping Press');
    expect(component.addWorkCenterVisible).toBe(false);
  });

  it('should emit dragDate and update dragAlertInfo on drag', () => {
    let emittedEvent: any = null;
    component.dragDate.subscribe(e => emittedEvent = e);

    const testOrder: WorkOrderDocument = {
      docId: 'wo-1',
      docType: 'workOrder',
      data: {
        name: 'Test Order',
        workCenterId: 'wc-1',
        status: 'open',
        startDate: '2026-10-10',
        endDate: '2026-10-15',
      }
    };

    component['emitDragDate'](
      testOrder,
      new Date('2026-10-12'),
      new Date('2026-10-17'),
      'move',
      { clientX: 200, clientY: 300 }
    );

    expect(component.dragAlertInfo).toBeTruthy();
    expect(component.dragAlertInfo?.orderName).toBe('Test Order');
    expect(component.dragAlertInfo?.mode).toBe('move');
    expect(emittedEvent).toBeTruthy();
    expect(emittedEvent.order.docId).toBe('wo-1');
  });
});
