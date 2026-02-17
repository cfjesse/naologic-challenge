import '../../test-init';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkOrderPanelComponent, PanelSaveEvent } from './work-order-panel';
import { WorkOrderStore } from '../../store/work-order.store';
import { NgbActiveOffcanvas, NgbDatepickerModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { ReactiveFormsModule } from '@angular/forms';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WorkOrderDocument } from '../../models/work-order.model';

describe('WorkOrderPanelComponent', () => {
  let component: WorkOrderPanelComponent;
  let fixture: ComponentFixture<WorkOrderPanelComponent>;
  let storeMock: any;
  let offcanvasMock: any;

  beforeEach(async () => {
    storeMock = {
      checkOverlap: vi.fn().mockReturnValue(undefined),
      workOrders: vi.fn().mockReturnValue([]),
      workCenters: vi.fn().mockReturnValue([])
    };
    offcanvasMock = {
      close: vi.fn(),
      dismiss: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        ReactiveFormsModule,
        NgSelectModule,
        NgbDatepickerModule,
        WorkOrderPanelComponent
      ],
      providers: [
        { provide: WorkOrderStore, useValue: storeMock },
        { provide: NgbActiveOffcanvas, useValue: offcanvasMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkOrderPanelComponent);
    component = fixture.componentInstance;
    component.workCenterId = 'wc-1';
    component.startDate = '2026-01-01';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form for create mode', () => {
    expect(component.mode).toBe('create');
    expect(component.form.get('name')?.value).toBe('');
    expect(component.form.get('status')?.value).toBe('open');
  });

  it('should populate form for edit mode', () => {
    const mockOrder: WorkOrderDocument = {
      docId: '123',
      docType: 'workOrder',
      data: {
        name: 'Existing',
        status: 'in-progress',
        startDate: '2026-02-01',
        endDate: '2026-02-10',
        workCenterId: 'wc-1'
      }
    };
    component.mode = 'edit';
    component.workOrder = mockOrder;
    component.ngOnInit();
    fixture.detectChanges();

    expect(component.form.get('name')?.value).toBe('Existing');
    expect(component.form.get('status')?.value).toBe('in-progress');
  });

  it('should not submit if form is invalid', () => {
    component.form.patchValue({ name: '' });
    component.onSubmit();
    expect(offcanvasMock.close).not.toHaveBeenCalled();
  });

  it('should submit if form is valid and no overlap', () => {
    component.form.patchValue({
      name: 'Valid Order',
      status: 'open',
      startDate: { year: 2026, month: 3, day: 1 },
      endDate: { year: 2026, month: 3, day: 10 }
    });
    
    component.onSubmit();
    
    expect(storeMock.checkOverlap).toHaveBeenCalled();
    expect(offcanvasMock.close).toHaveBeenCalled();
    const result = (offcanvasMock.close.mock.calls[0][0]) as PanelSaveEvent;
    expect(result.data.name).toBe('Valid Order');
    expect(result.data.startDate).toBe('2026-03-01');
  });

  it('should show error on overlap', () => {
    storeMock.checkOverlap.mockReturnValue({ data: { name: 'Collision' } });
    component.form.patchValue({
      name: 'Valid Order',
      status: 'open',
      startDate: { year: 2026, month: 3, day: 1 },
      endDate: { year: 2026, month: 3, day: 10 }
    });
    
    component.onSubmit();
    
    expect(component.overlapError).toContain('Overlap with "Collision"');
    expect(offcanvasMock.close).not.toHaveBeenCalled();
  });
});
