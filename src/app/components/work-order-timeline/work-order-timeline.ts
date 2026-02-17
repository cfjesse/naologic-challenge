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
  ChangeDetectionStrategy,
  effect,
  untracked,
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
import { WorkOrderStore } from '../../store/work-order.store';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkOrderTimelineComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly store = inject(WorkOrderStore);
  private readonly offcanvasService = inject(NgbOffcanvas);

  /** 
   * Synchronization Effect
   * Ensures the cursor and viewport snap to data once it's loaded.
   */
  private readonly syncDataEffect = effect(() => {
    const orders = this.workOrders();
    if (orders.length > 0) {
      untracked(() => {
        this.fitToData();
        // Initial snap: put cursor exactly at the viewport start (earliest - 1 unit)
        this.cursorDate.set(this.viewportStart());
      });
    }
  });

  /* ── Refs ── */
  private readonly timelineArea = viewChild<ElementRef<HTMLDivElement>>(
    'timelineArea'
  );
  private readonly ganttWrapper = viewChild<ElementRef<HTMLDivElement>>(
    'ganttWrapper'
  );

  /* ── Timescale ── */
  protected readonly timeScale = signal<TimeScale>('Day');
  protected readonly timeScaleOptions: TimeScale[] = ['Day', 'Week', 'Month'];

  /* ── Date viewport ── */
  // Initial viewport centered on today
  protected readonly viewportStart = signal(new Date());
  protected readonly viewportEnd = signal(new Date());

  /* ── Data from Store ── */
  protected readonly workCenters = this.store.workCenters;
  protected readonly workOrders = this.store.workOrders;

  /* ── Cursor / slider ── */
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
  
  /* ── Cursor State ── */
  /** Current date position of the cursor (null if not set/visible) */
  protected readonly cursorDate = signal<Date | null>(new Date());
  
  protected readonly cursorPositionPercent = computed(() => {
    const curDate = this.cursorDate();
    if (!curDate) return -10;

    const start = this.viewportStart().getTime();
    const end = this.viewportEnd().getTime();
    const current = curDate.getTime();
    const total = end - start;
    if (total <= 0) return 0;
    return ((current - start) / total) * 100;
  });

  /** The calendar interval (Day, Week, or Month) containing the current cursor date */
  protected readonly selectedInterval = computed(() => {
    const date = this.cursorDate();
    if (!date) return null;
    const scale = this.timeScale();

    let start: Date;
    let end: Date;

    switch (scale) {
      case 'Day':
        start = d3.timeDay.floor(date);
        end = d3.timeDay.offset(start, 1);
        break;
      case 'Week':
        start = d3.timeWeek.floor(date);
        end = d3.timeWeek.offset(start, 1);
        break;
      case 'Month':
        start = d3.timeMonth.floor(date);
        end = d3.timeMonth.offset(start, 1);
        break;
    }

    return { start, end };
  });

  /** Label for the currently selected interval range */
  protected readonly selectedIntervalLabel = computed(() => {
    const interval = this.selectedInterval();
    if (!interval) return '';
    const scale = this.timeScale();

    const formatDay = d3.timeFormat('%B %d, %Y');
    const formatMonth = d3.timeFormat('%B %Y');
    const formatWeek = (d: Date) => {
      const sunday = d3.timeWeek.floor(d);
      const saturday = d3.timeDay.offset(sunday, 6);
      return `${d3.timeFormat('%b %d')(sunday)} - ${d3.timeFormat('%b %d, %Y')(saturday)}`;
    };

    switch (scale) {
      case 'Day': return formatDay(interval.start);
      case 'Week': return `Week of ${formatWeek(interval.start)}`;
      case 'Month': return formatMonth(interval.start);
    }
  });

  /** Work orders that are physically intersected by the slider's current position */
  protected readonly activeOrdersAtCursor = computed(() => {
    const curPercent = this.cursorPositionPercent();
    if (curPercent < 0 || curPercent > 100) return [];

    return this.workOrders()
      .filter(order => {
        const left = this.getBarLeft(order);
        const width = this.getBarWidth(order);
        return curPercent >= left && curPercent <= (left + width);
      })
      .sort((a, b) => new Date(b.data.startDate).getTime() - new Date(a.data.startDate).getTime());
  });

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
    return ticks.map((tickDate) => ({
      label: this.formatColumnLabel(tickDate, scale),
      date: new Date(tickDate),
      isCurrentPeriod: this.isDateInCurrentPeriod(tickDate, now, scale),
    }));
  });

  /**
   * Computed earliest start date from all loaded work orders.
   * Used for bounding the scroll-back logic.
   */
  private readonly minDataDate = computed(() => {
    const orders = this.workOrders();
    if (orders.length === 0) return new Date();
    // Return earliest start date
    const minTimestamp = Math.min(...orders.map(order => new Date(order.data.startDate).getTime()));
    return new Date(minTimestamp);
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

  /* ── Bound handlers to preserve 'this' ── */
  private boundMouseMove = this.onGlobalMouseMove.bind(this);
  private boundMouseUp = this.onGlobalMouseUp.bind(this);
  private boundDocClick = this.onDocumentClick.bind(this);

  ngOnInit(): void {
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('click', this.boundDocClick, true);

    // Initial snapping is now handled by syncDataEffect
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('click', this.boundDocClick, true);
  }

  /**
   * Fits the viewport to cover all work orders with a starting offset.
   * Starts at minTime minus 1 unit of the current timescale.
   */
  protected fitToData(): void {
    const currentOrders = this.workOrders();
    if (currentOrders.length === 0) return;

    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const order of currentOrders) {
      const startTime = new Date(order.data.startDate).getTime();
      const endTime = new Date(order.data.endDate).getTime();
      if (startTime < minTime) minTime = startTime;
      if (endTime > maxTime) maxTime = endTime;
    }

    const scale = this.timeScale();
    let start: Date;
    
    // Snapping logic: earliest - 1 unit
    switch (scale) {
      case 'Day':
        start = d3.timeDay.offset(new Date(minTime), -1);
        break;
      case 'Week':
        start = d3.timeWeek.offset(new Date(minTime), -1);
        break;
      case 'Month':
        start = d3.timeMonth.offset(new Date(minTime), -1);
        break;
    }

    // Ensure we have at least 1 month of view
    const minDurationMs = 30 * 24 * 60 * 60 * 1000;
    const durationMs = Math.max(maxTime - start.getTime() + (7 * 24 * 60 * 60 * 1000), minDurationMs);
    
    this.viewportStart.set(start);
    this.viewportEnd.set(new Date(start.getTime() + durationMs));
  }

  /**
   * Smoothly scrolls the gantt area to center on a specific date.
   * Useful for "Today" jump or manual selections.
   */
  private scrollToDate(date: Date): void {
    const wrapper = this.ganttWrapper()?.nativeElement;
    if (!wrapper) return;

    const start = this.viewportStart().getTime();
    const span = this.totalSpanMs();
    const targetMs = date.getTime();

    // Calculate percentage position of the date within the timeline
    const percent = (targetMs - start) / span;
    
    // Calculate scrollLeft to center the date in the viewport
    const scrollTarget = percent * wrapper.scrollWidth - wrapper.clientWidth / 2;
    
    wrapper.scrollTo({
      left: Math.max(0, scrollTarget),
      behavior: 'smooth'
    });
  }

  /* ── Timescale change ── */
  onTimeScaleChange(scale: TimeScale): void {
    const anchor = this.cursorDate() || new Date();
    this.timeScale.set(scale);
    this.centerViewportOn(anchor);
  }

  /**
   * Centers the viewport on a specific date, adjusting the range based on the current timescale.
   */
  protected centerViewportOn(date: Date): void {
    const scale = this.timeScale();
    let start: Date;
    let end: Date;

    switch (scale) {
      case 'Day':
        start = d3.timeDay.offset(date, -10);
        end = d3.timeDay.offset(date, 10);
        break;
      case 'Week':
        start = d3.timeWeek.offset(date, -5);
        end = d3.timeWeek.offset(date, 5);
        break;
      case 'Month':
        start = d3.timeMonth.offset(date, -6);
        end = d3.timeMonth.offset(date, 6);
        break;
    }

    switch (scale) {
      case 'Day':
        this.viewportStart.set(d3.timeDay.floor(start));
        this.viewportEnd.set(d3.timeDay.ceil(end));
        break;
      case 'Week':
        this.viewportStart.set(d3.timeWeek.floor(start));
        this.viewportEnd.set(d3.timeWeek.ceil(end));
        break;
      case 'Month':
        this.viewportStart.set(d3.timeMonth.floor(start));
        this.viewportEnd.set(d3.timeMonth.ceil(end));
        break;
    }
    
    // Maintain cursor position
    this.cursorDate.set(date);

    // Re-scroll to ensure centering
    setTimeout(() => this.scrollToDate(date), 0);
  }

  protected centerViewportOnToday(): void {
    this.centerViewportOn(new Date());
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
    return this.store.getOrdersForWorkCenter(workCenterId);
  }

  getWorkCenterName(workCenterId: string): string {
    return this.store.getWorkCenterName(workCenterId);
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
      this.store.deleteWorkOrder(this.confirmOrderToDelete.docId);
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
      this.store.addWorkOrder(event.data);
    } else if (event.mode === 'edit' && event.docId) {
      this.store.updateWorkOrder(event.docId, event.data);
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

  protected onHeaderClick(event: MouseEvent, date: Date): void {
      this.cursorDate.set(date);
      this.scrollToDate(date);
  }

  /* ── Infinite Scroll Logic ── */
  /**
   * Refreshes the scroll and infinite expansion logic.
   * Can be called manually or via scroll event.
   */
  protected checkInfiniteScroll(): void {
    if (this.isLoadingMore) return;
    const wrapper = this.ganttWrapper()?.nativeElement;
    if (!wrapper) return;

    const { scrollLeft, scrollWidth, clientWidth } = wrapper;
    const buffer = 200;

    // Extend Right
    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      this.isLoadingMore = true;
      const currentEnd = this.viewportEnd();
      const addedTimeMs = this.totalSpanMs() * 0.2;
      this.viewportEnd.set(new Date(currentEnd.getTime() + addedTimeMs));
      this.cdr.detectChanges();
      setTimeout(() => this.isLoadingMore = false, 50);
    }
    // Extend Left (Bounded)
    else if (scrollLeft <= buffer) {
      const currentStart = this.viewportStart();
      const minDate = this.minDataDate();
      const limitTime = minDate.getTime() - (7 * 24 * 60 * 60 * 1000);
      
      if (currentStart.getTime() > limitTime + 1000) {
         this.isLoadingMore = true;
         const addedTimeMs = this.totalSpanMs() * 0.2;
         let newStartTime = Math.max(limitTime, currentStart.getTime() - addedTimeMs);
         
         const oldScrollWidth = wrapper.scrollWidth;
         const oldScrollLeft = wrapper.scrollLeft;

         this.viewportStart.set(new Date(newStartTime));
         this.cdr.detectChanges();

         const widthDiff = wrapper.scrollWidth - oldScrollWidth;
         if (widthDiff > 0) {
            wrapper.scrollLeft = oldScrollLeft + widthDiff;
         }
         setTimeout(() => this.isLoadingMore = false, 50);
      }
    }
  }

  onGanttScroll(event: Event): void {
    this.checkInfiniteScroll();
  }

  /**
   * Auto-scrolls the wrapper if the mouse is near the edges during a drag.
   */
  private handleDragAutoScroll(clientX: number): void {
    const wrapper = this.ganttWrapper()?.nativeElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const edgeSize = 100;
    const scrollSpeed = 15;

    if (clientX >= rect.right - edgeSize) {
      wrapper.scrollLeft += scrollSpeed;
      this.checkInfiniteScroll();
    } else if (clientX <= rect.left + edgeSize) {
      wrapper.scrollLeft -= scrollSpeed;
      this.checkInfiniteScroll();
    }
  }

  /* ── Global mouse move ── */
  private onGlobalMouseMove(event: MouseEvent): void {
    const area = this.timelineArea()?.nativeElement;
    if (!area) return;
    const rect = area.getBoundingClientRect();

    // Interaction Refresh: Auto-scroll if dragging near edges
    if (this.cursorDragging || this.dragState) {
        this.handleDragAutoScroll(event.clientX);
    }

    if (this.cursorDragging) {
      const xPercent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const newTime = this.viewportStart().getTime() + xPercent * this.totalSpanMs();
      this.cursorDate.set(new Date(newTime));
      this.cdr.detectChanges();
      return;
    }

    if (this.isPanning) {
        const dx = event.clientX - this.panStartX;
        const totalMs = this.totalSpanMs();
        const msPerPx = totalMs / rect.width;
        const deltaMs = dx * msPerPx;
        
        const newStart = this.panStartViewportStart - deltaMs;
        const newEnd = newStart + totalMs;
        
        this.viewportStart.set(new Date(newStart));
        this.viewportEnd.set(new Date(newEnd));
        this.cdr.detectChanges();
        
        // Panning is an interaction: check infinite scroll
        this.checkInfiniteScroll();
        return;
    }

    if (!this.dragState) return;

    const dx = event.clientX - this.dragState.startMouseX;
    const pxToMs = this.totalSpanMs() / rect.width;
    const deltaMs = dx * pxToMs;

    const targetOrder = this.workOrders().find(o => o.docId === this.dragState!.orderId);

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
      const overlap = this.store.checkOverlap(
        targetOrder.data.workCenterId,
        newStartIso,
        newEndIso,
        targetOrder.docId
      );

      if (overlap) return;

      this.store.updateWorkOrder(targetOrder.docId, {
        ...targetOrder.data,
        startDate: newStartIso,
        endDate: newEndIso,
      });
    }

    // Proactive Interaction Refresh: Check for infinite scroll expansion on every move
    this.checkInfiniteScroll();
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

  /* ── Date Utils ── */
  private toIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
