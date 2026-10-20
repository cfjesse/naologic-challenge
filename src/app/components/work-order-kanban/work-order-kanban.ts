import {
  Component,
  OnInit,
  inject,
  Output,
  EventEmitter,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DateTime } from 'luxon';
import { WorkOrderStore } from '../../store/work-order.store';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import {
  WorkOrderDocument,
  WorkOrderStatus,
  WorkCenterDocument,
} from '../../models/work-order.model';

export interface KanbanColumn {
  status: WorkOrderStatus;
  title: string;
  badgeClass: string;
}

@Component({
  selector: 'app-work-order-kanban',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-order-kanban.html',
  styleUrl: './work-order-kanban.scss',
})
export class WorkOrderKanbanComponent implements OnInit {
  protected readonly store = inject(WorkOrderStore);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  @Output() editOrder = new EventEmitter<WorkOrderDocument>();
  @Output() deleteOrder = new EventEmitter<WorkOrderDocument>();
  @Output() createOrder = new EventEmitter<{ workCenterId: string; status: WorkOrderStatus }>();

  selectedWorkCenterId: string = 'all';
  searchQuery: string = '';
  draggedOrderId: string | null = null;
  dragOverColumn: WorkOrderStatus | null = null;
  editingDateOrderId: string | null = null;
  editStartDate: string = '';
  editEndDate: string = '';
  conflictMessage: string | null = null;

  columns: KanbanColumn[] = [
    { status: 'open', title: 'Open', badgeClass: 'badge-open' },
    { status: 'in-progress', title: 'In Progress', badgeClass: 'badge-in-progress' },
    { status: 'blocked', title: 'Blocked', badgeClass: 'badge-blocked' },
    { status: 'complete', title: 'Complete', badgeClass: 'badge-complete' },
  ];

  ngOnInit(): void {
    this.api.getStatuses().subscribe(statuses => {
      if (statuses && statuses.length > 0) {
        this.columns = statuses.map(s => ({
          status: s.value,
          title: s.label,
          badgeClass: `badge-${s.value}`
        }));
        this.cdr.detectChanges();
      }
    });
  }

  get filteredOrders(): WorkOrderDocument[] {
    let orders = this.store.workOrders();
    if (this.selectedWorkCenterId !== 'all') {
      orders = orders.filter((o) => o.data.workCenterId === this.selectedWorkCenterId);
    }
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      orders = orders.filter((o) => o.data.name.toLowerCase().includes(q));
    }
    return orders;
  }

  getOrdersByStatus(status: WorkOrderStatus): WorkOrderDocument[] {
    return this.filteredOrders.filter((o) => o.data.status === status);
  }

  getWorkCenterName(wcId: string): string {
    return this.store.getWorkCenterName(wcId);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy');
  }

  showCharts = true;

  get totalOrdersCount(): number {
    return this.filteredOrders.length;
  }

  get completedOrdersCount(): number {
    return this.getOrdersByStatus('complete').length;
  }

  get inProgressOrdersCount(): number {
    return this.getOrdersByStatus('in-progress').length;
  }

  get blockedOrdersCount(): number {
    return this.getOrdersByStatus('blocked').length;
  }

  get openOrdersCount(): number {
    return this.getOrdersByStatus('open').length;
  }

  get completionRate(): number {
    if (this.totalOrdersCount === 0) return 0;
    return Math.round((this.completedOrdersCount / this.totalOrdersCount) * 100);
  }

  get totalScheduledDays(): number {
    return this.filteredOrders.reduce((sum, o) => {
      return sum + this.getDurationDays(o.data.startDate, o.data.endDate);
    }, 0);
  }

  get workCenterLoads(): { id: string; name: string; count: number; days: number; percent: number }[] {
    const centers = this.store.workCenters();
    const orders = this.filteredOrders;
    const loads = centers.map((wc) => {
      const wcOrders = orders.filter((o) => o.data.workCenterId === wc.docId);
      const days = wcOrders.reduce((acc, o) => acc + this.getDurationDays(o.data.startDate, o.data.endDate), 0);
      return {
        id: wc.docId,
        name: wc.data.name,
        count: wcOrders.length,
        days: days,
        percent: 0,
      };
    });

    const maxDays = Math.max(...loads.map((l) => l.days), 1);
    loads.forEach((l) => {
      l.percent = Math.round((l.days / maxDays) * 100);
    });

    return loads;
  }

  get donutSegments(): { status: WorkOrderStatus; label: string; count: number; percent: number; strokeDasharray: string; strokeDashoffset: number; color: string }[] {
    const total = this.totalOrdersCount;
    const colors: Record<WorkOrderStatus, string> = {
      'open': '#6366f1',
      'in-progress': '#0284c7',
      'blocked': '#ef4444',
      'complete': '#10b981',
    };
    const labels: Record<WorkOrderStatus, string> = {
      'open': 'Open',
      'in-progress': 'In Progress',
      'blocked': 'Blocked',
      'complete': 'Complete',
    };

    const circumference = 2 * Math.PI * 40;
    if (total === 0) return [];

    let accumulatedFraction = 0;
    return (['open', 'in-progress', 'blocked', 'complete'] as WorkOrderStatus[]).map((status) => {
      const count = this.getOrdersByStatus(status).length;
      const ratio = total > 0 ? count / total : 0;
      const percent = Math.round(ratio * 100);
      const dashLength = ratio * circumference;
      const spaceLength = circumference - dashLength;
      const offset = -(accumulatedFraction * circumference);
      accumulatedFraction += ratio;

      return {
        status,
        label: labels[status],
        count,
        percent,
        strokeDasharray: `${dashLength.toFixed(2)} ${spaceLength.toFixed(2)}`,
        strokeDashoffset: Number(offset.toFixed(2)),
        color: colors[status],
      };
    });
  }

  getDurationDays(startDate: string, endDate: string): number {
    const start = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);
    const diff = end.diff(start, 'days').days;
    return Math.max(1, Math.round(diff));
  }

  /* ── Drag & Drop ── */
  onDragStart(event: DragEvent, order: WorkOrderDocument): void {
    if (!this.auth.isAdmin()) return;
    this.draggedOrderId = order.docId;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', order.docId);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(): void {
    this.draggedOrderId = null;
    this.dragOverColumn = null;
  }

  onDragOver(event: DragEvent, status: WorkOrderStatus): void {
    if (!this.auth.isAdmin()) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverColumn = status;
  }

  onDragLeave(event: DragEvent, status: WorkOrderStatus): void {
    if (this.dragOverColumn === status) {
      this.dragOverColumn = null;
    }
  }

  onDrop(event: DragEvent, targetStatus: WorkOrderStatus): void {
    if (!this.auth.isAdmin()) return;
    event.preventDefault();
    this.dragOverColumn = null;
    const orderId = this.draggedOrderId || event.dataTransfer?.getData('text/plain');
    if (!orderId) return;

    const order = this.store.workOrders().find((o) => o.docId === orderId);
    if (order && order.data.status !== targetStatus) {
      this.store.updateWorkOrder(orderId, {
        ...order.data,
        status: targetStatus,
      });
    }
    this.draggedOrderId = null;
  }

  /* ── Quick Work Center Change ── */
  onWorkCenterChange(order: WorkOrderDocument, newWcId: string): void {
    if (order.data.workCenterId === newWcId) return;

    // Check overlap on new work center
    const overlap = this.store.checkOverlap(
      newWcId,
      order.data.startDate,
      order.data.endDate,
      order.docId
    );

    if (overlap) {
      this.conflictMessage = `Cannot reassign to "${this.getWorkCenterName(newWcId)}": overlaps with "${overlap.data.name}".`;
      setTimeout(() => {
        this.conflictMessage = null;
        this.cdr.detectChanges();
      }, 5000);
      return;
    }

    this.store.updateWorkOrder(order.docId, {
      ...order.data,
      workCenterId: newWcId,
    });
    this.conflictMessage = null;
  }

  /* ── Quick Date Editing ── */
  startEditDate(order: WorkOrderDocument): void {
    if (!this.auth.isAdmin()) return;
    this.editingDateOrderId = order.docId;
    this.editStartDate = order.data.startDate;
    this.editEndDate = order.data.endDate;
  }

  cancelEditDate(): void {
    this.editingDateOrderId = null;
    this.editStartDate = '';
    this.editEndDate = '';
  }

  saveEditDate(order: WorkOrderDocument): void {
    if (!this.editStartDate || !this.editEndDate) return;

    if (new Date(this.editStartDate) >= new Date(this.editEndDate)) {
      this.conflictMessage = 'End date must be after start date.';
      return;
    }

    const overlap = this.store.checkOverlap(
      order.data.workCenterId,
      this.editStartDate,
      this.editEndDate,
      order.docId
    );

    if (overlap) {
      this.conflictMessage = `Date conflict: overlaps with "${overlap.data.name}" (${overlap.data.startDate} – ${overlap.data.endDate}).`;
      return;
    }

    this.store.updateWorkOrder(order.docId, {
      ...order.data,
      startDate: this.editStartDate,
      endDate: this.editEndDate,
    });

    this.editingDateOrderId = null;
    this.conflictMessage = null;
  }

  /* ── Shift Days (+1 / -1 Day) ── */
  shiftOrderDays(order: WorkOrderDocument, dayDelta: number): void {
    if (!this.auth.isAdmin()) return;

    const start = DateTime.fromISO(order.data.startDate).plus({ days: dayDelta });
    const end = DateTime.fromISO(order.data.endDate).plus({ days: dayDelta });
    const newStartIso = start.toISODate()!;
    const newEndIso = end.toISODate()!;

    const overlap = this.store.checkOverlap(
      order.data.workCenterId,
      newStartIso,
      newEndIso,
      order.docId
    );

    if (overlap) {
      this.conflictMessage = `Cannot shift dates: overlaps with "${overlap.data.name}".`;
      setTimeout(() => {
        this.conflictMessage = null;
        this.cdr.detectChanges();
      }, 4000);
      return;
    }

    this.store.updateWorkOrder(order.docId, {
      ...order.data,
      startDate: newStartIso,
      endDate: newEndIso,
    });
    this.conflictMessage = null;
  }

  /* ── Add & Edit Actions ── */
  onAddOrder(status: WorkOrderStatus): void {
    const defaultWc = this.selectedWorkCenterId !== 'all'
      ? this.selectedWorkCenterId
      : (this.store.workCenters()[0]?.docId || '');
    this.createOrder.emit({ workCenterId: defaultWc, status });
  }

  onEditOrder(order: WorkOrderDocument): void {
    this.editOrder.emit(order);
  }

  onDeleteOrder(order: WorkOrderDocument): void {
    this.deleteOrder.emit(order);
  }
}
