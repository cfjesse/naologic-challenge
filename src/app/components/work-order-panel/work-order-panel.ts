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
import { WorkOrderStore } from '../../store/work-order.store';
import { ApiService } from '../../services/api';
import { DateTime } from 'luxon';

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
  private readonly store = inject(WorkOrderStore);
  private readonly api = inject(ApiService);

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() workOrder: WorkOrderDocument | null = null;
  @Input() workCenterId = '';
  @Input() startDate = '';
  
  overlapError = '';

  /** Work center options populated from API */
  workCenterOptions: { id: string; name: string }[] = [];

  /** Status options populated from API */
  statusOptions: { value: WorkOrderStatus; label: string; colorClass: string }[] = [
    { value: 'open', label: 'Open', colorClass: 'status-open' },
    { value: 'in-progress', label: 'In Progress', colorClass: 'status-in-progress' },
    { value: 'complete', label: 'Complete', colorClass: 'status-complete' },
    { value: 'blocked', label: 'Blocked', colorClass: 'status-blocked' },
  ];

  /** Reactive form */
  form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    workCenterId: ['', Validators.required],
    status: ['open' as WorkOrderStatus, Validators.required],
    startDate: [null as NgbDateStruct | null, Validators.required],
    endDate: [null as NgbDateStruct | null, Validators.required],
  }, {
    validators: [this.dateRangeValidator],
  });

  submitted = false;

  ngOnInit(): void {
    // Populate Work Centers from API
    this.api.getWorkCenters().subscribe(centers => {
      if (centers && centers.length > 0) {
        this.workCenterOptions = centers.map(c => ({ id: c.docId, name: c.data.name }));
        if (!this.form.get('workCenterId')?.value) {
          const defaultWcId = this.workCenterId || (this.workOrder?.data.workCenterId) || this.workCenterOptions[0].id;
          this.form.patchValue({ workCenterId: defaultWcId });
        }
      }
    });

    // Populate Statuses from API
    this.api.getStatuses().subscribe(statuses => {
      if (statuses && statuses.length > 0) {
        this.statusOptions = statuses;
      }
    });

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

    const startMs = DateTime.fromObject({ year: startVal.year, month: startVal.month, day: startVal.day }).toMillis();
    const endMs = DateTime.fromObject({ year: endVal.year, month: endVal.month, day: endVal.day }).toMillis();
    
    if (endMs <= startMs) return { dateOrder: true };
    
    const d1 = DateTime.fromMillis(startMs);
    const d2 = DateTime.fromMillis(endMs);
    const diff = d2.diff(d1, 'days').days;

    return diff >= 7 ? null : { dateRangeMinimum: true };
  }

  private resetForm(): void {
    if (this.mode === 'edit' && this.workOrder) {
      const s = this.isoToNgb(this.workOrder.data.startDate);
      const e = this.isoToNgb(this.workOrder.data.endDate);
      this.form.patchValue({
        name: this.workOrder.data.name,
        workCenterId: this.workOrder.data.workCenterId,
        status: this.workOrder.data.status,
        startDate: s,
        endDate: e,
      });
    } else {
      const s = this.isoToNgb(this.startDate);
      const e = this.isoToNgb(this.addDays(this.startDate, 7));
      this.form.patchValue({
        name: '',
        workCenterId: this.workCenterId || (this.workCenterOptions[0]?.id ?? ''),
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

    const wcId = val.workCenterId || (this.mode === 'edit' && this.workOrder
      ? this.workOrder.data.workCenterId
      : this.workCenterId);

    // Check overlap
    this.overlapError = '';
    const overlap = this.store.checkOverlap(
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
