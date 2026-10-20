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

@Component({
  selector: 'app-work-order-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-order-table.html',
  styleUrl: './work-order-table.scss',
})
export class WorkOrderTableComponent implements OnInit {
  protected readonly store = inject(WorkOrderStore);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  @Output() editOrder = new EventEmitter<WorkOrderDocument>();
  @Output() deleteOrder = new EventEmitter<WorkOrderDocument>();
  @Output() createOrder = new EventEmitter<{ workCenterId: string }>();

  searchQuery = '';
  selectedWorkCenterId = 'all';
  selectedStatus = 'all';
  groupByWorkCenter = true;
  conflictMessage: string | null = null;
  collapsedGroups: Record<string, boolean> = {};

  statusOptions: { value: WorkOrderStatus; label: string; class: string }[] = [
    { value: 'open', label: 'Open', class: 'status-open' },
    { value: 'in-progress', label: 'In Progress', class: 'status-in-progress' },
    { value: 'blocked', label: 'Blocked', class: 'status-blocked' },
    { value: 'complete', label: 'Complete', class: 'status-complete' },
  ];

  ngOnInit(): void {
    this.api.getStatuses().subscribe(statuses => {
      if (statuses && statuses.length > 0) {
        this.statusOptions = statuses.map(s => ({
          value: s.value,
          label: s.label,
          class: s.colorClass || `status-${s.value}`
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
    if (this.selectedStatus !== 'all') {
      orders = orders.filter((o) => o.data.status === this.selectedStatus);
    }
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      orders = orders.filter((o) => o.data.name.toLowerCase().includes(q));
    }
    return orders;
  }

  getOrdersForCenter(wcId: string): WorkOrderDocument[] {
    return this.filteredOrders.filter((o) => o.data.workCenterId === wcId);
  }

  getWorkCenterName(wcId: string): string {
    return this.store.getWorkCenterName(wcId);
  }

  getDurationDays(startDate: string, endDate: string): number {
    const start = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);
    return Math.max(1, Math.round(end.diff(start, 'days').days));
  }

  showCharts = true;

  get totalOrders(): number {
    return this.filteredOrders.length;
  }

  get totalScheduledDays(): number {
    return this.filteredOrders.reduce((sum, o) => {
      return sum + this.getDurationDays(o.data.startDate, o.data.endDate);
    }, 0);
  }

  get statusBreakdown(): { status: WorkOrderStatus; label: string; count: number; percent: number; color: string }[] {
    const total = this.totalOrders;
    const colors: Record<WorkOrderStatus, string> = {
      open: '#6366f1',
      'in-progress': '#0284c7',
      blocked: '#ef4444',
      complete: '#10b981',
    };
    const labels: Record<WorkOrderStatus, string> = {
      open: 'Open',
      'in-progress': 'In Progress',
      blocked: 'Blocked',
      complete: 'Complete',
    };

    return (['open', 'in-progress', 'blocked', 'complete'] as WorkOrderStatus[]).map((status) => {
      const count = this.filteredOrders.filter((o) => o.data.status === status).length;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        status,
        label: labels[status],
        count,
        percent,
        color: colors[status],
      };
    });
  }

  get stationUtilization(): {
    id: string;
    name: string;
    orderCount: number;
    totalDays: number;
    percent: number;
    statusCounts: Record<WorkOrderStatus, number>;
  }[] {
    const centers = this.store.workCenters();
    const orders = this.filteredOrders;

    const list = centers.map((wc) => {
      const wcOrders = orders.filter((o) => o.data.workCenterId === wc.docId);
      const totalDays = wcOrders.reduce((sum, o) => sum + this.getDurationDays(o.data.startDate, o.data.endDate), 0);
      const statusCounts: Record<WorkOrderStatus, number> = {
        open: wcOrders.filter((o) => o.data.status === 'open').length,
        'in-progress': wcOrders.filter((o) => o.data.status === 'in-progress').length,
        blocked: wcOrders.filter((o) => o.data.status === 'blocked').length,
        complete: wcOrders.filter((o) => o.data.status === 'complete').length,
      };

      return {
        id: wc.docId,
        name: wc.data.name,
        orderCount: wcOrders.length,
        totalDays,
        percent: 0,
        statusCounts,
      };
    });

    const maxDays = Math.max(...list.map((s) => s.totalDays), 1);
    list.forEach((s) => {
      s.percent = Math.round((s.totalDays / maxDays) * 100);
    });

    return list;
  }

  get busiestStation(): string {
    const stations = this.stationUtilization;
    if (stations.length === 0) return 'None';
    const sorted = [...stations].sort((a, b) => b.totalDays - a.totalDays);
    return sorted[0].orderCount > 0 ? `${sorted[0].name} (${sorted[0].orderCount} orders)` : 'None';
  }

  toggleGroup(wcId: string): void {
    this.collapsedGroups[wcId] = !this.collapsedGroups[wcId];
  }

  isGroupCollapsed(wcId: string): boolean {
    return !!this.collapsedGroups[wcId];
  }

  /* ── Inline Updates ── */
  onStatusChange(order: WorkOrderDocument, newStatus: WorkOrderStatus): void {
    this.store.updateWorkOrder(order.docId, {
      ...order.data,
      status: newStatus,
    });
  }

  onWorkCenterChange(order: WorkOrderDocument, newWcId: string): void {
    if (order.data.workCenterId === newWcId) return;

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

  onDateChange(order: WorkOrderDocument, field: 'startDate' | 'endDate', newValue: string): void {
    if (!newValue) return;

    const newStart = field === 'startDate' ? newValue : order.data.startDate;
    const newEnd = field === 'endDate' ? newValue : order.data.endDate;

    if (new Date(newStart) >= new Date(newEnd)) {
      this.conflictMessage = 'End date must be after start date.';
      setTimeout(() => {
        this.conflictMessage = null;
        this.cdr.detectChanges();
      }, 4000);
      return;
    }

    const overlap = this.store.checkOverlap(
      order.data.workCenterId,
      newStart,
      newEnd,
      order.docId
    );

    if (overlap) {
      this.conflictMessage = `Conflict: overlaps with "${overlap.data.name}" (${overlap.data.startDate} – ${overlap.data.endDate}).`;
      setTimeout(() => {
        this.conflictMessage = null;
        this.cdr.detectChanges();
      }, 5000);
      return;
    }

    this.store.updateWorkOrder(order.docId, {
      ...order.data,
      startDate: newStart,
      endDate: newEnd,
    });
    this.conflictMessage = null;
  }

  onAddForCenter(wcId: string): void {
    this.createOrder.emit({ workCenterId: wcId });
  }

  onEdit(order: WorkOrderDocument): void {
    this.editOrder.emit(order);
  }

  onDelete(order: WorkOrderDocument): void {
    this.deleteOrder.emit(order);
  }
}
