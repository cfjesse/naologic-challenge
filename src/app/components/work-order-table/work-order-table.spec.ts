import '../../test-init';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkOrderTableComponent } from './work-order-table';
import { WorkOrderStore } from '../../store/work-order.store';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkOrderDocument, WorkCenterDocument } from '../../models/work-order.model';

describe('WorkOrderTableComponent', () => {
  let component: WorkOrderTableComponent;
  let fixture: ComponentFixture<WorkOrderTableComponent>;
  let storeMock: any;
  let authMock: any;
  let apiMock: any;

  const mockWorkCenters: WorkCenterDocument[] = [
    { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line' } },
  ];

  const mockWorkOrders: WorkOrderDocument[] = [
    {
      docId: 'wo-1',
      docType: 'workOrder',
      data: {
        name: 'Omega Forge #101',
        workCenterId: 'wc-1',
        status: 'open',
        startDate: '2026-10-01',
        endDate: '2026-10-10',
      },
    },
  ];

  beforeEach(async () => {
    storeMock = {
      workCenters: signal(mockWorkCenters),
      workOrders: signal(mockWorkOrders),
      getWorkCenterName: vi.fn(() => 'Extrusion Line'),
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
      imports: [WorkOrderTableComponent],
      providers: [
        { provide: WorkOrderStore, useValue: storeMock },
        { provide: AuthService, useValue: authMock },
        { provide: ApiService, useValue: apiMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkOrderTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render table row with order name', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.order-name-text')?.textContent).toContain('Omega Forge #101');
  });

  it('should update status on status change', () => {
    const order = mockWorkOrders[0];
    component.onStatusChange(order, 'complete');
    expect(storeMock.updateWorkOrder).toHaveBeenCalledWith('wo-1', expect.objectContaining({
      status: 'complete',
    }));
  });

  it('should update dates on date change', () => {
    const order = mockWorkOrders[0];
    component.onDateChange(order, 'startDate', '2026-10-03');
    expect(storeMock.updateWorkOrder).toHaveBeenCalledWith('wo-1', expect.objectContaining({
      startDate: '2026-10-03',
      endDate: '2026-10-10',
    }));
  });

  it('should prevent invalid date range where start >= end', () => {
    const order = mockWorkOrders[0];
    component.onDateChange(order, 'startDate', '2026-10-15');
    expect(component.conflictMessage).toContain('End date must be after start date');
    expect(storeMock.updateWorkOrder).not.toHaveBeenCalled();
  });
});
