
import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
  HostListener,
  inject,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgbOffcanvas, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CsvExportComponent } from '../csv-export/csv-export';
import { trigger, transition, style, animate } from '@angular/animations';
import { Subject, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as d3 from 'd3';
import { DateTime } from 'luxon';

import {
  WorkOrderDocument,
  WorkOrderStatus,
  TimeScale,
  WorkCenterDocument,
} from '../../models/work-order.model';
import { WorkOrderStore } from '../../store/work-order.store';
import {
  WorkOrderPanelComponent,
  PanelSaveEvent,
} from '../work-order-panel/work-order-panel';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { ActiveOrdersCardComponent } from '../active-orders-card/active-orders-card';

import {
  ActiveMenu,
  TooltipState,
} from './work-order-timeline.types';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import {
  toIso,
  getStatusLabel,
  formatColumnLabel,
  isDateInCurrentPeriod,
  getInterval,
  roundToDay,
  calculateInitialStart,
  getColumnsPerScreen,
  COLUMN_MIN_WIDTH,
} from './work-order-timeline.utils';

/* ── Local interfaces for D3 data binding ── */
interface BarDatum {
  order: WorkOrderDocument;
  x: number;
  y: number;
  w: number;
  h: number;
}

@Component({
  selector: 'app-work-order-timeline',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgSelectModule,
    ConfirmDialogComponent,
    ActiveOrdersCardComponent,
  ],
  templateUrl: './work-order-timeline.html',
  styleUrl: './work-order-timeline.scss',
  encapsulation: ViewEncapsulation.None,
})
export class WorkOrderTimelineComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly store = inject(WorkOrderStore);
  private readonly offcanvasService = inject(NgbOffcanvas);
  private readonly modalService = inject(NgbModal);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  /* ── RxJS ── */
  private readonly destroy$ = new Subject<void>();

  /* ── Refs ── */
  @ViewChild('ganttSvg', { static: false }) ganttSvgRef!: ElementRef<SVGSVGElement>;
  @ViewChild('ganttWrapper', { static: false }) ganttWrapperRef!: ElementRef<HTMLDivElement>;

  /* ── Timescale ── */
  timeScale: TimeScale = 'Day';
  readonly timeScaleOptions: TimeScale[] = ['Day', 'Week', 'Month'];

  /* ── Status Filter ── */
  readonly statusFilterOptions: (WorkOrderStatus | 'all')[] = ['all', 'open', 'in-progress', 'complete', 'blocked'];

  /* ── Date viewport ── */
  viewportStart = new Date();
  viewportEnd = new Date();
  cursorDate = new Date(); // To track the draggable cursor position

  activeOrders: WorkOrderDocument[] = []; // Orders visible at cursor position
  cursorPeriodLabel = ''; // e.g. "October 2025" or "Week 42"

  /* ── Layout constants ── */
  readonly HEADER_HEIGHT = 36;
  readonly ROW_HEIGHT = 56;
  readonly BAR_PADDING = 10;
  readonly BAR_HEIGHT = 36;
  readonly COLUMN_MIN_WIDTH = COLUMN_MIN_WIDTH;

  /* ── D3 internal ── */
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gridGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private highlightGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private barsGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private headerGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private cursorGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale!: d3.ScaleTime<number, number>;
  private svgWidth = 0;
  private svgHeight = 0;
  private totalSpanMs = 0;

  /* ── Drag state (for bars) ── */
  private _dragStartMouseX = 0;
  private _dragOrigStart: Date | null = null;
  private _dragOrigEnd: Date | null = null;

  /* ── Click-vs-drag detection ── */
  private mouseDownPos: { x: number; y: number } | null = null;
  private mouseDownWorkCenterId: string | null = null;
  private didDrag = false;
  private readonly DRAG_THRESHOLD = 5;

  /* ── UI state ── */
  activeMenu: ActiveMenu | null = null;
  confirmVisible = false;
  confirmOrderToDelete: WorkOrderDocument | null = null;
  tooltip: TooltipState = { visible: false, text: '', x: 0, y: 0 };

  /* ══════════════════════════════════════════════
     LIFECYCLE
     ══════════════════════════════════════════════ */

  ngOnInit(): void {
    this.api.getSettings().pipe(takeUntil(this.destroy$)).subscribe(settings => {
      if (settings && settings.timeScale) {
        this.timeScale = settings.timeScale;
        this.initViewport();
        // Check if view is initialized (it might not be if response is fast)
        if (this.svg) this.renderChart();
      }
    });
    this.initViewport();
  }

  ngAfterViewInit(): void {
    this.initD3();
    this.renderChart();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.ensureMinimumColumns();
    this.renderChart();
  }

  /* ══════════════════════════════════════════════
     VIEWPORT
     ══════════════════════════════════════════════ */

  private initViewport(): void {
    const start = calculateInitialStart(this.store.filteredWorkOrders(), this.timeScale);
    this.viewportStart = start;
    this.viewportEnd = this.calculateMinimumEnd(start);
  }

  private calculateMinimumEnd(start: Date): Date {
    const columnsPerScreen = getColumnsPerScreen();
    const totalColumns = columnsPerScreen * 3;
    const interval = getInterval(this.timeScale);
    return interval.offset(interval.floor(start), totalColumns);
  }

  private ensureMinimumColumns(): void {
    const minimumEnd = this.calculateMinimumEnd(this.viewportStart);
    if (this.viewportEnd.getTime() < minimumEnd.getTime()) {
      this.viewportEnd = minimumEnd;
    }
  }

  /* ══════════════════════════════════════════════
     D3 INITIALIZATION
     ══════════════════════════════════════════════ */

  private initD3(): void {
    const svgEl = this.ganttSvgRef?.nativeElement;
    if (!svgEl) return;

    this.svg = d3.select(svgEl);

    // Create layer groups in rendering order (back to front)
    this.highlightGroup = this.svg.append('g').attr('class', 'highlight-group');
    this.gridGroup = this.svg.append('g').attr('class', 'grid-group');
    this.barsGroup = this.svg.append('g').attr('class', 'bars-group');
    this.headerGroup = this.svg.append('g').attr('class', 'header-group');
    this.cursorGroup = this.svg.append('g').attr('class', 'cursor-group');
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — MASTER
     ══════════════════════════════════════════════ */

  renderChart(): void {
    if (!this.svg) return;

    this.ensureMinimumColumns();

    const workCenters = this.store.workCenters();
    const orders = this.store.filteredWorkOrders();
    const now = this.cursorDate; // Use cursorDate instead of new Date()
    const interval = getInterval(this.timeScale);

    // Generate column ticks
    const ticks = interval.range(
      interval.floor(this.viewportStart),
      this.viewportEnd
    );

    // Compute dimensions
    this.svgWidth = ticks.length * this.COLUMN_MIN_WIDTH;
    this.svgHeight = this.HEADER_HEIGHT + workCenters.length * this.ROW_HEIGHT;
    this.totalSpanMs = this.viewportEnd.getTime() - this.viewportStart.getTime();

    // Size the SVG
    this.svg
      .attr('width', this.svgWidth)
      .attr('height', this.svgHeight);

    // X scale: date → pixel
    this.xScale = d3.scaleTime()
      .domain([this.viewportStart, this.viewportEnd])
      .range([0, this.svgWidth]);

    // Render layers
    this.renderGrid(workCenters, ticks, now);
    this.renderBars(workCenters, orders);
    this.renderHeaders(ticks, now);
    this.renderCursor(now);
    // Update active orders list
    this.updateActiveOrders();
    
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — GRID
     ══════════════════════════════════════════════ */

  private renderGrid(
    workCenters: WorkCenterDocument[],
    ticks: Date[],
    now: Date
  ): void {
    const interval = getInterval(this.timeScale);


    // ── Row backgrounds (alternating) ──
    const rowData = workCenters.map((wc, i) => ({
      y: this.HEADER_HEIGHT + i * this.ROW_HEIGHT,
      isEven: i % 2 === 0,
      workCenterId: wc.docId,
    }));

    const rows = this.gridGroup.selectAll<SVGRectElement, (typeof rowData)[0]>('rect.row-bg')
      .data(rowData, d => d.workCenterId);

    rows.join('rect')
      .attr('class', d => `row-bg${d.isEven ? ' even' : ''}`)
      .attr('id', d => `row-${d.workCenterId}`) // Add ID for hover selection
      .attr('x', 0)
      .attr('y', d => d.y)
      .attr('width', this.svgWidth)
      .attr('height', this.ROW_HEIGHT);

    // ── Vertical grid lines ──
    const vLines = this.gridGroup.selectAll<SVGLineElement, Date>('line.grid-line')
      .data(ticks);

    vLines.join('line')
      .attr('class', 'grid-line')
      .attr('x1', d => this.xScale(d))
      .attr('y1', this.HEADER_HEIGHT)
      .attr('x2', d => this.xScale(d))
      .attr('y2', this.svgHeight);

    // ── Horizontal row borders ──
    const hLines = this.gridGroup.selectAll<SVGLineElement, (typeof rowData)[0]>('line.row-border')
      .data(rowData, d => d.workCenterId);

    hLines.join('line')
      .attr('class', 'row-border')
      .attr('x1', 0)
      .attr('y1', d => d.y + this.ROW_HEIGHT)
      .attr('x2', this.svgWidth)
      .attr('y2', d => d.y + this.ROW_HEIGHT);

    // ── Current period highlights ──
    const currentTicks = ticks.filter(t => isDateInCurrentPeriod(t, now, this.timeScale));
    const currentData = currentTicks.map(tick => ({
      x: this.xScale(tick),
      w: this.xScale(interval.offset(tick, 1)) - this.xScale(tick),
    }));

    const highlights = this.gridGroup.selectAll<SVGRectElement, (typeof currentData)[0]>('rect.current-highlight')
      .data(currentData);

    highlights.join('rect')
      .attr('class', 'current-highlight')
      .attr('x', d => d.x)
      .attr('y', this.HEADER_HEIGHT)
      .attr('width', d => d.w)
      .attr('height', this.svgHeight - this.HEADER_HEIGHT);


    // ── Interaction overlay rects (transparent, for click-to-create + tooltip) ──
    const self = this;
    const overlays = this.gridGroup.selectAll<SVGRectElement, (typeof rowData)[0]>('rect.grid-overlay')
      .data(rowData, d => d.workCenterId);

    overlays.join(
      enter => enter.append('rect')
        .attr('class', 'grid-overlay')
        .style('fill', 'transparent')
        .style('cursor', () => this.auth.isAdmin() ? 'pointer' : 'default')
        .on('mousedown', function (event: MouseEvent, d) {
          if (!self.auth.isAdmin()) return;
          self.onGridMouseDown(event, d.workCenterId);
        })
        .on('mouseup', function (event: MouseEvent, d) {
          self.onGridMouseUp(event, d.workCenterId);
        })
        .on('mousemove', function (event: MouseEvent, d) {
          const [x] = d3.pointer(event);
          const date = self.xScale.invert(x);
          self.highlightCell(d.workCenterId, date);
          self.onGridMouseMove(event);
        })
        // Row hover effect
        .on('mouseenter', function (event, d) {
          self.gridGroup.select(`#row-${d.workCenterId}`).classed('hovered', true);
        })
        .on('mouseleave', function (event, d) {
          self.gridGroup.select(`#row-${d.workCenterId}`).classed('hovered', false);
          self.clearCellHighlight();
          self.tooltip = { ...self.tooltip, visible: false };
          self.cdr.detectChanges();
        }),
      update => update,
      exit => exit.remove()
    )
      .attr('x', 0)
      .attr('y', d => d.y)
      .attr('width', this.svgWidth)
      .attr('height', this.ROW_HEIGHT);

  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — HEADERS
     ══════════════════════════════════════════════ */

  private renderHeaders(ticks: Date[], now: Date): void {
    const interval = getInterval(this.timeScale);

    const headerData = ticks.map(tick => {
      const x = this.xScale(tick);
      const w = this.xScale(interval.offset(tick, 1)) - x;
      return {
        x, w,
        label: formatColumnLabel(tick, this.timeScale),
        isCurrent: isDateInCurrentPeriod(tick, now, this.timeScale),
        date: tick,
      };
    });

    // ── Header background strip ──
    this.headerGroup.selectAll('rect.header-strip').remove();
    this.headerGroup.insert('rect', ':first-child')
      .attr('class', 'header-strip')
      .attr('x', 0).attr('y', 0)
      .attr('width', this.svgWidth)
      .attr('height', this.HEADER_HEIGHT);

    // ── Column header cells ──
    const headerCells = this.headerGroup
      .selectAll<SVGRectElement, (typeof headerData)[0]>('rect.header-cell')
      .data(headerData);

    headerCells.join('rect')
      .attr('class', d => `header-cell${d.isCurrent ? ' current-period' : ''}`)
      .attr('x', d => d.x)
      .attr('y', 0)
      .attr('width', d => d.w)
      .attr('height', this.HEADER_HEIGHT);

    // ── Column labels ──
    const labels = this.headerGroup
      .selectAll<SVGTextElement, (typeof headerData)[0]>('text.col-label')
      .data(headerData);

    labels.join('text')
      .attr('class', d => `col-label${d.isCurrent ? ' current-period' : ''}`)
      .attr('x', d => d.x + d.w / 2)
      .attr('y', this.HEADER_HEIGHT / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .text(d => d.label);

    // ── Header bottom border ──
    this.headerGroup.selectAll('line.header-border').remove();
    this.headerGroup.append('line')
      .attr('class', 'header-border')
      .attr('x1', 0).attr('y1', this.HEADER_HEIGHT)
      .attr('x2', this.svgWidth).attr('y2', this.HEADER_HEIGHT);
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — CURSOR (Current Time / Slider)
     ══════════════════════════════════════════════ */

  private renderCursor(date: Date): void {
    // Only render if within viewport (expanded slightly to avoid edge flickering)
    if (date < this.viewportStart || date > this.viewportEnd) {
      this.cursorGroup.selectAll('*').remove();
      return;
    }

    const x = this.xScale(date);
    const self = this;

    const drag = d3.drag<SVGGElement, any>()
      .on('drag', function (event) {
        // Constrain x to viewport width
        let newX = event.x;
        newX = Math.max(0, Math.min(newX, self.svgWidth));

        // Use invert to get date from x
        self.cursorDate = self.xScale.invert(newX);
        self.renderChart(); // Re-render to update highlights + line position + active orders
        self.updateActiveOrders();
      });

    // Cursor Group Container
    const cursor = this.cursorGroup
      .selectAll<SVGGElement, unknown>('g.cursor-container')
      .data([date]);

    const enter = cursor.enter().append('g')
      .attr('class', 'cursor-container')
      .call(drag)
      .style('cursor', 'ew-resize');

    // Line
    enter.append('line')
      .attr('class', 'cursor-line')
      .attr('y1', 0) // From top of SVG (including header)
      .attr('y2', this.svgHeight) // To bottom
      .attr('stroke', '#5046e5')
      .attr('stroke-width', 2);

    // Handle (Circle at top)
    enter.append('circle')
      .attr('class', 'cursor-handle')
      .attr('r', 5)
      .attr('cy', this.HEADER_HEIGHT / 2) // Center in header
      .attr('fill', '#5046e5');

    // Merge update
    const merged = enter.merge(cursor);
    merged.attr('transform', `translate(${x}, 0)`);

    // Update dimensions if height changed
    merged.select('line')
      .attr('y2', this.svgHeight);

    cursor.exit().remove();
  }

  /* ── Hover Highlighting ── */
  private highlightCell(wcId: string, date: Date): void {
    const workCenters = this.store.workCenters();
    const wcIndex = workCenters.findIndex(w => w.docId === wcId);
    if (wcIndex === -1) return;

    // Calculate generic cell
    const interval = getInterval(this.timeScale);
    const start = interval.floor(date);
    const end = interval.offset(start, 1);
    
    // Check bounds
    if (start < this.viewportStart || start >= this.viewportEnd) {
      this.clearCellHighlight();
      return;
    }

    const x = this.xScale(start);
    const w = this.xScale(end) - x;
    const y = this.HEADER_HEIGHT + wcIndex * this.ROW_HEIGHT;

    // Render highlight rect
    const highlight = this.highlightGroup.selectAll<SVGRectElement, unknown>('rect.hover-cell-highlight')
      .data([1]); // Single item data join

    highlight.join(
      enter => enter.append('rect')
        .attr('class', 'hover-cell-highlight')
        .style('pointer-events', 'none'),
      update => update
    )
      .attr('x', x)
      .attr('y', y)
      .attr('width', w)
      .attr('height', this.ROW_HEIGHT);
  }

  private clearCellHighlight(): void {
    this.highlightGroup.selectAll('*').remove();
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — BARS
     ══════════════════════════════════════════════ */

  private renderBars(
    workCenters: WorkCenterDocument[],
    orders: WorkOrderDocument[]
  ): void {
    const wcIndexMap = new Map<string, number>();
    workCenters.forEach((wc, i) => wcIndexMap.set(wc.docId, i));

    const barData: BarDatum[] = orders
      .filter(o => wcIndexMap.has(o.data.workCenterId))
      .map(order => {
        const rowIdx = wcIndexMap.get(order.data.workCenterId)!;
        const startDate = new Date(order.data.startDate);
        const endDate = new Date(order.data.endDate);
        const x = this.xScale(startDate);
        const w = this.xScale(endDate) - x;
        const y = this.HEADER_HEIGHT + rowIdx * this.ROW_HEIGHT + this.BAR_PADDING;
        const h = this.BAR_HEIGHT;
        return { order, x, y, w, h };
      });

    const self = this;

    // Helper method for updating order dates
    const updateOrderDates = (order: WorkOrderDocument, newStart: Date, newEnd: Date) => {
      const newStartIso = toIso(roundToDay(newStart));
      const newEndIso = toIso(roundToDay(newEnd));
      const overlap = self.store.checkOverlap(
        order.data.workCenterId, newStartIso, newEndIso, order.docId
      );
      if (!overlap) {
        self.store.updateWorkOrder(order.docId, {
          ...order.data,
          startDate: newStartIso,
          endDate: newEndIso,
        });
        self.renderChart();
      }
    };

    // ── Bar drag behavior (move) ──
    const barDrag = d3.drag<SVGGElement, BarDatum>()
      .filter(() => self.auth.isAdmin())
      .on('start', function (event, d) {
        event.sourceEvent.stopPropagation();
        event.sourceEvent.preventDefault();
        self.didDrag = true;
        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);
        d3.select(this).classed('dragging', true);
      })
      .on('drag', function (event, d) {
        if (!self._dragOrigStart || !self._dragOrigEnd) return;
        const dx = event.dx;
        // Visual update
        d.x += dx;
        d3.select(this).attr('transform', `translate(${d.x}, ${d.y})`);
      })
      .on('end', function (event, d) {
        d3.select(this).classed('dragging', false);
        if (!self._dragOrigStart || !self._dragOrigEnd) return;
        
        // Calculate new start/end
        const currentX = d.x;
        const newStart = self.xScale.invert(currentX);
        const duration = self._dragOrigEnd.getTime() - self._dragOrigStart.getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        
        updateOrderDates(d.order, newStart, newEnd);

        self._dragOrigStart = null;
        self._dragOrigEnd = null;
      });

    // ── Resize drag behavior (left edge) ──
    const resizeLeftDrag = d3.drag<SVGRectElement, BarDatum>()
      .filter(() => self.auth.isAdmin())
      .on('start', function (event, d) {
        event.sourceEvent.stopPropagation();
        event.sourceEvent.preventDefault();
        self.didDrag = true;
        self._dragStartMouseX = event.sourceEvent.clientX; // For reference if needed, but we use dx
        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);
      })
      .on('drag', function (event, d) {
        const dx = event.dx;
        d.x += dx;
        d.w -= dx;
        // Update parent group transform
        const group = d3.select(this.parentNode?.parentNode as SVGGElement);
        group.attr('transform', `translate(${d.x}, ${d.y})`);
        
        // Update bars layout visually? Or wait for end?
        // Updating visual width
        group.select('rect.bar-rect').attr('width', Math.max(d.w, 2));
      })
      .on('end', function (event, d) {
        if (!self._dragOrigStart || !self._dragOrigEnd) return;
        const newStart = self.xScale.invert(d.x);
        // Only update startDate
         const newStartIso = toIso(roundToDay(newStart));
          // Check overlap... logic similar to move
          if (newStart < self._dragOrigEnd!) { // Ensure start < end
             updateOrderDates(d.order, newStart, self._dragOrigEnd!);
          } else {
             self.renderChart(); // Revert
          }
        self._dragOrigStart = null;
        self._dragOrigEnd = null;
      });

    // ── Resize drag behavior (right edge) ──
    const resizeRightDrag = d3.drag<SVGRectElement, BarDatum>()
      .filter(() => self.auth.isAdmin())
      .on('start', function (event, d) {
        event.sourceEvent.stopPropagation();
        event.sourceEvent.preventDefault();
        self.didDrag = true;
        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);
      })
      .on('drag', function (event, d) {
        const dx = event.dx;
        d.w += dx;
        const group = d3.select(this.parentNode?.parentNode as SVGGElement);
        group.select('rect.bar-rect').attr('width', Math.max(d.w, 2));
      })
      .on('end', function (event, d) {
        if (!self._dragOrigStart || !self._dragOrigEnd) return;
        const newEnd = self.xScale.invert(d.x + d.w);
        if (newEnd > self._dragOrigStart!) {
            updateOrderDates(d.order, self._dragOrigStart!, newEnd);
        } else {
            self.renderChart();
        }
        self._dragOrigStart = null;
        self._dragOrigEnd = null;
      });

    // ── D3 join: bar groups ──
    const barGroups = this.barsGroup
      .selectAll<SVGGElement, BarDatum>('g.bar-group')
      .data(barData, d => d.order.docId);

    // Enter: create new bar groups
    const enter = barGroups.enter().append('g')
      .attr('class', 'bar-group')
      .call(barDrag);

    // Clip path defs
    enter.append('clipPath')
      .attr('id', d => `clip-${d.order.docId}`)
      .append('rect').attr('rx', 6).attr('ry', 6);

    // Bar rect
    enter.append('rect').attr('class', 'bar-rect');

    // Left resize handle
    enter.append('rect').attr('class', 'resize-handle resize-left')
      .call(resizeLeftDrag);

    // Right resize handle
    enter.append('rect').attr('class', 'resize-handle resize-right')
      .call(resizeRightDrag);

    // Clipped content group
    const contentGroup = enter.append('g')
      .attr('class', 'bar-content')
      .attr('clip-path', d => `url(#clip-${d.order.docId})`);

    // Title
    contentGroup.append('text').attr('class', 'bar-title');
    // Status Pill
    contentGroup.append('rect').attr('class', 'status-pill-bg');
    // Status Label
    contentGroup.append('text').attr('class', 'bar-status-label');

    // Ellipsis
    enter.append('text').attr('class', 'bar-ellipsis')
      .text('⋯')
      .on('click', function (event: MouseEvent, d: BarDatum) {
        event.stopPropagation();
        self.onEllipsisClick(event, d.order);
      });

    // Tooltip events
    enter.select('rect.bar-rect')
      .on('mouseover', function (event: MouseEvent, d: BarDatum) {
        const title = `${d.order.data.name} (${d.order.data.startDate} – ${d.order.data.endDate})`;
        self.tooltip = { visible: true, text: title, x: event.clientX, y: event.clientY };
        self.cdr.detectChanges();
      })
      .on('mouseout', function () {
        self.tooltip = { ...self.tooltip, visible: false };
        self.cdr.detectChanges();
      })
      .on('mousemove', function (event: MouseEvent) {
        self.tooltip = { ...self.tooltip, x: event.clientX, y: event.clientY };
        self.cdr.detectChanges();
      });

    // ── Merge: update positions ──
    const merged = enter.merge(barGroups);
    merged.attr('transform', d => `translate(${d.x}, ${d.y})`);
    
    // Update cursor style based on admin
    merged.style('cursor', () => this.auth.isAdmin() ? 'grab' : 'default');

    // Update clip rect
    merged.select('clipPath rect')
      .attr('width', d => Math.max(d.w, 0))
      .attr('height', d => d.h);

    // Update bar rect
    merged.select<SVGRectElement>('rect.bar-rect')
      .attr('width', d => Math.max(d.w, 2))
      .attr('height', d => d.h)
      .attr('class', d => `bar-rect bar-${d.order.data.status}`);

    // Update resize handles
    merged.select<SVGRectElement>('rect.resize-left')
      .attr('x', 0).attr('y', 0)
      .attr('width', 8).attr('height', d => d.h)
      .style('cursor', () => this.auth.isAdmin() ? 'ew-resize' : 'default');

    merged.select<SVGRectElement>('rect.resize-right')
      .attr('x', d => Math.max(d.w - 8, 0)).attr('y', 0)
      .attr('width', 8).attr('height', d => d.h)
      .style('cursor', () => this.auth.isAdmin() ? 'ew-resize' : 'default');

    // Update title
    merged.select<SVGTextElement>('text.bar-title')
      .attr('x', 12)
      .attr('y', d => d.h / 2)
      .attr('dominant-baseline', 'central')
      .text(d => d.order.data.name);

    // Determine status width for pill sizing
    const getPillWidth = (status: string) => {
      switch (status) {
        case 'in-progress': return 74;
        case 'complete': return 68;
        case 'blocked': return 60;
        default: return 50; // open
      }
    };

    // Update status pill background
    merged.select<SVGRectElement>('rect.status-pill-bg')
      .attr('x', d => Math.max(d.w - getPillWidth(d.order.data.status) - 30, 100))
      .attr('y', d => d.h / 2 - 10) 
      .attr('width', d => getPillWidth(d.order.data.status))
      .attr('height', 20)
      .attr('rx', 4).attr('ry', 4)
      .attr('class', d => `status-pill-bg pill-${d.order.data.status}`);

    // Update status label text
    merged.select<SVGTextElement>('text.bar-status-label')
      .attr('x', d => Math.max(d.w - getPillWidth(d.order.data.status) - 30, 100) + getPillWidth(d.order.data.status) / 2)
      .attr('y', d => d.h / 2)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('class', d => `bar-status-label status-${d.order.data.status}`)
      .text(d => getStatusLabel(d.order.data.status));

    // Update ellipsis
    merged.select<SVGTextElement>('text.bar-ellipsis')
      .attr('x', d => Math.max(d.w - 12, 12))
      .attr('y', d => d.h / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('display', () => this.auth.isAdmin() ? 'block' : 'none'); // Hide ellipsis if not admin!

    // ── Exit: remove old bars ──
    barGroups.exit().remove();

  }

  /* ══════════════════════════════════════════════
     GRID INTERACTION HANDLERS
     ══════════════════════════════════════════════ */

  private onGridMouseDown(event: MouseEvent, workCenterId: string): void {
    if (event.button !== 0) return;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.mouseDownWorkCenterId = workCenterId;
    this.didDrag = false;
  }

  private onGridMouseUp(event: MouseEvent, workCenterId: string): void {
    if (this.didDrag || !this.mouseDownPos) {
      this.mouseDownPos = null;
      this.mouseDownWorkCenterId = null;
      return;
    }

    const dx = Math.abs(event.clientX - this.mouseDownPos.x);
    const dy = Math.abs(event.clientY - this.mouseDownPos.y);

    if (dx < this.DRAG_THRESHOLD && dy < this.DRAG_THRESHOLD) {
      // Convert screen X to time using the xScale
      const svgEl = this.ganttSvgRef?.nativeElement;
      if (svgEl) {
        const svgRect = svgEl.getBoundingClientRect();
        const wrapper = this.ganttWrapperRef?.nativeElement;
        const xInSvg = event.clientX - svgRect.left;
        const clickDate = roundToDay(this.xScale.invert(xInSvg));
        this.openCreatePanel(workCenterId, clickDate);
      }
    }

    this.mouseDownPos = null;
    this.mouseDownWorkCenterId = null;
  }

  private onGridMouseMove(event: MouseEvent): void {
    if (this.mouseDownPos) {
      const dx = Math.abs(event.clientX - this.mouseDownPos.x);
      const dy = Math.abs(event.clientY - this.mouseDownPos.y);
      if (dx >= this.DRAG_THRESHOLD || dy >= this.DRAG_THRESHOLD) {
        this.didDrag = true;
      }
    }

    // Show tooltip
    this.tooltip = {
      visible: true,
      text: 'Click to add work order',
      x: event.clientX,
      y: event.clientY,
    };
    this.cdr.detectChanges();
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

      const { scrollLeft, scrollWidth, clientWidth } = wrapper;
      if (scrollLeft + clientWidth >= scrollWidth - this.COLUMN_MIN_WIDTH * 2) {
        const interval = getInterval(this.timeScale);
        const columnsPerScreen = getColumnsPerScreen();
        this.viewportEnd = interval.offset(this.viewportEnd, columnsPerScreen);
        // Don't call renderChart here — the drag handler will do it
      }
    } else if (clientX <= rect.left + edgeSize) {
      wrapper.scrollLeft -= scrollSpeed;
    }
  }

  /* ══════════════════════════════════════════════
     USER ACTIONS — DROPDOWNS, NAVIGATION
     ══════════════════════════════════════════════ */

  onStatusFilterChange(status: WorkOrderStatus | 'all'): void {
    this.store.setStatusFilter(status);
    this.renderChart();
  }

  onTimeScaleChange(scale: TimeScale): void {
    this.timeScale = scale;
    this.api.updateSettings({ timeScale: scale }).pipe(takeUntil(this.destroy$)).subscribe();
    this.initViewport();
    this.renderChart();
  }

  centerViewportOnToday(): void {
    const now = new Date();
    this.cursorDate = now; // Reset cursor to Now
    const interval = getInterval(this.timeScale);
    const columnsPerScreen = getColumnsPerScreen();
    const totalColumns = columnsPerScreen * 3;
    const halfColumns = Math.floor(totalColumns / 2);

    this.viewportStart = interval.offset(interval.floor(now), -halfColumns);
    this.viewportEnd = interval.offset(this.viewportStart, totalColumns);

    this.renderChart();
    this.updateActiveOrders();

    // Scroll to center on today
    timer(0).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.scrollToDate(now);
    });
  }

  /* ══════════════════════════════════════════════
     SCROLLING & INFINITE SCROLL
     ══════════════════════════════════════════════ */

  onGanttScroll(): void {
    this.checkInfiniteScroll();
  }

  private scrollToDate(date: Date): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;
    if (!this.xScale) return;

    const xPos = this.xScale(date);
    const scrollTarget = xPos - (wrapper.clientWidth - 280) / 2;

    wrapper.scrollTo({
      left: Math.max(0, scrollTarget),
      behavior: 'smooth'
    });
  }

  private checkInfiniteScroll(): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;

    const { scrollLeft, scrollWidth, clientWidth } = wrapper;
    const buffer = this.COLUMN_MIN_WIDTH * 2;

    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      const interval = getInterval(this.timeScale);
      const columnsPerScreen = getColumnsPerScreen();
      this.viewportEnd = interval.offset(this.viewportEnd, columnsPerScreen);
      this.renderChart();
    }
  }

  /* ══════════════════════════════════════════════
     STATUS HELPERS
     ══════════════════════════════════════════════ */

  /* ── Status Helpers ── */
  getStatusLabel(status: WorkOrderStatus): string {
    return getStatusLabel(status);
  }

  /* ── Active Orders Logic ── */
  private updateActiveOrders(): void {
    const cursor = DateTime.fromJSDate(this.cursorDate);
    const orders = this.store.filteredWorkOrders();

    // Determine period based on timescale
    let start: DateTime;
    let end: DateTime;

    if (this.timeScale === 'Day') {
      start = cursor.startOf('day');
      end = cursor.endOf('day');
      this.cursorPeriodLabel = cursor.toFormat('MMMM dd, yyyy');
    } else if (this.timeScale === 'Week') {
      start = cursor.startOf('week');
      end = cursor.endOf('week');
      this.cursorPeriodLabel = `Week of ${cursor.toFormat('MMM dd, yyyy')}`;
    } else { // Month
      start = cursor.startOf('month');
      end = cursor.endOf('month');
      this.cursorPeriodLabel = cursor.toFormat('MMMM yyyy');
    }

    this.activeOrders = orders.filter(o => {
      // Check overlap: Order Start <= Period End AND Order End >= Period Start
      const oStart = DateTime.fromISO(o.data.startDate);
      const oEnd = DateTime.fromISO(o.data.endDate);
      return oStart <= end && oEnd >= start;
    });
  }

  /* ══════════════════════════════════════════════
     ELLIPSIS MENU
     ══════════════════════════════════════════════ */

  onEllipsisClick(event: MouseEvent, order: WorkOrderDocument): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.activeMenu && this.activeMenu.orderId === order.docId) {
      this.activeMenu = null;
      this.cdr.detectChanges();
      return;
    }

    this.activeMenu = {
      orderId: order.docId,
      x: event.clientX,
      y: event.clientY,
    };
    this.cdr.detectChanges();
  }

  onMenuEdit(): void {
    if (!this.activeMenu) return;
    const order = this.store.filteredWorkOrders().find(
      (o: WorkOrderDocument) => o.docId === this.activeMenu!.orderId
    );
    this.activeMenu = null;
    this.cdr.detectChanges();
    if (order) this.openEditPanel(order);
  }

  onMenuDelete(): void {
    if (!this.activeMenu) return;
    const order = this.store.filteredWorkOrders().find(
      (o: WorkOrderDocument) => o.docId === this.activeMenu!.orderId
    );
    this.activeMenu = null;
    if (order) {
      this.confirmOrderToDelete = order;
      this.confirmVisible = true;
    }
    this.cdr.detectChanges();
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
    this.renderChart();
  }

  onCancelDelete(): void {
    this.confirmOrderToDelete = null;
    this.confirmVisible = false;
    this.cdr.detectChanges();
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
      () => {}
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
      () => {}
    );
  }

  private handlePanelSave(event: PanelSaveEvent): void {
    if (event.mode === 'create') {
      this.store.addWorkOrder(event.data);
    } else if (event.mode === 'edit' && event.docId) {
      this.store.updateWorkOrder(event.docId, event.data);
    }
    this.renderChart();
  }

  openExport(): void {
    this.modalService.open(CsvExportComponent, { size: 'lg', centered: true });
  }

  /* ══════════════════════════════════════════════
     GLOBAL MOUSE EVENTS
     ══════════════════════════════════════════════ */

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.bar-ellipsis') && !target.closest('.ellipsis-dropdown')) {
      this.activeMenu = null;
      this.cdr.detectChanges();
    }
  }
}
