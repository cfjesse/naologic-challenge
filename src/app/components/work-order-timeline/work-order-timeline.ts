import {
  Component,
  signal,
  computed,
  ElementRef,
  viewChild,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgbOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import * as d3 from 'd3';

import {
  WorkOrderDocument,
  WorkCenterDocument,
  WorkOrderStatus,
  TimeScale,
} from '../../models/work-order.model';
import { WorkOrderService } from '../../services/work-order.service';
import {
  WorkOrderPanelComponent,
  PanelSaveEvent,
} from '../work-order-panel/work-order-panel';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';

/* ── Column header model ── */
interface ColumnHeader {
  label: string;
  date: Date;
  isCurrentPeriod: boolean;
}

/* ── Active menu state ── */
interface ActiveMenu {
  orderId: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-work-order-timeline',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgSelectModule,
    // WorkOrderPanelComponent is used via Offcanvas service, not in template
    ConfirmDialogComponent,
  ],
  templateUrl: './work-order-timeline.html',
  styleUrl: './work-order-timeline.scss',
})
export class WorkOrderTimelineComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly workOrderService = inject(WorkOrderService);
  private readonly offcanvasService = inject(NgbOffcanvas);

  /* ── Refs ── */
  private readonly timelineArea = viewChild<ElementRef<HTMLDivElement>>(
    'timelineArea'
  );

  /* ── Timescale ── */
  protected readonly timeScale = signal<TimeScale>('Day');
  protected readonly timeScaleOptions: TimeScale[] = ['Day', 'Week', 'Month'];

  /* ── Date viewport ── */
  // Initial viewport centered on today
  protected readonly viewportStart = signal(new Date());
  protected readonly viewportEnd = signal(new Date());

  /* ── Data from Service ── */
  protected readonly workCenters = this.workOrderService.workCenters;
  protected readonly workOrders = this.workOrderService.workOrders;

  /* ── Cursor / slider ── */
  protected readonly cursorDate = signal(new Date());
  private cursorDragging = false;

  /* ── Drag state (for bars) ── */
  private dragState: {
    orderId: string;
    mode: 'move' | 'resize-start' | 'resize-end';
    startMouseX: number;
    originalStart: Date;
    originalEnd: Date;
  } | null = null;

  /* ── Click-vs-drag detection ── */
  private mouseDownPos: { x: number; y: number } | null = null;
  private mouseDownWorkCenterId: string | null = null;
  private didDrag = false;
  private readonly DRAG_THRESHOLD = 5;

  /* ── 3-dot ellipsis menu ── */
  protected activeMenu = signal<ActiveMenu | null>(null);

  /* ── Confirm delete dialog ── */
  protected confirmVisible = signal(false);
  protected confirmOrderToDelete: WorkOrderDocument | null = null;

  /* ── Tooltip ── */
  protected readonly tooltip = signal<{
    visible: boolean;
    text: string;
    x: number;
    y: number;
  }>({ visible: false, text: '', x: 0, y: 0 });
  
  /* ── Panning state ── */
  private isPanning = false;
  private panStartX = 0;
  private panStartViewportStart = 0;
  private isLoadingMore = false;

  /* ── Computed: column headers ── */
  protected readonly columns = computed<ColumnHeader[]>(() => {
    const scale = this.timeScale();
    const start = new Date(this.viewportStart());
    const end = new Date(this.viewportEnd());
    const now = new Date();

    let interval: d3.TimeInterval;
    switch (scale) {
      case 'Day':
        interval = d3.timeDay;
        break;
      case 'Week':
        interval = d3.timeWeek;
        break;
      case 'Month':
        interval = d3.timeMonth;
        break;
    }

    const ticks = interval.range(start, end);
    return ticks.map((date) => ({
      label: this.formatColumnLabel(date, scale),
      date: new Date(date),
      isCurrentPeriod: this.isDateInCurrentPeriod(date, now, scale),
    }));
  });

  private readonly minDataDate = computed(() => {
    const orders = this.workOrders();
    if (orders.length === 0) return new Date();
    // Return earliest start date
    const min = Math.min(...orders.map(o => new Date(o.data.startDate).getTime()));
    return new Date(min);
  });

  protected readonly totalSpanMs = computed(
    () => this.viewportEnd().getTime() - this.viewportStart().getTime()
  );

  protected readonly columnMinWidth = computed(() => {
    switch (this.timeScale()) {
      case 'Day':
        return 60;
      case 'Week':
        return 100;
      case 'Month':
        return 120;
    }
  });

  protected readonly cursorPositionPercent = computed(() => {
    const start = this.viewportStart().getTime();
    const span = this.totalSpanMs();
    const cur = this.cursorDate().getTime();
    return Math.max(0, Math.min(100, ((cur - start) / span) * 100));
  });

  /* ── Bound handlers to preserve 'this' ── */
  private boundMouseMove = this.onGlobalMouseMove.bind(this);
  private boundMouseUp = this.onGlobalMouseUp.bind(this);
  private boundDocClick = this.onDocumentClick.bind(this);

  ngOnInit(): void {
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('click', this.boundDocClick, true);

    // Fit to data initially, or center on today if no data
    if (this.workOrders().length > 0) {
      this.fitToData();
    } else {
      this.centerViewportOnToday();
    }
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('click', this.boundDocClick, true);
  }

  /**
   * Fit viewport to cover all work orders with padding.
   */
  private fitToData(): void {
    const orders = this.workOrders();
    if (orders.length === 0) return;

    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const o of orders) {
      const start = new Date(o.data.startDate).getTime();
      const end = new Date(o.data.endDate).getTime();
      if (start < minTime) minTime = start;
      if (end > maxTime) maxTime = end;
    }

    // Add padding (e.g. 1 week start, 1 week end)
    const padding = 7 * 24 * 60 * 60 * 1000;
    const duration = maxTime - minTime + 2 * padding;
    
    // Ensure minimum duration based on zoom (approx 30 days)
    const minDuration = 30 * 24 * 60 * 60 * 1000;
    
    // Set viewport
    this.viewportStart.set(new Date(minTime - padding));
    this.viewportEnd.set(new Date(Math.max(minTime - padding + duration, minTime - padding + minDuration)));
  }

  /* ── Viewport logic ── */
  protected centerViewportOnToday(): void {
    const now = new Date();
    const scale = this.timeScale();
    let start: Date;
    let end: Date;

    switch (scale) {
      case 'Day':
        const dayStart = d3.timeDay.offset(now, -10);
        const dayEnd = d3.timeDay.offset(now, 10);
        start = d3.timeDay.floor(dayStart);
        end = d3.timeDay.ceil(dayEnd);
        break;
      case 'Week':
        const weekStart = d3.timeWeek.offset(now, -5);
        const weekEnd = d3.timeWeek.offset(now, 5);
        start = d3.timeWeek.floor(weekStart);
        end = d3.timeWeek.ceil(weekEnd);
        break;
      case 'Month':
        const monthStart = d3.timeMonth.offset(now, -6);
        const monthEnd = d3.timeMonth.offset(now, 6);
        start = d3.timeMonth.floor(monthStart);
        end = d3.timeMonth.ceil(monthEnd);
        break;
    }

    this.viewportStart.set(start);
    this.viewportEnd.set(end);
  }

  /* ── Bar positioning helpers ── */
  getBarLeft(order: WorkOrderDocument): number {
    const start = this.viewportStart().getTime();
    const span = this.totalSpanMs();
    return ((new Date(order.data.startDate).getTime() - start) / span) * 100;
  }

  getBarWidth(order: WorkOrderDocument): number {
    const span = this.totalSpanMs();
    return (
      ((new Date(order.data.endDate).getTime() -
        new Date(order.data.startDate).getTime()) /
        span) *
      100
    );
  }

  getOrdersForWorkCenter(workCenterId: string): WorkOrderDocument[] {
    return this.workOrderService.getOrdersForWorkCenter(workCenterId);
  }

  getWorkCenterName(workCenterId: string): string {
    return this.workOrderService.getWorkCenterName(workCenterId);
  }

  /* ── Status helpers ── */
  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case 'complete': return 'status-complete';
      case 'in-progress': return 'status-in-progress';
      case 'open': return 'status-open';
      case 'blocked': return 'status-blocked';
    }
  }

  getBarClass(status: WorkOrderStatus): string {
    switch (status) {
      case 'complete': return 'bar-complete';
      case 'in-progress': return 'bar-in-progress';
      case 'open': return 'bar-open';
      case 'blocked': return 'bar-blocked';
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

  /* ── Timescale change ── */
  onTimeScaleChange(scale: TimeScale): void {
    this.timeScale.set(scale);
    this.centerViewportOnToday();
  }

  getCurrentPeriodLabel(): string {
    switch (this.timeScale()) {
      case 'Day': return 'Current day';
      case 'Week': return 'Current week';
      case 'Month': return 'Current month';
    }
  }

  /* ── Bar drag (move) ── */
  onBarMouseDown(event: MouseEvent, order: WorkOrderDocument): void {
    if ((event.target as HTMLElement).classList.contains('resize-handle')) return;
    if ((event.target as HTMLElement).closest('.bar-ellipsis')) return;
    event.preventDefault();
    event.stopPropagation();
    this.didDrag = true;
    this.dragState = {
      orderId: order.docId,
      mode: 'move',
      startMouseX: event.clientX,
      originalStart: new Date(order.data.startDate),
      originalEnd: new Date(order.data.endDate),
    };
  }

  /* ── Resize handles ── */
  onResizeMouseDown(event: MouseEvent, order: WorkOrderDocument, edge: 'start' | 'end'): void {
    event.preventDefault();
    event.stopPropagation();
    this.didDrag = true;
    this.dragState = {
      orderId: order.docId,
      mode: edge === 'start' ? 'resize-start' : 'resize-end',
      startMouseX: event.clientX,
      originalStart: new Date(order.data.startDate),
      originalEnd: new Date(order.data.endDate),
    };
  }

  /* ── Cursor drag ── */
  onCursorMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.cursorDragging = true;
    this.didDrag = true;
  }

  /* ── Timeline mousedown/up for click-vs-drag and Panning ── */
  onTimelineMouseDown(event: MouseEvent, workCenterId: string): void {
    if (event.button !== 0) return;
    
    // Prevent default to avoid text selection inside
    event.preventDefault();
    
    // Setup for click detection
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.mouseDownWorkCenterId = workCenterId;
    this.didDrag = false;
    
    // Setup for Panning
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panStartViewportStart = this.viewportStart().getTime();
  }

  onTimelineMouseUp(event: MouseEvent, workCenterId: string): void {
    // If we were panning, stop it
    if (this.isPanning) {
        this.isPanning = false;
    }

    if (this.didDrag || !this.mouseDownPos) {
      this.mouseDownPos = null;
      this.mouseDownWorkCenterId = null;
      return;
    }

    const dx = Math.abs(event.clientX - this.mouseDownPos.x);
    const dy = Math.abs(event.clientY - this.mouseDownPos.y);

    if (dx < this.DRAG_THRESHOLD && dy < this.DRAG_THRESHOLD) {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const xPercent = (event.clientX - rect.left) / rect.width;
      const clickTime = this.viewportStart().getTime() + xPercent * this.totalSpanMs();
      const clickDate = d3.timeDay.round(new Date(clickTime));
      this.openCreatePanel(workCenterId, clickDate);
    }

    this.mouseDownPos = null;
    this.mouseDownWorkCenterId = null;
  }

  /* ── 3-dot ellipsis menu ── */
  onEllipsisClick(event: MouseEvent, order: WorkOrderDocument): void {
    event.preventDefault();
    event.stopPropagation();

    const current = this.activeMenu();
    if (current && current.orderId === order.docId) {
      this.activeMenu.set(null);
      return;
    }

    this.activeMenu.set({
      orderId: order.docId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  onMenuEdit(order: WorkOrderDocument): void {
    this.activeMenu.set(null);
    this.openEditPanel(order);
  }

  onMenuDelete(order: WorkOrderDocument): void {
    this.activeMenu.set(null);
    this.confirmOrderToDelete = order;
    this.confirmVisible.set(true);
  }

  /* ── Confirm Delete ── */
  onConfirmDelete(): void {
    if (this.confirmOrderToDelete) {
      this.workOrderService.deleteWorkOrder(this.confirmOrderToDelete.docId);
      this.confirmOrderToDelete = null;
    }
    this.confirmVisible.set(false);
  }

  onCancelDelete(): void {
    this.confirmOrderToDelete = null;
    this.confirmVisible.set(false);
  }

  /* ── Panel operations (Offcanvas) ── */
  private openCreatePanel(workCenterId: string, startDate: Date): void {
    const offcanvasRef = this.offcanvasService.open(WorkOrderPanelComponent, {
      position: 'end',
      panelClass: 'work-order-offcanvas',
      ariaLabelledBy: 'offcanvas-basic-title' 
    });
    
    // Set inputs on component instance
    const instance = offcanvasRef.componentInstance as WorkOrderPanelComponent;
    instance.mode = 'create';
    instance.workCenterId = workCenterId;
    instance.startDate = this.toIso(startDate);

    offcanvasRef.result.then(
      (result: PanelSaveEvent) => this.handlePanelSave(result),
      () => {} // dismissed
    );
  }

  private openEditPanel(order: WorkOrderDocument): void {
    const offcanvasRef = this.offcanvasService.open(WorkOrderPanelComponent, {
      position: 'end',
      panelClass: 'work-order-offcanvas',
      ariaLabelledBy: 'offcanvas-basic-title'
    });

    const instance = offcanvasRef.componentInstance as WorkOrderPanelComponent;
    instance.mode = 'edit';
    instance.workOrder = order;

    offcanvasRef.result.then(
      (result: PanelSaveEvent) => this.handlePanelSave(result),
      () => {} // dismissed
    );
  }

  private handlePanelSave(event: PanelSaveEvent): void {
    if (event.mode === 'create') {
      this.workOrderService.addWorkOrder(event.data);
    } else if (event.mode === 'edit' && event.docId) {
      this.workOrderService.updateWorkOrder(event.docId, event.data);
    }
  }

  /* ── Tooltip ── */
  onTimelineMouseMove(event: MouseEvent): void {
    if (this.dragState || this.cursorDragging || this.isPanning) {
        this.tooltip.update((t) => ({ ...t, visible: false }));
        return;
    }

    // Check if we are dragging (click-drag detection for panning threshold)
    if (this.mouseDownPos) {
      const dx = Math.abs(event.clientX - this.mouseDownPos.x);
      const dy = Math.abs(event.clientY - this.mouseDownPos.y);
      if (dx >= this.DRAG_THRESHOLD || dy >= this.DRAG_THRESHOLD) {
        this.didDrag = true;
      }
    }

    // Tooltip logic
    const target = event.target as HTMLElement;
    const bar = target.closest('.bar') as HTMLElement;
    
    if (bar) {
        // Show order details
        // We can extract title from the bar's title attribute or lookup data
        // For simplicity, let's parse the title attribute we set in template
        const title = bar.getAttribute('title') || 'Work Order';
        this.tooltip.set({
          visible: true,
          text: title,
          x: event.clientX,
          y: event.clientY,
        });
    } else {
        // Show "Click to add" if creating
        this.tooltip.set({
          visible: true,
          text: 'Click to add work order',
          x: event.clientX,
          y: event.clientY,
        });
    }
  }

  onTimelineMouseLeave(): void {
    this.tooltip.update((t) => ({ ...t, visible: false }));
  }

  /* ── Global mouse move ── */
  private onGlobalMouseMove(event: MouseEvent): void {
    const area = this.timelineArea()?.nativeElement;
    if (!area) return;
    const rect = area.getBoundingClientRect();

    if (this.cursorDragging) {
      const xPercent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const newTime = this.viewportStart().getTime() + xPercent * this.totalSpanMs();
      this.cursorDate.set(new Date(newTime));
      this.cdr.detectChanges();
      return;
    }

    if (this.isPanning) {
        const dx = event.clientX - this.panStartX;
        // Panning math: moving mouse right (positive dx) means we want to see what is on the LEFT.
        // So viewport start shifts LEFT (decrease).
        
        const totalMs = this.totalSpanMs();
         // If width is 1000px and totalMs is 1000ms. 1px = 1ms.
         // dx = 10px. we move 10ms.
        const msPerPx = totalMs / rect.width;
        const deltaMs = dx * msPerPx;
        
        const newStart = this.panStartViewportStart - deltaMs;
        const newEnd = newStart + totalMs;
        
        this.viewportStart.set(new Date(newStart));
        this.viewportEnd.set(new Date(newEnd));
        this.cdr.detectChanges();
        return;
    }

    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startMouseX;
    const pxToMs = this.totalSpanMs() / rect.width;
    const deltaMs = dx * pxToMs;

    const currentOrders = this.workOrders();
    const targetOrder = currentOrders.find(o => o.docId === this.dragState!.orderId);

    if (targetOrder) {
      let newStartIso = targetOrder.data.startDate;
      let newEndIso = targetOrder.data.endDate;

      switch (this.dragState!.mode) {
        case 'move': {
          const duration = this.dragState!.originalEnd.getTime() - this.dragState!.originalStart.getTime();
          const newStart = d3.timeDay.round(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          newStartIso = this.toIso(newStart);
          newEndIso = this.toIso(new Date(newStart.getTime() + duration));
          break;
        }
        case 'resize-start': {
          const snapped = d3.timeDay.round(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          if (snapped < this.dragState!.originalEnd) {
            newStartIso = this.toIso(snapped);
          }
          break;
        }
        case 'resize-end': {
          const snapped = d3.timeDay.round(new Date(this.dragState!.originalEnd.getTime() + deltaMs));
          if (snapped > this.dragState!.originalStart) {
            newEndIso = this.toIso(snapped);
          }
          break;
        }
      }

      // Check for overlap before updating
      const overlap = this.workOrderService.checkOverlap(
        targetOrder.data.workCenterId,
        newStartIso,
        newEndIso,
        targetOrder.docId
      );

      if (overlap) {
        // Enforce no overlap: simply do not update
        // The bar will appear "stuck" at the last valid position until mouse moves back to valid range
        return;
      }

      this.workOrderService.updateWorkOrder(targetOrder.docId, {
        ...targetOrder.data,
        startDate: newStartIso,
        endDate: newEndIso,
      });
    }
  }

  private onGlobalMouseUp(): void {
    if (this.dragState || this.cursorDragging || this.isPanning) {
      this.dragState = null;
      this.cursorDragging = false;
      this.isPanning = false;
      this.cdr.detectChanges();
    }
  }

  private onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.bar-ellipsis') && !target.closest('.ellipsis-dropdown')) {
      this.activeMenu.set(null);
    }
  }

  /* ── Format helpers ── */
  private toIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatColumnLabel(date: Date, scale: TimeScale): string {
    switch (scale) {
      case 'Day': return d3.timeFormat('%b %d')(date);
      case 'Week': {
        const endOfWeek = d3.timeDay.offset(date, 6);
        return `${d3.timeFormat('%b %d')(date)} – ${d3.timeFormat('%b %d')(endOfWeek)}`;
      }
      case 'Month': return d3.timeFormat('%b %Y')(date);
    }
  }

  private isDateInCurrentPeriod(colDate: Date, now: Date, scale: TimeScale): boolean {
    switch (scale) {
      case 'Day': return d3.timeDay.floor(colDate).getTime() === d3.timeDay.floor(now).getTime();
      case 'Week': {
        const weekStart = d3.timeWeek.floor(now);
        const weekEnd = d3.timeWeek.offset(weekStart, 1);
        return colDate >= weekStart && colDate < weekEnd;
      }
      case 'Month': return d3.timeMonth.floor(colDate).getTime() === d3.timeMonth.floor(now).getTime();
    }
  }
  /* ── Infinite Scroll ── */
  onGanttScroll(event: Event): void {
    if (this.isLoadingMore) return;

    const target = event.target as HTMLElement;
    const { scrollLeft, scrollWidth, clientWidth } = target;
    const buffer = 200; // pixels to trigger load

    // Extend Right
    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      this.isLoadingMore = true;
      const currentEnd = this.viewportEnd();
      const span = this.totalSpanMs();
      const newEnd = new Date(currentEnd.getTime() + (span * 0.2));
      this.viewportEnd.set(newEnd);
      // Debounce
      setTimeout(() => { this.isLoadingMore = false; }, 50);
    } 
    
    // Extend Left (Bounded)
    else if (scrollLeft <= buffer) {
      const currentStart = this.viewportStart();
      const minDate = this.minDataDate();
      // Padding of 1 week (matching fitToData)
      const padding = 7 * 24 * 60 * 60 * 1000;
      const limitTime = minDate.getTime() - padding;
      
      // If we can still scroll back
      // Note: currentStart might be slightly larger than limitTime due to floating point or drag
      // We allow scrolling back if current > limit
      if (currentStart.getTime() > limitTime + 1000) { // +1s tolerance
         this.isLoadingMore = true;
         
         const span = this.totalSpanMs();
         const addedTime = span * 0.2;
         let newStartTime = currentStart.getTime() - addedTime;
         
         // Clamp to limit
         if (newStartTime < limitTime) {
             newStartTime = limitTime;
         }
         
         // Perform extension
         const newStart = new Date(newStartTime);
         const oldScrollWidth = scrollWidth;
         const oldScrollLeft = scrollLeft;

         this.viewportStart.set(newStart);
         this.cdr.detectChanges();

         const newScrollWidth = target.scrollWidth;
         const widthDiff = newScrollWidth - oldScrollWidth;

         if (widthDiff > 0) {
            target.scrollLeft = oldScrollLeft + widthDiff;
         }
         
         setTimeout(() => { this.isLoadingMore = false; }, 50);
      }
    }


    
    // Left scroll extension disabled per user request
  }
}
