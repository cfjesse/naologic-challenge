import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkOrderTimelineComponent } from './work-order-timeline';
import { WorkOrderStore } from '../../store/work-order.store';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { NgbOffcanvas, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('WorkOrderTimelineComponent', () => {
  let component: WorkOrderTimelineComponent;
  let fixture: ComponentFixture<WorkOrderTimelineComponent>;

  beforeEach(async () => {
    const storeMock = {
      workCenters: signal([]),
      workOrders: signal([]),
      filteredWorkOrders: signal([]),
      statusFilter: signal('all'),
      checkOverlap: vi.fn().mockReturnValue(false),
      setStatusFilter: vi.fn(),
      updateWorkOrder: vi.fn(),
      addWorkOrder: vi.fn(),
      deleteWorkOrder: vi.fn(),
    };

    const authMock = {
      isAdmin: signal(true),
      user: signal({ username: 'Admin', role: 'admin' }),
      isAuthenticated: signal(true),
    };

    const apiMock = {
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
      imports: [WorkOrderTimelineComponent, CommonModule],
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
});
