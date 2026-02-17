import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
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
import { NgbDatepickerModule, NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';
import {
  WorkOrderDocument,
  WorkOrderStatus,
  WorkCenterDocument,
} from '../../models/work-order.model';

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
 * WorkOrderPanelComponent — slide-out panel for creating/editing work orders.
 *
 * Uses Reactive Forms with FormGroup and custom validators:
 *  - All fields required
 *  - End date must be after start date (cross-field validator)
 *
 * Status dropdown uses ng-select with colored badge templates.
 * Date fields use ngb-datepicker from @ng-bootstrap.
 *
 * Width: 480px (matches Sketch design reference).
 */
@Component({
  selector: 'app-work-order-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgSelectModule, NgbDatepickerModule],
  templateUrl: './work-order-panel.html',
  styleUrl: './work-order-panel.scss',
})
export class WorkOrderPanelComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input() visible = false;
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() workOrder: WorkOrderDocument | null = null;
  @Input() workCenterId = '';
  @Input() startDate = '';
  @Input() workCenters: WorkCenterDocument[] = [];
  @Input() overlapError = '';

  @Output() save = new EventEmitter<PanelSaveEvent>();
  @Output() cancel = new EventEmitter<void>();

  /** Status options for ng-select with color metadata */
  readonly statusOptions: { value: WorkOrderStatus; label: string; colorClass: string }[] = [
    { value: 'open', label: 'Open', colorClass: 'status-open' },
    { value: 'in-progress', label: 'In Progress', colorClass: 'status-in-progress' },
    { value: 'complete', label: 'Complete', colorClass: 'status-complete' },
    { value: 'blocked', label: 'Blocked', colorClass: 'status-blocked' },
  ];

  /** Reactive form with cross-field date validation */
  form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    status: ['open' as WorkOrderStatus, Validators.required],
    startDate: [null as NgbDateStruct | null, Validators.required],
    endDate: [null as NgbDateStruct | null, Validators.required],
  }, {
    validators: [this.dateRangeValidator],
  });

  /** Whether form has been submitted (to show validation errors) */
  submitted = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.submitted = false;
      this.resetForm();
    }
  }

  /** Escape key closes panel */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.visible) {
      this.cancel.emit();
    }
  }

  /**
   * Cross-field validator: ensures endDate is strictly after startDate.
   * This runs at the FormGroup level so it can access both controls.
   */
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

  /* ── Status badge helper ── */
  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case 'open': return 'status-open';
      case 'in-progress': return 'status-in-progress';
      case 'complete': return 'status-complete';
      case 'blocked': return 'status-blocked';
    }
  }

  getStatusLabel(status: WorkOrderStatus): string {
    switch (status) {
      case 'open': return 'Open';
      case 'in-progress': return 'In Progress';
      case 'complete': return 'Complete';
      case 'blocked': return 'Blocked';
    }
  }

  /* ── Submit ── */
  onSubmit(): void {
    this.submitted = true;
    if (this.form.invalid) return;

    const val = this.form.value;
    const startIso = this.ngbToIso(val.startDate);
    const endIso = this.ngbToIso(val.endDate);

    const wcId = this.mode === 'edit' && this.workOrder
      ? this.workOrder.data.workCenterId
      : this.workCenterId;

    this.save.emit({
      mode: this.mode,
      docId: this.mode === 'edit' ? this.workOrder?.docId : undefined,
      data: {
        name: val.name,
        workCenterId: wcId,
        status: val.status,
        startDate: startIso,
        endDate: endIso,
      },
    });
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('panel-overlay')) {
      this.cancel.emit();
    }
  }

  /* ── Date conversion helpers ── */

  /** Convert ISO string "YYYY-MM-DD" to NgbDateStruct */
  private isoToNgb(iso: string): NgbDateStruct | null {
    if (!iso) return null;
    const d = new Date(iso);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  /** Convert NgbDateStruct to ISO string "YYYY-MM-DD" */
  private ngbToIso(ngb: NgbDateStruct): string {
    const y = ngb.year;
    const m = String(ngb.month).padStart(2, '0');
    const d = String(ngb.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Add days to an ISO date string, return new ISO string */
  private addDays(iso: string, days: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
