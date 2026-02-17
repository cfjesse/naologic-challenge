import '../../test-init';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveOrdersCardComponent } from './active-orders-card';
import { WorkOrderDocument } from '../../models/work-order.model';
import { provideAnimations } from '@angular/platform-browser/animations'  ;
import { describe, it, expect, beforeEach } from 'vitest';

describe('ActiveOrdersCardComponent', () => {
  let component: ActiveOrdersCardComponent;
  let fixture: ComponentFixture<ActiveOrdersCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActiveOrdersCardComponent],
      providers: [provideAnimations()]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ActiveOrdersCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render active orders', () => {
    const mockOrder: WorkOrderDocument = {
      docId: '123',
      docType: 'workOrder',
      data: {
        name: 'Test Order',
        status: 'open',
        workCenterId: 'wc1',
        startDate: '2025-01-01',
        endDate: '2025-01-02'
      }
    };
    component.activeOrders = [mockOrder];
    component.periodLabel = 'January 2025';
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.period-label')?.textContent).toContain('January 2025');
  });
});
