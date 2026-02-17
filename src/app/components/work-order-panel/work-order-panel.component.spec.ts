import { Injector, runInInjectionContext } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { WorkOrderPanelComponent } from './work-order-panel';
import { WorkOrderStore } from '../../store/work-order.store';
import { NgbActiveOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('WorkOrderPanelComponent Logic', () => {
  let component: WorkOrderPanelComponent;
  let storeMock: any;
  let offcanvasMock: any;
  let injector: Injector;

  beforeEach(() => {
    storeMock = { checkOverlap: vi.fn() };
    offcanvasMock = { close: vi.fn(), dismiss: vi.fn() };
    
    injector = Injector.create({
      providers: [
        { provide: WorkOrderStore, useValue: storeMock },
        { provide: NgbActiveOffcanvas, useValue: offcanvasMock },
        { provide: FormBuilder, useClass: FormBuilder }
      ]
    });

    runInInjectionContext(injector, () => {
        component = new WorkOrderPanelComponent();
    });
    
    // Manually call ngOnInit
    component.ngOnInit();
  });

  it('should initialize creating form', () => {
    expect(component.mode).toBe('create');
    expect(component.form.value.name).toBe('');
    expect(component.form.valid).toBe(false); // required fields empty
  });

  it('should prevent submission if form invalid', () => {
    component.onSubmit();
    expect(storeMock.checkOverlap).not.toHaveBeenCalled();
    expect(offcanvasMock.close).not.toHaveBeenCalled();
  });

  it('should checking overlap on submit', () => {
    // Fill valid form
    component.form.patchValue({
      name: 'Test Order',
      status: 'open',
      startDate: { year: 2026, month: 1, day: 1 },
      endDate: { year: 2026, month: 1, day: 5 }
    });
    component.workCenterId = 'wc-1';

    // Mock no overlap
    storeMock.checkOverlap.mockReturnValue(null);

    component.onSubmit();

    expect(storeMock.checkOverlap).toHaveBeenCalledWith(
        'wc-1', '2026-01-01', '2026-01-05', undefined
    );
    expect(offcanvasMock.close).toHaveBeenCalled();
  });

  it('should block submission if overlap detected', () => {
    // Fill valid form
    component.form.patchValue({
      name: 'Test Order',
      status: 'open',
      startDate: { year: 2026, month: 1, day: 1 },
      endDate: { year: 2026, month: 1, day: 5 }
    });
    component.workCenterId = 'wc-1';

    // Mock overlap
    storeMock.checkOverlap.mockReturnValue({
        data: { name: 'Existing', startDate: '2026-01-01', endDate: '2026-01-10' }
    });

    component.onSubmit();

    expect(storeMock.checkOverlap).toHaveBeenCalled();
    expect(offcanvasMock.close).not.toHaveBeenCalled();
    expect(component.overlapError).toContain('Overlap with "Existing"');
  });
});
