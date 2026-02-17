import {
  Component,
  Input,
  OnInit,
  HostListener,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgbDatepickerModule, NgbDateStruct, NgbActiveOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import {
  WorkOrderDocument,
  WorkOrderStatus,
  WorkCenterDocument,
} from '../../models/work-order.model';
import { WorkOrderService } from '../../services/work-order.service';

/* ── Exported event interfaces ── */
export interface PanelSaveEvent {
  mode: 'create' | 'edit';
  docId?: string;
  data: {
    name: string;
    workCenterId: string;
    status: WorkOrderStatus;
    startDate: string;
    endDate: string;
  };
}

/**
 * WorkOrderPanelComponent — side panel content for creating/editing work orders.
 * Now designed to be opened via NgbOffcanvas.
 */
@Component({
  selector: 'app-work-order-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgSelectModule, NgbDatepickerModule],
  templateUrl: './work-order-panel.html',
  styleUrl: './work-order-panel.scss',
})
export class WorkOrderPanelComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  readonly activeOffcanvas = inject(NgbActiveOffcanvas);
  private readonly workOrderService = inject(WorkOrderService);

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() workOrder: WorkOrderDocument | null = null;
  @Input() workCenterId = '';
  @Input() startDate = '';
  
  overlapError = '';
  // Note: workCenters list might not be needed if not used in dropdown, usually overlap check is in service
  // checking panel usage... it seems it doesn't use workCenters for display?
  // Ah, the original panel didn't show a work center selector, it was inferred from the row clicked.
  // But for Edit mode, maybe we want to move it? The design only showed Status, Name, Dates.
  // Let's keep it simple as per original design.

  /** Status options */
  readonly statusOptions: { value: WorkOrderStatus; label: string; colorClass: string }[] = [
    { value: 'open', label: 'Open', colorClass: 'status-open' },
    { value: 'in-progress', label: 'In Progress', colorClass: 'status-in-progress' },
    { value: 'complete', label: 'Complete', colorClass: 'status-complete' },
    { value: 'blocked', label: 'Blocked', colorClass: 'status-blocked' },
  ];

  /** Reactive form */
  form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    status: ['open' as WorkOrderStatus, Validators.required],
    startDate: [null as NgbDateStruct | null, Validators.required],
    endDate: [null as NgbDateStruct | null, Validators.required],
  }, {
    validators: [this.dateRangeValidator],
  });

  submitted = false;

  ngOnInit(): void {
    this.resetForm();
  }

  /** Escape key closes panel (handled by offcanvas too, but good backup) */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.activeOffcanvas.dismiss('Escape');
  }

  /* ── Validation ── */
  private dateRangeValidator(group: AbstractControl): ValidationErrors | null {
    const startVal = group.get('startDate')?.value as NgbDateStruct | null;
    const endVal = group.get('endDate')?.value as NgbDateStruct | null;
    if (!startVal || !endVal) return null;

    const startMs = new Date(startVal.year, startVal.month - 1, startVal.day).getTime();
    const endMs = new Date(endVal.year, endVal.month - 1, endVal.day).getTime();

    return endMs > startMs ? null : { dateRange: true };
  }

  private resetForm(): void {
    if (this.mode === 'edit' && this.workOrder) {
      const s = this.isoToNgb(this.workOrder.data.startDate);
      const e = this.isoToNgb(this.workOrder.data.endDate);
      this.form.patchValue({
        name: this.workOrder.data.name,
        status: this.workOrder.data.status,
        startDate: s,
        endDate: e,
      });
    } else {
      const s = this.isoToNgb(this.startDate);
      const e = this.isoToNgb(this.addDays(this.startDate, 7));
      this.form.patchValue({
        name: '',
        status: 'open',
        startDate: s,
        endDate: e,
      });
    }
  }

  /* ── Helpers ── */
  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case 'open': return 'status-open';
      case 'in-progress': return 'status-in-progress';
      case 'complete': return 'status-complete';
      case 'blocked': return 'status-blocked';
    }
  }

  /* ── Actions ── */
  onSubmit(): void {
    this.submitted = true;
    if (this.form.invalid) return;

    const val = this.form.value;
    const startIso = this.ngbToIso(val.startDate);
    const endIso = this.ngbToIso(val.endDate);

    const wcId = this.mode === 'edit' && this.workOrder
      ? this.workOrder.data.workCenterId
      : this.workCenterId;

    // Check overlap
    this.overlapError = '';
    const overlap = this.workOrderService.checkOverlap(
      wcId,
      startIso,
      endIso,
      this.mode === 'edit' ? this.workOrder?.docId : undefined
    );

    if (overlap) {
      this.overlapError = `Overlap with "${overlap.data.name}" (${overlap.data.startDate} to ${overlap.data.endDate}).`;
      return;
    }

    const result: PanelSaveEvent = {
      mode: this.mode,
      docId: this.mode === 'edit' ? this.workOrder?.docId : undefined,
      data: {
        name: val.name,
        workCenterId: wcId,
        status: val.status,
        startDate: startIso,
        endDate: endIso,
      },
    };

    this.activeOffcanvas.close(result);
  }

  onCancel(): void {
    this.activeOffcanvas.dismiss('Cancel click');
  }

  // No manual overlay click handler needed — Offcanvas handles backdrop

  /* ── Date Utils ── */
  private isoToNgb(iso: string): NgbDateStruct | null {
    if (!iso) return null;
    const d = new Date(iso);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  private ngbToIso(ngb: NgbDateStruct): string {
    const y = ngb.year;
    const m = String(ngb.month).padStart(2, '0');
    const d = String(ngb.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private addDays(iso: string, days: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
