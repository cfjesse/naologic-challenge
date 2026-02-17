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
  HostListener,
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

import {
  ColumnHeader,
  ActiveMenu,
  TooltipState,
} from './work-order-timeline.types';
import {
  toIso,
  getStatusLabel,
  getBarClass,
  getStatusClass,
  formatColumnLabel,
  isDateInCurrentPeriod,
  calculateBarLeft,
  calculateBarWidth,
  calculateColumns,
  calculateFitToData,
  calculateViewportRange,
  calculateCursorPositionPercent
} from './work-order-timeline.utils';

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

  /* ── Status Filter ── */
  protected readonly statusFilterOptions: (WorkOrderStatus | 'all')[] = ['all', 'open', 'in-progress', 'complete', 'blocked'];
  
  /* ── Date viewport ── */
  // Initial viewport centered on today
  protected readonly viewportStart = signal(new Date());
  protected readonly viewportEnd = signal(new Date());

  /* ── Data from Store ── */
  protected readonly workCenters = this.store.workCenters;
  protected readonly workOrders = this.store.filteredWorkOrders;

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
  protected readonly tooltip = signal<TooltipState>({ visible: false, text: '', x: 0, y: 0 });
  
  /* ── Cursor State ── */
  /** Current date position of the cursor (null if not set/visible) */
  protected readonly cursorDate = signal<Date | null>(new Date());
  
  protected readonly cursorPositionPercent = computed(() => {
    return calculateCursorPositionPercent(
      this.cursorDate(),
      this.viewportStart(),
      this.viewportEnd()
    );
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

    const start = this.viewportStart().getTime();
    const span = this.totalSpanMs();

    return this.workOrders()
      .filter((order: WorkOrderDocument) => {
        const left = calculateBarLeft(order, start, span);
        const width = calculateBarWidth(order, span);
        return curPercent >= left && curPercent <= (left + width);
      })
      .sort((a: WorkOrderDocument, b: WorkOrderDocument) => new Date(b.data.startDate).getTime() - new Date(a.data.startDate).getTime());
  });

  onStatusFilterChange(status: WorkOrderStatus | 'all'): void {
    this.store.setStatusFilter(status);
    this.forceHeaderRefresh();
  }

  /* ── Panning state ── */
  private isPanning = false;
  private panStartX = 0;
  private panStartViewportStart = 0;
  private isLoadingMore = false;

  /* ── Computed: column headers ── */
  protected readonly columns = computed<ColumnHeader[]>(() => {
    return calculateColumns(
      this.timeScale(),
      this.viewportStart(),
      this.viewportEnd(),
      new Date()
    );
  });

  /**
   * Computed earliest start date from all loaded work orders.
   * Used for bounding the scroll-back logic.
   */
  private readonly minDataDate = computed(() => {
    const orders = this.workOrders();
    if (orders.length === 0) return new Date();
    // Return earliest start date
    const minTimestamp = Math.min(...orders.map((order: WorkOrderDocument) => new Date(order.data.startDate).getTime()));
    return new Date(minTimestamp);
  });

  protected readonly totalSpanMs = computed(
    () => this.viewportEnd().getTime() - this.viewportStart().getTime()
  );

  protected readonly columnMinWidth = signal(106.25);

  ngOnInit(): void {
    // Initial snapping is now handled by syncDataEffect
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {}

  /**
   * Fits the viewport to cover all work orders with a starting offset.
   * Starts at minTime minus 1 unit of the current timescale.
   */
  protected fitToData(): void {
    const { start, end } = calculateFitToData(this.workOrders(), this.timeScale());
    if (!start || !end) return;

    this.viewportStart.set(start);
    this.viewportEnd.set(end);
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

    // Forced re-render after navigation jump
    setTimeout(() => {
      this.checkInfiniteScroll();
      this.forceHeaderRefresh();
      this.cdr.detectChanges();
    }, 300); // Wait for smooth scroll to settle
  }

  /* ── Timescale change ── */
  onTimeScaleChange(scale: TimeScale): void {
    const anchor = this.cursorDate() || new Date();
    this.timeScale.set(scale);
    this.centerViewportOn(anchor);
    
    // Proactively refresh infinite scroll and headers for the new scale
    setTimeout(() => {
        this.checkInfiniteScroll();
        this.forceHeaderRefresh();
    }, 50);
  }

  /**
   * Centers the viewport on a specific date, adjusting the range based on the current timescale.
   */
  protected centerViewportOn(date: Date): void {
    const { start, end } = calculateViewportRange(date, this.timeScale());
    this.viewportStart.set(start);
    this.viewportEnd.set(end);
    
    // Maintain cursor position
    this.cursorDate.set(date);

    // Force re-render of headers and grid
    this.forceHeaderRefresh();
    this.cdr.detectChanges();

    // Re-scroll to ensure centering
    setTimeout(() => this.scrollToDate(date), 0);
  }

  protected centerViewportOnToday(): void {
    this.centerViewportOn(new Date());
  }

  /* ── Bar positioning helpers ── */
  getBarLeft(order: WorkOrderDocument): number {
    return calculateBarLeft(order, this.viewportStart().getTime(), this.totalSpanMs());
  }

  getBarWidth(order: WorkOrderDocument): number {
    return calculateBarWidth(order, this.totalSpanMs());
  }

  getOrdersForWorkCenter(workCenterId: string): WorkOrderDocument[] {
    return this.workOrders().filter((o: WorkOrderDocument) => o.data.workCenterId === workCenterId);
  }

  getWorkCenterName(workCenterId: string): string {
    return this.store.getWorkCenterName(workCenterId);
  }

  /* ── Status helpers ── */
  getStatusClass(status: WorkOrderStatus): string {
    return getStatusClass(status);
  }

  getBarClass(status: WorkOrderStatus): string {
    return getBarClass(status);
  }

  getStatusLabel(status: WorkOrderStatus): string {
    return getStatusLabel(status);
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
    instance.startDate = toIso(startDate);

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
    this.tooltip.update((t: TooltipState) => ({ ...t, visible: false }));
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
    // Buffer for expansion
    const buffer = this.columnMinWidth() * 2; 

    // Extend Right
    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      this.isLoadingMore = true;
      const currentEnd = this.viewportEnd();
      // Add roughly one full screen of data
      const addedTimeMs = this.totalSpanMs() * 0.5;
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
         const addedTimeMs = this.totalSpanMs() * 0.5;
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
    this.forceHeaderRefresh();
  }

  /**
   * Manually forces a refresh of the calculated column headers.
   */
  protected forceHeaderRefresh(): void {
    // Re-trigger signals by setting them to fresh Date instances
    this.viewportStart.set(new Date(this.viewportStart().getTime()));
    this.viewportEnd.set(new Date(this.viewportEnd().getTime()));
    this.cdr.detectChanges();
  }

  /**
   * Auto-scrolls the wrapper if the mouse is near the edges during a drag.
   */
  private handleDragAutoScroll(clientX: number): void {
    const wrapper = this.ganttWrapper()?.nativeElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const edgeSize = 120; // Slightly larger edge size for expansion
    const scrollSpeed = 25; // Faster scroll for smoother expansion

    if (clientX >= rect.right - edgeSize) {
      // Force scroll right
      wrapper.scrollLeft += scrollSpeed;
      // Proactively check for infinite scroll to expand the grid
      this.checkInfiniteScroll();
      this.forceHeaderRefresh();
    } else if (clientX <= rect.left + edgeSize) {
      // Force scroll left
      wrapper.scrollLeft -= scrollSpeed;
      this.checkInfiniteScroll();
      this.forceHeaderRefresh();
    }
  }

  /* ── Global mouse move ── */
  @HostListener('document:mousemove', ['$event'])
  protected onGlobalMouseMove(event: MouseEvent): void {
    const area = this.timelineArea()?.nativeElement;
    if (!area) return;

    // 1. Handle auto-scrolling first
    if (this.cursorDragging || this.dragState) {
        this.handleDragAutoScroll(event.clientX);
    }

    // 2. Get FRESH rect AFTER potential scroll/expansion
    const rect = area.getBoundingClientRect();

    if (this.cursorDragging) {
      // Use clientX relative to the fresh area position
      const xPercent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const newTime = this.viewportStart().getTime() + xPercent * this.totalSpanMs();
      
      this.cursorDate.set(new Date(newTime));
      this.forceHeaderRefresh();
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
        this.forceHeaderRefresh();
        return;
    }

    if (!this.dragState) return;

    const dx = event.clientX - this.dragState.startMouseX;
    const pxToMs = this.totalSpanMs() / rect.width;
    const deltaMs = dx * pxToMs;

    const targetOrder = this.workOrders().find((o: WorkOrderDocument) => o.docId === this.dragState!.orderId);

    if (targetOrder) {
      let newStartIso = targetOrder.data.startDate;
      let newEndIso = targetOrder.data.endDate;

      switch (this.dragState!.mode) {
        case 'move': {
          const duration = this.dragState!.originalEnd.getTime() - this.dragState!.originalStart.getTime();
          const newStart = d3.timeDay.round(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          newStartIso = toIso(newStart);
          newEndIso = toIso(new Date(newStart.getTime() + duration));
          break;
        }
        case 'resize-start': {
          const snapped = d3.timeDay.round(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          if (snapped < this.dragState!.originalEnd) {
            newStartIso = toIso(snapped);
          }
          break;
        }
        case 'resize-end': {
          const snapped = d3.timeDay.round(new Date(this.dragState!.originalEnd.getTime() + deltaMs));
          if (snapped > this.dragState!.originalStart) {
            newEndIso = toIso(snapped);
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
    this.forceHeaderRefresh(); // Added for alignment
  }

  @HostListener('document:mouseup')
  protected onGlobalMouseUp(): void {
    if (this.dragState || this.cursorDragging || this.isPanning) {
      this.dragState = null;
      this.cursorDragging = false;
      this.isPanning = false;
      this.cdr.detectChanges();
      this.forceHeaderRefresh(); // Added for alignment
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.bar-ellipsis') && !target.closest('.ellipsis-dropdown')) {
      this.activeMenu.set(null);
    }
  }

}
