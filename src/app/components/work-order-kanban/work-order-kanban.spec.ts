import '../../test-init';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkOrderKanbanComponent } from './work-order-kanban';
import { WorkOrderStore } from '../../store/work-order.store';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkOrderDocument, WorkCenterDocument } from '../../models/work-order.model';

describe('WorkOrderKanbanComponent', () => {
  let component: WorkOrderKanbanComponent;
  let fixture: ComponentFixture<WorkOrderKanbanComponent>;
  let storeMock: any;
  let authMock: any;
  let apiMock: any;

  const mockWorkCenters: WorkCenterDocument[] = [
    { docId: 'wc-1', docType: 'workCenter', data: { name: 'Line 1' } },
    { docId: 'wc-2', docType: 'workCenter', data: { name: 'Line 2' } },
  ];

  const mockWorkOrders: WorkOrderDocument[] = [
    {
      docId: 'wo-1',
      docType: 'workOrder',
      data: {
        name: 'Order A',
        workCenterId: 'wc-1',
        status: 'open',
        startDate: '2026-10-01',
        endDate: '2026-10-10',
      },
    },
    {
      docId: 'wo-2',
      docType: 'workOrder',
      data: {
        name: 'Order B',
        workCenterId: 'wc-2',
        status: 'in-progress',
        startDate: '2026-10-05',
        endDate: '2026-10-15',
      },
    },
  ];

  beforeEach(async () => {
    storeMock = {
      workCenters: signal(mockWorkCenters),
      workOrders: signal(mockWorkOrders),
      getWorkCenterName: vi.fn((id: string) => id === 'wc-1' ? 'Line 1' : 'Line 2'),
      getOrdersForWorkCenter: vi.fn((id: string) => mockWorkOrders.filter(o => o.data.workCenterId === id)),
      updateWorkOrder: vi.fn(),
      checkOverlap: vi.fn().mockReturnValue(undefined),
    };

    authMock = {
      isAdmin: signal(true),
    };

    apiMock = {
      getStatuses: vi.fn().mockReturnValue(of([
        { value: 'open', label: 'Open', colorClass: 'status-open' },
        { value: 'in-progress', label: 'In Progress', colorClass: 'status-in-progress' },
        { value: 'blocked', label: 'Blocked', colorClass: 'status-blocked' },
        { value: 'complete', label: 'Complete', colorClass: 'status-complete' },
      ])),
    };

    await TestBed.configureTestingModule({
      imports: [WorkOrderKanbanComponent],
      providers: [
        { provide: WorkOrderStore, useValue: storeMock },
        { provide: AuthService, useValue: authMock },
        { provide: ApiService, useValue: apiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkOrderKanbanComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render 4 kanban columns', () => {
    expect(component.columns.length).toBe(4);
    const compiled = fixture.nativeElement as HTMLElement;
    const titles = compiled.querySelectorAll('.column-title');
    expect(titles.length).toBe(4);
    expect(titles[0].textContent).toContain('Open');
    expect(titles[1].textContent).toContain('In Progress');
  });

  it('should update order status on drop', () => {
    component.draggedOrderId = 'wo-1';
    const fakeEvent = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: vi.fn() },
    } as any;

    component.onDrop(fakeEvent, 'in-progress');
    expect(storeMock.updateWorkOrder).toHaveBeenCalledWith('wo-1', expect.objectContaining({
      status: 'in-progress',
    }));
  });

  it('should shift order dates', () => {
    const order = mockWorkOrders[0];
    component.shiftOrderDays(order, 1);
    expect(storeMock.updateWorkOrder).toHaveBeenCalledWith('wo-1', expect.objectContaining({
      startDate: '2026-10-02',
      endDate: '2026-10-11',
    }));
  });

  it('should prevent date shift on overlap', () => {
    storeMock.checkOverlap.mockReturnValue({ docId: 'wo-conflict', data: { name: 'Conflict Order' } });
    const order = mockWorkOrders[0];
    component.shiftOrderDays(order, 1);
    expect(component.conflictMessage).toContain('Cannot shift dates');
  });
});
