import {
  Component,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgbOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import { Subject, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import {
  WorkOrderDocument,
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
  calculateBarLeft,
  calculateBarWidth,
  calculateColumns,
  calculateInitialStart,
  calculateViewportRange,
  getColumnsPerScreen,
  getEndDateForColumnCount,
  getInterval,
  roundToDay,
  COLUMN_MIN_WIDTH,
} from './work-order-timeline.utils';

@Component({
  selector: 'app-work-order-timeline',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgSelectModule,
    ConfirmDialogComponent,
  ],
  templateUrl: './work-order-timeline.html',
  styleUrl: './work-order-timeline.scss',
})
export class WorkOrderTimelineComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly store = inject(WorkOrderStore);
  private readonly offcanvasService = inject(NgbOffcanvas);

  /* ── RxJS Event Stream ── */
  private readonly refresh$ = new Subject<void>();
  private readonly destroy$ = new Subject<void>();

  /* ── Refs ── */
  @ViewChild('timelineArea', { static: false }) timelineAreaRef!: ElementRef<HTMLDivElement>;
  @ViewChild('ganttWrapper', { static: false }) ganttWrapperRef!: ElementRef<HTMLDivElement>;

  /* ── Timescale ── */
  timeScale: TimeScale = 'Day';
  readonly timeScaleOptions: TimeScale[] = ['Day', 'Week', 'Month'];

  /* ── Status Filter ── */
  readonly statusFilterOptions: (WorkOrderStatus | 'all')[] = ['all', 'open', 'in-progress', 'complete', 'blocked'];

  /* ── Date viewport ── */
  viewportStart = new Date();
  viewportEnd = new Date();

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
  activeMenu: ActiveMenu | null = null;

  /* ── Confirm delete dialog ── */
  confirmVisible = false;
  confirmOrderToDelete: WorkOrderDocument | null = null;

  /* ── Tooltip ── */
  tooltip: TooltipState = { visible: false, text: '', x: 0, y: 0 };

  /* ── Panning state ── */
  private isPanning = false;
  private panStartX = 0;
  private panStartViewportStart = 0;

  /* ── Cached calculated values (recalculated on every refresh) ── */
  columns: ColumnHeader[] = [];
  totalSpanMs = 0;
  columnMinWidth = COLUMN_MIN_WIDTH;

  /* ══════════════════════════════════════════════
     LIFECYCLE
     ══════════════════════════════════════════════ */

  ngOnInit(): void {
    this.refresh$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.recalculate();
    });

    this.initViewport();
    this.recalculate();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.ensureMinimumColumns();
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     VIEWPORT SIZING — SCREEN-WIDTH DRIVEN
     ══════════════════════════════════════════════ */

  /**
   * Sets up the initial viewport.
   * Start = earliest work order date, offset back by 1 timescale unit,
   *         floored to the timescale boundary.
   * End = start + (columnsPerScreen × 3) timescale units.
   */
  private initViewport(): void {
    const start = calculateInitialStart(this.store.filteredWorkOrders(), this.timeScale);
    this.viewportStart = start;
    this.viewportEnd = this.calculateMinimumEnd(start);
  }

  private calculateMinimumEnd(start: Date): Date {
    const columnsPerScreen = getColumnsPerScreen();
    const totalColumns = columnsPerScreen * 3;
    return getEndDateForColumnCount(start, this.timeScale, totalColumns);
  }

  private ensureMinimumColumns(): void {
    const minimumEnd = this.calculateMinimumEnd(this.viewportStart);
    if (this.viewportEnd.getTime() < minimumEnd.getTime()) {
      this.viewportEnd = minimumEnd;
    }
  }

  /* ══════════════════════════════════════════════
     MASTER RECALCULATE
     ══════════════════════════════════════════════ */

  private recalculate(): void {
    this.ensureMinimumColumns();

    this.totalSpanMs = this.viewportEnd.getTime() - this.viewportStart.getTime();

    this.columns = calculateColumns(
      this.timeScale,
      this.viewportStart,
      this.viewportEnd,
      new Date()
    );

    // Infinite scroll — RIGHT ONLY
    this.checkInfiniteScroll();

    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     INFINITE SCROLL — RIGHT ONLY
     ══════════════════════════════════════════════ */

  /**
   * Extends the viewport to the right when the user scrolls near the right edge.
   * No left extension — the chart has a fixed start boundary.
   */
  private checkInfiniteScroll(): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;

    const { scrollLeft, scrollWidth, clientWidth } = wrapper;
    const buffer = this.columnMinWidth * 2;
    const columnsPerScreen = getColumnsPerScreen();
    const interval = getInterval(this.timeScale);

    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      this.viewportEnd = interval.offset(this.viewportEnd, columnsPerScreen);
      this.totalSpanMs = this.viewportEnd.getTime() - this.viewportStart.getTime();
      this.columns = calculateColumns(this.timeScale, this.viewportStart, this.viewportEnd, new Date());
      this.cdr.detectChanges();
    }
  }

  /* ══════════════════════════════════════════════
     USER ACTIONS — DROPDOWNS, NAVIGATION
     ══════════════════════════════════════════════ */

  onStatusFilterChange(status: WorkOrderStatus | 'all'): void {
    this.store.setStatusFilter(status);
    this.refresh$.next();
  }

  onTimeScaleChange(scale: TimeScale): void {
    this.timeScale = scale;
    this.initViewport();
    this.refresh$.next();
  }

  centerViewportOn(date: Date): void {
    const { start, end } = calculateViewportRange(date, this.timeScale);
    this.viewportStart = start;
    this.viewportEnd = end;

    this.refresh$.next();

    timer(0).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.scrollToDate(date);
    });
  }

  centerViewportOnToday(): void {
    this.centerViewportOn(new Date());
  }

  /* ══════════════════════════════════════════════
     SCROLLING
     ══════════════════════════════════════════════ */

  onGanttScroll(event: Event): void {
    this.refresh$.next();
  }

  private scrollToDate(date: Date): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;

    const start = this.viewportStart.getTime();
    const span = this.totalSpanMs;
    const targetMs = date.getTime();

    const percent = (targetMs - start) / span;
    const scrollTarget = percent * wrapper.scrollWidth - wrapper.clientWidth / 2;

    wrapper.scrollTo({
      left: Math.max(0, scrollTarget),
      behavior: 'smooth'
    });

    timer(50).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.refresh$.next();
    });
  }

  /* ══════════════════════════════════════════════
     BAR POSITIONING
     ══════════════════════════════════════════════ */

  getBarLeft(order: WorkOrderDocument): number {
    return calculateBarLeft(order, this.viewportStart.getTime(), this.totalSpanMs);
  }

  getBarWidth(order: WorkOrderDocument): number {
    return calculateBarWidth(order, this.totalSpanMs);
  }

  getOrdersForWorkCenter(workCenterId: string): WorkOrderDocument[] {
    return this.store.filteredWorkOrders().filter((o: WorkOrderDocument) => o.data.workCenterId === workCenterId);
  }

  getWorkCenterName(workCenterId: string): string {
    return this.store.getWorkCenterName(workCenterId);
  }

  /* ══════════════════════════════════════════════
     STATUS HELPERS
     ══════════════════════════════════════════════ */

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
    switch (this.timeScale) {
      case 'Day': return 'Current day';
      case 'Week': return 'Current week';
      case 'Month': return 'Current month';
    }
  }

  /* ══════════════════════════════════════════════
     MOUSE EVENTS — BAR DRAG, PAN, CLICK
     ══════════════════════════════════════════════ */

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
    this.refresh$.next();
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
    this.refresh$.next();
  }

  /* ── Timeline mousedown/up for click-vs-drag and Panning ── */
  onTimelineMouseDown(event: MouseEvent, workCenterId: string): void {
    if (event.button !== 0) return;
    event.preventDefault();

    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.mouseDownWorkCenterId = workCenterId;
    this.didDrag = false;

    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panStartViewportStart = this.viewportStart.getTime();
    this.refresh$.next();
  }

  onTimelineMouseUp(event: MouseEvent, workCenterId: string): void {
    if (this.isPanning) {
      this.isPanning = false;
    }

    if (this.didDrag || !this.mouseDownPos) {
      this.mouseDownPos = null;
      this.mouseDownWorkCenterId = null;
      this.refresh$.next();
      return;
    }

    const dx = Math.abs(event.clientX - this.mouseDownPos.x);
    const dy = Math.abs(event.clientY - this.mouseDownPos.y);

    if (dx < this.DRAG_THRESHOLD && dy < this.DRAG_THRESHOLD) {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const xPercent = (event.clientX - rect.left) / rect.width;
      const clickTime = this.viewportStart.getTime() + xPercent * this.totalSpanMs;
      const clickDate = roundToDay(new Date(clickTime));
      this.openCreatePanel(workCenterId, clickDate);
    }

    this.mouseDownPos = null;
    this.mouseDownWorkCenterId = null;
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     AUTO-SCROLL DURING BAR DRAG
     ══════════════════════════════════════════════ */

  private handleDragAutoScroll(clientX: number): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const edgeSize = 120;
    const scrollSpeed = 25;

    if (clientX >= rect.right - edgeSize) {
      wrapper.scrollLeft += scrollSpeed;

      // Extend viewport if near the end of content
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;
      if (scrollLeft + clientWidth >= scrollWidth - this.columnMinWidth * 2) {
        const interval = getInterval(this.timeScale);
        const columnsPerScreen = getColumnsPerScreen();
        this.viewportEnd = interval.offset(this.viewportEnd, columnsPerScreen);
        this.totalSpanMs = this.viewportEnd.getTime() - this.viewportStart.getTime();
        this.columns = calculateColumns(this.timeScale, this.viewportStart, this.viewportEnd, new Date());
        this.cdr.detectChanges();
      }
    } else if (clientX <= rect.left + edgeSize) {
      wrapper.scrollLeft -= scrollSpeed;
    }
  }

  /* ══════════════════════════════════════════════
     ELLIPSIS MENU
     ══════════════════════════════════════════════ */

  onEllipsisClick(event: MouseEvent, order: WorkOrderDocument): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.activeMenu && this.activeMenu.orderId === order.docId) {
      this.activeMenu = null;
      this.refresh$.next();
      return;
    }

    this.activeMenu = {
      orderId: order.docId,
      x: event.clientX,
      y: event.clientY,
    };
    this.refresh$.next();
  }

  onMenuEdit(order: WorkOrderDocument): void {
    this.activeMenu = null;
    this.refresh$.next();
    this.openEditPanel(order);
  }

  onMenuDelete(order: WorkOrderDocument): void {
    this.activeMenu = null;
    this.confirmOrderToDelete = order;
    this.confirmVisible = true;
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     CONFIRM DELETE
     ══════════════════════════════════════════════ */

  onConfirmDelete(): void {
    if (this.confirmOrderToDelete) {
      this.store.deleteWorkOrder(this.confirmOrderToDelete.docId);
      this.confirmOrderToDelete = null;
    }
    this.confirmVisible = false;
    this.refresh$.next();
  }

  onCancelDelete(): void {
    this.confirmOrderToDelete = null;
    this.confirmVisible = false;
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     PANEL OPERATIONS (Offcanvas)
     ══════════════════════════════════════════════ */

  private openCreatePanel(workCenterId: string, startDate: Date): void {
    const offcanvasRef = this.offcanvasService.open(WorkOrderPanelComponent, {
      position: 'end',
      panelClass: 'work-order-offcanvas',
      ariaLabelledBy: 'offcanvas-basic-title'
    });

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
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     TOOLTIP
     ══════════════════════════════════════════════ */

  onTimelineMouseMove(event: MouseEvent): void {
    if (this.dragState || this.isPanning) {
      this.tooltip = { ...this.tooltip, visible: false };
      return;
    }

    if (this.mouseDownPos) {
      const dx = Math.abs(event.clientX - this.mouseDownPos.x);
      const dy = Math.abs(event.clientY - this.mouseDownPos.y);
      if (dx >= this.DRAG_THRESHOLD || dy >= this.DRAG_THRESHOLD) {
        this.didDrag = true;
      }
    }

    const target = event.target as HTMLElement;
    const bar = target.closest('.bar') as HTMLElement;

    if (bar) {
      const title = bar.getAttribute('title') || 'Work Order';
      this.tooltip = { visible: true, text: title, x: event.clientX, y: event.clientY };
    } else {
      this.tooltip = { visible: true, text: 'Click to add work order', x: event.clientX, y: event.clientY };
    }
  }

  onTimelineMouseLeave(): void {
    this.tooltip = { ...this.tooltip, visible: false };
    this.refresh$.next();
  }

  /* ══════════════════════════════════════════════
     GLOBAL MOUSE EVENTS
     ══════════════════════════════════════════════ */

  @HostListener('document:mousemove', ['$event'])
  protected onGlobalMouseMove(event: MouseEvent): void {
    const area = this.timelineAreaRef?.nativeElement;
    if (!area) return;

    // Auto-scroll during bar drag
    if (this.dragState) {
      this.handleDragAutoScroll(event.clientX);
    }

    const rect = area.getBoundingClientRect();

    if (this.isPanning) {
      const dx = event.clientX - this.panStartX;
      const totalMs = this.totalSpanMs;
      const msPerPx = totalMs / rect.width;
      const deltaMs = dx * msPerPx;

      const newStart = this.panStartViewportStart - deltaMs;
      const newEnd = newStart + totalMs;

      this.viewportStart = new Date(newStart);
      this.viewportEnd = new Date(newEnd);

      this.refresh$.next();
      return;
    }

    if (!this.dragState) return;

    const dx = event.clientX - this.dragState.startMouseX;
    const pxToMs = this.totalSpanMs / rect.width;
    const deltaMs = dx * pxToMs;

    const targetOrder = this.store.filteredWorkOrders().find(
      (o: WorkOrderDocument) => o.docId === this.dragState!.orderId
    );

    if (targetOrder) {
      let newStartIso = targetOrder.data.startDate;
      let newEndIso = targetOrder.data.endDate;

      switch (this.dragState!.mode) {
        case 'move': {
          const duration = this.dragState!.originalEnd.getTime() - this.dragState!.originalStart.getTime();
          const newStart = roundToDay(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          newStartIso = toIso(newStart);
          newEndIso = toIso(new Date(newStart.getTime() + duration));
          break;
        }
        case 'resize-start': {
          const snapped = roundToDay(new Date(this.dragState!.originalStart.getTime() + deltaMs));
          if (snapped < this.dragState!.originalEnd) {
            newStartIso = toIso(snapped);
          }
          break;
        }
        case 'resize-end': {
          const snapped = roundToDay(new Date(this.dragState!.originalEnd.getTime() + deltaMs));
          if (snapped > this.dragState!.originalStart) {
            newEndIso = toIso(snapped);
          }
          break;
        }
      }

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

    this.refresh$.next();
  }

  @HostListener('document:mouseup')
  protected onGlobalMouseUp(): void {
    if (this.dragState || this.isPanning) {
      this.dragState = null;
      this.isPanning = false;
      this.refresh$.next();
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.bar-ellipsis') && !target.closest('.ellipsis-dropdown')) {
      this.activeMenu = null;
      this.refresh$.next();
    }
  }
}
