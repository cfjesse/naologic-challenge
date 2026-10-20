
// Naologic ERP - Work Order Timeline Component
import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
  HostListener,
  Output,
  EventEmitter,
  inject,
  effect,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgbOffcanvas, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CsvExportComponent } from '../csv-export/csv-export';
import { trigger, transition, style, animate } from '@angular/animations';
import * as d3 from 'd3';
import { DateTime } from 'luxon';

import * as Models from '../../models/work-order.model';
import { WorkOrderStore } from '../../store/work-order.store';
import {
  WorkOrderPanelComponent,
  PanelSaveEvent,
} from '../work-order-panel/work-order-panel';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { ActiveOrdersCardComponent } from '../active-orders-card/active-orders-card';
import { WorkOrderKanbanComponent } from '../work-order-kanban/work-order-kanban';
import { WorkOrderTableComponent } from '../work-order-table/work-order-table';

import {
  ActiveMenu,
  TooltipState,
  DragAlertInfo,
  DragDateEvent,
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
  order: Models.WorkOrderDocument;
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
    WorkOrderKanbanComponent,
    WorkOrderTableComponent,
  ],
  templateUrl: './work-order-timeline.html',
  styleUrl: './work-order-timeline.scss',
})
export class WorkOrderTimelineComponent implements OnInit, OnDestroy, AfterViewInit {
  private _refreshTrigger = false;
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly store = inject(WorkOrderStore);
  private readonly offcanvasService = inject(NgbOffcanvas);
  private readonly modalService = inject(NgbModal);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  /* ── Refs ── */
  @ViewChild('ganttSvg', { static: false }) ganttSvgRef!: ElementRef<SVGSVGElement>;
  @ViewChild('ganttWrapper', { static: false }) ganttWrapperRef!: ElementRef<HTMLDivElement>;
  @ViewChild('leftPanel', { static: false }) leftPanelRef?: ElementRef<HTMLDivElement>;

  /* ── Work Center Collapsible & Simplified Menu State ── */
  isWorkCenterCollapsed = false;
  activeCollapsedMenuWcId: string | null = null;

  /* ── Gantt Analytics Charts (Pure Reactive Signals) ── */
  showGanttCharts = true;

  readonly timelineOrders = computed(() => this.store.filteredWorkOrders());

  readonly timelineTotalOrders = computed(() => this.timelineOrders().length);

  readonly timelineTotalScheduledDays = computed(() => {
    return this.timelineOrders().reduce((sum, order) => {
      const start = DateTime.fromISO(order.data.startDate);
      const end = DateTime.fromISO(order.data.endDate);
      const diff = Math.max(1, Math.round(end.diff(start, 'days').days));
      return sum + diff;
    }, 0);
  });

  readonly timelineStatusBreakdown = computed(() => {
    const orders = this.timelineOrders();
    const total = orders.length;
    const colors: Record<Models.WorkOrderStatus, string> = {
      open: '#6366f1',
      'in-progress': '#0284c7',
      blocked: '#ef4444',
      complete: '#10b981',
    };
    const labels: Record<Models.WorkOrderStatus, string> = {
      open: 'Open',
      'in-progress': 'In Progress',
      blocked: 'Blocked',
      complete: 'Complete',
    };

    const circumference = 2 * Math.PI * 36;
    let accumulated = 0;

    return (['open', 'in-progress', 'blocked', 'complete'] as Models.WorkOrderStatus[]).map((status) => {
      const count = orders.filter((o) => o.data.status === status).length;
      const ratio = total > 0 ? count / total : 0;
      const percent = Math.round(ratio * 100);
      const dash = ratio * circumference;
      const space = circumference - dash;
      const offset = -(accumulated * circumference);
      accumulated += ratio;

      return {
        status,
        label: labels[status],
        count,
        percent,
        color: colors[status],
        strokeDasharray: `${dash.toFixed(2)} ${space.toFixed(2)}`,
        strokeDashoffset: Number(offset.toFixed(2)),
      };
    });
  });

  readonly timelineStationLoads = computed(() => {
    const centers = this.store.workCenters();
    const orders = this.timelineOrders();

    const loads = centers.map((wc) => {
      const wcOrders = orders.filter((o) => o.data.workCenterId === wc.docId);
      const days = wcOrders.reduce((sum, o) => {
        const start = DateTime.fromISO(o.data.startDate);
        const end = DateTime.fromISO(o.data.endDate);
        return sum + Math.max(1, Math.round(end.diff(start, 'days').days));
      }, 0);

      return {
        id: wc.docId,
        name: wc.data.name,
        count: wcOrders.length,
        days,
        percent: 0,
      };
    });

    const maxDays = Math.max(...loads.map((l) => l.days), 1);
    loads.forEach((l) => {
      l.percent = Math.round((l.days / maxDays) * 100);
    });

    return loads;
  });

  readonly timelineConflictsCount = computed(() => {
    const orders = this.store.workOrders();
    let conflicts = 0;
    for (let i = 0; i < orders.length; i++) {
      for (let j = i + 1; j < orders.length; j++) {
        if (orders[i].data.workCenterId === orders[j].data.workCenterId) {
          const s1 = new Date(orders[i].data.startDate).getTime();
          const e1 = new Date(orders[i].data.endDate).getTime();
          const s2 = new Date(orders[j].data.startDate).getTime();
          const e2 = new Date(orders[j].data.endDate).getTime();
          if (s1 < e2 && e1 > s2) {
            conflicts++;
          }
        }
      }
    }
    return conflicts;
  });

  readonly busiestStationName = computed(() => {
    const loads = this.timelineStationLoads();
    if (loads.length === 0) return 'None';
    const sorted = [...loads].sort((a, b) => b.days - a.days);
    return sorted[0].count > 0 ? `${sorted[0].name} (${sorted[0].days}d)` : 'None';
  });

  /* ── Data Actions Menu & Feedback ── */
  dataMenuOpen = false;
  dataToastMessage: string | null = null;
  private toastTimeout: any = null;

  toggleDataMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.dataMenuOpen = !this.dataMenuOpen;
  }

  onRefreshData(): void {
    this.dataMenuOpen = false;
    this.store.refreshData();
    this.showDataToast('Timeline and orders data refreshed');
    setTimeout(() => {
      this.initViewport();
      this.renderChart();
    }, 50);
  }

  onGenerateNewData(): void {
    this.dataMenuOpen = false;
    this.store.generateNewData();
    this.showDataToast('Generated fresh randomized work orders');
    setTimeout(() => {
      this.initViewport();
      this.renderChart();
    }, 50);
  }

  onResetToDefaults(): void {
    this.dataMenuOpen = false;
    this.store.resetToDefaults();
    this.showDataToast('Reset schedule to default baseline');
    setTimeout(() => {
      this.initViewport();
      this.renderChart();
    }, 50);
  }

  private showDataToast(message: string): void {
    this.dataToastMessage = message;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.dataToastMessage = null;
      this.cdr.detectChanges();
    }, 3200);
    this.cdr.detectChanges();
  }

  /* ── View Mode ── */
  currentView: 'timeline' | 'kanban' | 'table' = 'timeline';

  setView(view: 'timeline' | 'kanban' | 'table'): void {
    this.currentView = view;
    // Always refresh data from backend/storage when switching views
    this.store.refreshData();

    if (view === 'timeline') {
      setTimeout(() => {
        const svgEl = this.ganttSvgRef?.nativeElement;
        if (svgEl) {
          if (!this.svg || this.svg.node() !== svgEl) {
            d3.select(svgEl).selectAll('*').remove();
            this.initD3();
          }
          this.initViewport();
          this.renderChart();
          this.updateActiveOrders();
        }
      }, 30);
    }
    this.cdr.detectChanges();
  }

  /* ── Timescale ── */
  timeScale: Models.TimeScale = 'Day';
  timeScaleOptions: Models.TimeScale[] = ['Day', 'Week', 'Month'];

  /* ── Status Filter ── */
  statusFilterOptions: (Models.WorkOrderStatus | 'all')[] = ['all', 'open', 'in-progress', 'complete', 'blocked'];

  /* ── Date viewport ── */
  viewportStart = new Date();
  viewportEnd = new Date();
  cursorDate = new Date(); // To track the draggable cursor position

  activeOrders: Models.WorkOrderDocument[] = []; // Orders visible at cursor position
  cursorPeriodLabel = ''; // e.g. "October 2025" or "Week 42"

  /* ── Timeline Scroll Slider & Step Navigation ── */
  scrollStepDays = 7; // Default: 1 Week
  timelineScrollPercent = 0;
  sliderStepPercent = 0.5;
  visibleDateRange = { start: '', end: '' };

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
  private isDragging = false;
  private isCursorDragging = false;
  private ghostUpdateRequested = false;
  private readonly DRAG_THRESHOLD = 5;
  private redrawTimeout: any = null;
  private dragOffsetX = 0;

  /* ── Drag & Drop Output ── */
  @Output() readonly dragDate = new EventEmitter<DragDateEvent>();

  /* ── Drag Alert State ── */
  dragAlertInfo: DragAlertInfo | null = null;

  /* ── Add Work Center State ── */
  addWorkCenterVisible = false;
  newWorkCenterName = '';
  addWorkCenterError = '';

  /* ── Scrolling lock ── */
  private isExpandingViewport = false;

  /* ── UI state ── */
  activeMenu: ActiveMenu | null = null;
  confirmVisible = false;
  confirmOrderToDelete: Models.WorkOrderDocument | null = null;
  tooltip: TooltipState = { visible: false, text: '', x: 0, y: 0 };
  
  /* ── Pending Update State ── */
  confirmUpdateVisible = false;
  pendingUpdate: {
    order: Models.WorkOrderDocument;
    newStartIso: string;
    newEndIso: string;
  } | null = null;
  confirmUpdateMessage = '';

  /* ── Drag Preview (Ghost) ── */
  ghostBar = {
    visible: false,
    x: 0, y: 0, w: 0, h: 0,
    class: '',
    name: '',
    status: '' as Models.WorkOrderStatus,
    docId: '',
  };

  /* ══════════════════════════════════════════════
     LIFECYCLE
     ══════════════════════════════════════════════ */

  constructor() {
    // Redraw whenever store signals update
    effect(() => {
      this.store.workOrders();
      this.store.workCenters();
      this.store.statusFilter();
      this.requestRedraw();
    });

    // Reactive sync with settings resource signal
    effect(() => {
      const settings = typeof this.api.settingsSignal === 'function' ? this.api.settingsSignal() : null;
      if (settings?.timeScale && settings.timeScale !== this.timeScale) {
        this.timeScale = settings.timeScale;
        this.initViewport();
        if (this.svg) this.renderChart();
      }
    });
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      this.isWorkCenterCollapsed = true;
    }
    this.initViewport();
    // Populate dropdowns from API
    this.api.getTimescales().subscribe(scales => {
      if (scales && scales.length > 0) {
        this.timeScaleOptions = scales;
        this.cdr.detectChanges();
      }
    });
    this.api.getStatuses().subscribe(statuses => {
      if (statuses && statuses.length > 0) {
        this.statusFilterOptions = ['all', ...statuses.map(s => s.value)];
        this.cdr.detectChanges();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initD3();
    this.renderChart();
  }

  ngOnDestroy(): void {
    if (this.redrawTimeout) clearTimeout(this.redrawTimeout);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.ensureMinimumColumns();
    this.requestRedraw();
  }

  private requestRedraw(force = false): void {
    if (this.redrawTimeout) clearTimeout(this.redrawTimeout);
    
    // Smooth interaction: avoid full redraw if dragging a bar
    // BUT allow it if forced (e.g. cursor drag or high priority update)
    if (this.isDragging && !force) return;

    this.redrawTimeout = setTimeout(() => {
      if (this.svg) {
        this.renderChart();
      }
      this.redrawTimeout = null;
    }, force ? 16 : 60); 
  }

  private requestGhostUpdate(): void {
    if (this.ghostUpdateRequested) return;
    this.ghostUpdateRequested = true;
    requestAnimationFrame(() => {
      this.cdr.detectChanges();
      this.ghostUpdateRequested = false;
    });
  }

  /* ══════════════════════════════════════════════
     VIEWPORT
     ══════════════════════════════════════════════ */

  private initViewport(): void {
    const orders = this.store.filteredWorkOrders().length > 0 
      ? this.store.filteredWorkOrders() 
      : this.store.workOrders();
    const start = calculateInitialStart(orders, this.timeScale);
    this.viewportStart = start;
    this.viewportEnd = this.calculateMinimumEnd(start);
  }

  private calculateMinimumEnd(start: Date): Date {
    const leftWidth = this.isWorkCenterCollapsed ? 68 : 280;
    const columnsPerScreen = getColumnsPerScreen(leftWidth);
    const totalColumns = columnsPerScreen * 3;
    const interval = getInterval(this.timeScale);
    return interval.offset(interval.floor(start), totalColumns);
  }

  private ensureMinimumColumns(): void {
    const minimumEnd = this.calculateMinimumEnd(this.viewportStart);
    if (!this.viewportEnd || this.viewportEnd.getTime() < minimumEnd.getTime()) {
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

    const orders = this.store.filteredWorkOrders().length > 0 
      ? this.store.filteredWorkOrders() 
      : this.store.workOrders();
    const earliestStart = calculateInitialStart(orders, this.timeScale);

    if (!this.viewportStart || this.viewportStart.getTime() !== earliestStart.getTime()) {
      this.viewportStart = earliestStart;
      const minEnd = this.calculateMinimumEnd(earliestStart);
      if (!this.viewportEnd || this.viewportEnd.getTime() < minEnd.getTime()) {
        this.viewportEnd = minEnd;
      }
    }

    this.ensureMinimumColumns();

    const workCenters = this.store.workCenters();
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
    this.updateTimelineScrollSlider();
    
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — GRID
     ══════════════════════════════════════════════ */

  private renderGrid(
    workCenters: Models.WorkCenterDocument[],
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

    rows.join(
      enter => enter.append('rect')
        .attr('class', d => `row-bg${d.isEven ? ' even' : ''}`),
      update => update.attr('class', d => `row-bg${d.isEven ? ' even' : ''}`),
      exit => exit.remove()
    )
      .attr('id', d => `row-${d.workCenterId}`)
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

    const self = this;

    // ── Header background strip ──
    const strip = this.headerGroup.selectAll<SVGRectElement, number>('rect.header-strip')
      .data([1]);
    strip.join('rect')
      .attr('class', 'header-strip')
      .attr('x', 0).attr('y', 0)
      .attr('width', this.svgWidth)
      .attr('height', this.HEADER_HEIGHT)
      .style('cursor', 'pointer')
      .on('click', function (event: MouseEvent) {
        const [x] = d3.pointer(event, self.svg.node());
        self.cursorDate = self.xScale.invert(x);
        self.renderChart();
        self.cdr.detectChanges();
      });

    // ── Column header cells ──
    const headerCells = this.headerGroup
      .selectAll<SVGRectElement, (typeof headerData)[0]>('rect.header-cell')
      .data(headerData);

    headerCells.join('rect')
      .attr('class', d => `header-cell${d.isCurrent ? ' current-period' : ''}`)
      .attr('x', d => d.x)
      .attr('y', 0)
      .attr('width', d => d.w)
      .attr('height', this.HEADER_HEIGHT)
      .style('cursor', 'pointer')
      .on('click', function (event: MouseEvent, d) {
        const [x] = d3.pointer(event, self.svg.node());
        self.cursorDate = self.xScale.invert(x);
        self.renderChart();
        self.cdr.detectChanges();
      });

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
      .style('pointer-events', 'none')
      .text(d => d.label);

    // ── Header bottom border ──
    const border = this.headerGroup.selectAll<SVGLineElement, number>('line.header-border')
      .data([1]);
    border.join('line')
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
      .on('start', function(event) {
        self.isCursorDragging = true;
      })
      .on('drag', function (event) {
        let newX = event.x;
        newX = Math.max(0, Math.min(newX, self.svgWidth));
        d3.select(this).attr('transform', `translate(${newX}, 0)`);
        
        self.cursorDate = self.xScale.invert(newX);
        self.requestRedraw(true); 
      })
      .on('end', function() {
        self.isCursorDragging = false;
        self.renderChart();
      });

    // Cursor Group Container
    const cursor = this.cursorGroup
      .selectAll<SVGGElement, unknown>('g.cursor-container')
      .data([date]);

    const enter = cursor.enter().append('g')
      .attr('class', 'cursor-container')
      .call(drag)
      .style('cursor', 'ew-resize')
      .style('will-change', 'transform');

    // Line
    enter.append('line')
      .attr('class', 'cursor-line')
      .attr('y1', 0)
      .attr('y2', this.svgHeight);

    // Handle (Circle at top)
    enter.append('circle')
      .attr('class', 'cursor-handle')
      .attr('r', 5)
      .attr('cy', this.HEADER_HEIGHT / 2);

    // Merge update - skip transform if currently dragging (handled by .on('drag'))
    const merged = enter.merge(cursor);
    if (!this.isCursorDragging) {
      merged.attr('transform', `translate(${x}, 0)`);
    }

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

  /* ── Emit Drag Date & Real-time Info ── */
  private emitDragDate(
    order: Models.WorkOrderDocument,
    rawStart: Date,
    rawEnd: Date,
    mode: 'move' | 'resize-left' | 'resize-right',
    event: any
  ): void {
    let start = rawStart;
    let end = rawEnd;
    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    const roundedStart = roundToDay(start);
    const roundedEnd = roundToDay(end);
    const isoStart = toIso(roundedStart);
    const isoEnd = toIso(roundedEnd);

    const overlap = this.store.checkOverlap(
      order.data.workCenterId,
      isoStart,
      isoEnd,
      order.docId
    );

    const startFormatted = DateTime.fromJSDate(roundedStart).toFormat('MMM dd, yyyy');
    const endFormatted = DateTime.fromJSDate(roundedEnd).toFormat('MMM dd, yyyy');
    const durationDays = Math.max(
      1,
      Math.round((roundedEnd.getTime() - roundedStart.getTime()) / (1000 * 60 * 60 * 24))
    );

    this.dragAlertInfo = {
      orderName: order.data.name,
      mode,
      startDateIso: isoStart,
      endDateIso: isoEnd,
      startDateFormatted: startFormatted,
      endDateFormatted: endFormatted,
      durationDays,
      hasOverlap: !!overlap,
      overlapOrderName: overlap ? overlap.data.name : undefined,
    };

    const mouseEvent = event?.sourceEvent ?? event;
    const clientX = mouseEvent?.clientX ?? 0;
    const clientY = mouseEvent?.clientY ?? 0;

    this.tooltip = {
      visible: true,
      text: overlap
        ? `⚠️ Overlap with "${overlap.data.name}" (${DateTime.fromJSDate(roundedStart).toFormat('MMM dd')} – ${DateTime.fromJSDate(roundedEnd).toFormat('MMM dd')})`
        : `${mode === 'move' ? 'Moving to' : 'Resizing to'}: ${DateTime.fromJSDate(roundedStart).toFormat('MMM dd')} – ${endFormatted}`,
      x: clientX,
      y: clientY - 15,
    };

    this.dragDate.emit({
      order,
      newStartDate: roundedStart,
      newEndDate: roundedEnd,
      isoStartDate: isoStart,
      isoEndDate: isoEnd,
      mode,
    });

    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     D3 RENDERING — BARS
     ══════════════════════════════════════════════ */

  private renderBars(
    workCenters: Models.WorkCenterDocument[],
    orders: Models.WorkOrderDocument[]
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

    // Helper method for updating order dates - NOW SHOWS MODAL
    const updateOrderDates = (order: Models.WorkOrderDocument, newStart: Date, newEnd: Date) => {
      if (newStart < self.viewportStart) {
        newStart = self.viewportStart;
      }
      const newStartIso = toIso(roundToDay(newStart));
      const newEndIso = toIso(roundToDay(newEnd));
      
      const overlap = self.store.checkOverlap(
        order.data.workCenterId, newStartIso, newEndIso, order.docId
      );

      if (overlap) {
        self.ghostBar.visible = false;
        self.dragAlertInfo = null;
        self.renderChart(); // Revert visual drag
        return;
      }

      // If no change, just re-render to snap
      if (newStartIso === order.data.startDate && newEndIso === order.data.endDate) {
        self.ghostBar.visible = false;
        self.dragAlertInfo = null;
        self.renderChart();
        return;
      }

      // Snap ghost bar to the actual proposed dates for precision
      const finalStartDate = roundToDay(newStart);
      const finalEndDate = roundToDay(newEnd);
      self.ghostBar.x = self.xScale(finalStartDate);
      self.ghostBar.w = self.xScale(finalEndDate) - self.xScale(finalStartDate);
      self.ghostBar.visible = true; // Ensure it stays visible

      self.pendingUpdate = { order, newStartIso, newEndIso };
      self.confirmUpdateMessage = `Update dates to: ${newStartIso} — ${newEndIso}?`;
      self.confirmUpdateVisible = true;
      self.cdr.detectChanges();
    };

    // ── Bar drag behavior (move) ──
    const barDrag = d3.drag<SVGGElement, BarDatum>()
      .filter(() => self.auth.isAdmin())
      .on('start', function (event, d) {
        event.sourceEvent.stopPropagation();
        event.sourceEvent.preventDefault();
        self.didDrag = true;
        self.isDragging = true;
        self.dragOffsetX = event.x - d.x; 

        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);
        d3.select(this).classed('dragging', true);
      })
      .on('drag', function (event, d) {
        if (!self._dragOrigStart || !self._dragOrigEnd) return;
        d.x = Math.max(0, event.x - self.dragOffsetX);
        d3.select(this).attr('transform', `translate(${d.x}, ${d.y})`);

        if (event.sourceEvent) {
          self.handleDragAutoScroll(event.sourceEvent.clientX);
        }

        const currentX = d.x;
        const newStart = self.xScale.invert(currentX);
        const duration = self._dragOrigEnd.getTime() - self._dragOrigStart.getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        self.emitDragDate(d.order, newStart, newEnd, 'move', event);
      })
      .on('end', function (event, d) {
        d3.select(this).classed('dragging', false);
        self.isDragging = false;
        self.tooltip.visible = false;
        self.cdr.detectChanges();

        if (!self._dragOrigStart || !self._dragOrigEnd) {
          self.dragAlertInfo = null;
          return;
        }
        
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
        self.isDragging = true;
        self.dragOffsetX = event.x - d.x;
        
        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);

        self.ghostBar = {
          visible: true,
          x: d.x, y: d.y, w: d.w, h: d.h,
          name: d.order.data.name,
          status: d.order.data.status,
          docId: d.order.docId,
          class: `ghost-bar preview-${d.order.data.status}`,
        };
        // Hide original during resize
        d3.select(this.parentNode as any).style('opacity', 0);
        self.cdr.detectChanges();
      })
      .on('drag', function (event, d) {
        const proposedX = Math.max(0, event.x - self.dragOffsetX);
        const dx = proposedX - d.x;
        
        self.ghostBar.x = proposedX;
        self.ghostBar.w = Math.max(d.w - dx, 2);
        self.requestGhostUpdate();

        if (event.sourceEvent) {
          self.handleDragAutoScroll(event.sourceEvent.clientX);
        }

        const newStart = self.xScale.invert(proposedX);
        self.emitDragDate(d.order, newStart, self._dragOrigEnd!, 'resize-left', event);
      })
      .on('end', function (event, d) {
        self.isDragging = false;
        self.tooltip.visible = false;
        const finalGhostX = self.ghostBar.x;
        const finalGhostW = self.ghostBar.w;
        
        self.ghostBar.visible = true; // KEEP VISIBLE until confirmation
        const group = d3.select(this.parentNode as any);
        group.style('opacity', 0.4); // Dim original while previewing
        self.cdr.detectChanges();

        if (!self._dragOrigStart || !self._dragOrigEnd) {
          self.dragAlertInfo = null;
          return;
        }
        const newStart = self.xScale.invert(finalGhostX);
        if (newStart < self._dragOrigEnd!) {
           updateOrderDates(d.order, newStart, self._dragOrigEnd!);
        } else {
           self.dragAlertInfo = null;
           self.renderChart();
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
        self.isDragging = true;
        self.dragOffsetX = event.x - (d.x + d.w);
        
        self._dragOrigStart = new Date(d.order.data.startDate);
        self._dragOrigEnd = new Date(d.order.data.endDate);

        self.ghostBar = {
          visible: true,
          x: d.x, y: d.y, w: d.w, h: d.h,
          name: d.order.data.name,
          status: d.order.data.status,
          docId: d.order.docId,
          class: `ghost-bar preview-${d.order.data.status}`,
        };
        // Hide original during resize
        d3.select(this.parentNode as any).style('opacity', 0);
        self.cdr.detectChanges();
      })
      .on('drag', function (event, d) {
        const proposedEndX = event.x - self.dragOffsetX;
        self.ghostBar.w = Math.max(proposedEndX - d.x, 2);
        self.requestGhostUpdate();

        if (event.sourceEvent) {
          self.handleDragAutoScroll(event.sourceEvent.clientX);
        }

        const newEnd = self.xScale.invert(proposedEndX);
        self.emitDragDate(d.order, self._dragOrigStart!, newEnd, 'resize-right', event);
      })
      .on('end', function (event, d) {
        self.isDragging = false;
        self.tooltip.visible = false;
        const finalGhostW = self.ghostBar.w;
        
        self.ghostBar.visible = true; // KEEP VISIBLE until confirmation
        const group = d3.select(this.parentNode as any);
        group.style('opacity', 0.4); // Dim original while previewing
        self.cdr.detectChanges();

        if (!self._dragOrigStart || !self._dragOrigEnd) {
          self.dragAlertInfo = null;
          return;
        }
        const newEnd = self.xScale.invert(d.x + finalGhostW);
        if (newEnd > self._dragOrigStart!) {
            updateOrderDates(d.order, self._dragOrigStart!, newEnd);
        } else {
            self.dragAlertInfo = null;
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

    // Left resize handle overlay
    enter.append('rect').attr('class', 'resize-handle resize-left')
      .call(resizeLeftDrag);

    // Right resize handle overlay
    enter.append('rect').attr('class', 'resize-handle resize-right')
      .call(resizeRightDrag);

    // Grip decorations (visual only)
    const leftGrip = enter.append('g').attr('class', 'grip-group grip-left');
    leftGrip.append('rect').attr('class', 'grip-bg').attr('rx', 2);
    leftGrip.append('line').attr('class', 'grip-line').attr('x1', 3).attr('x2', 3);
    leftGrip.append('line').attr('class', 'grip-line').attr('x1', 5).attr('x2', 5);

    const rightGrip = enter.append('g').attr('class', 'grip-group grip-right');
    rightGrip.append('rect').attr('class', 'grip-bg').attr('rx', 2);
    rightGrip.append('line').attr('class', 'grip-line').attr('x1', -3).attr('x2', -3);
    rightGrip.append('line').attr('class', 'grip-line').attr('x1', -5).attr('x2', -5);

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
    merged.attr('transform', d => `translate(${d.x}, ${d.y})`)
          .style('opacity', 1); // Restore visibility/opacity after interactions
    
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
      .attr('x', -5).attr('y', 0)
      .attr('width', 15).attr('height', d => d.h)
      .style('display', () => this.auth.isAdmin() ? 'block' : 'none');

    merged.select<SVGRectElement>('rect.resize-right')
      .attr('x', d => Math.max(d.w - 10, 0)).attr('y', 0)
      .attr('width', 15).attr('height', d => d.h)
      .style('display', () => this.auth.isAdmin() ? 'block' : 'none');

    // Update grips
    merged.select('g.grip-left').style('display', () => this.auth.isAdmin() ? 'block' : 'none');
    merged.select('g.grip-left rect')
      .attr('x', 1)
      .attr('y', 8)
      .attr('width', 7)
      .attr('height', d => d.h - 16);
    merged.select('g.grip-left line.grip-line:nth-child(2)')
      .attr('y1', 12).attr('y2', d => d.h - 12);
    merged.select('g.grip-left line.grip-line:nth-child(3)')
      .attr('y1', 12).attr('y2', d => d.h - 12);

    merged.select('g.grip-right').style('display', () => this.auth.isAdmin() ? 'block' : 'none');
    merged.select('g.grip-right').attr('transform', d => `translate(${d.w}, 0)`);
    merged.select('g.grip-right rect')
      .attr('x', -8)
      .attr('y', 8)
      .attr('width', 7)
      .attr('height', d => d.h - 16);
    merged.select('g.grip-right line.grip-line:nth-child(2)')
      .attr('y1', 12).attr('y2', d => d.h - 12);
    merged.select('g.grip-right line.grip-line:nth-child(3)')
      .attr('y1', 12).attr('y2', d => d.h - 12);

    // Update title
    merged.select<SVGTextElement>('text.bar-title')
      .attr('x', 18)
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
    const edgeSize = 140;
    const scrollSpeed = 22;

    // Right edge autoscroll
    if (clientX >= rect.right - edgeSize) {
      const factor = Math.min(1, Math.max(0.2, (clientX - (rect.right - edgeSize)) / edgeSize));
      wrapper.scrollLeft += Math.round(scrollSpeed * factor);
      this.checkInfiniteScroll();
    } 
    // Left edge autoscroll
    else if (clientX <= rect.left + edgeSize && clientX >= rect.left) {
      const factor = Math.min(1, Math.max(0.2, ((rect.left + edgeSize) - clientX) / edgeSize));
      wrapper.scrollLeft -= Math.round(scrollSpeed * factor);
      this.checkInfiniteScroll();
    }
  }

  /* ══════════════════════════════════════════════
     USER ACTIONS — DROPDOWNS, NAVIGATION
     ══════════════════════════════════════════════ */

  onStatusFilterChange(status: Models.WorkOrderStatus | 'all'): void {
    this.store.setStatusFilter(status);
    this.renderChart();
  }

  onTimeScaleChange(scale: Models.TimeScale): void {
    this.timeScale = scale;
    this.api.updateSettings({ timeScale: scale }).subscribe();
    this.initViewport();
    this.renderChart();
    setTimeout(() => {
      this.scrollToDate(this.cursorDate || new Date());
    }, 50);
  }

  centerViewportOnToday(): void {
    const now = new Date();
    this.cursorDate = now; // Reset cursor to Now
    const interval = getInterval(this.timeScale);
    const columnsPerScreen = getColumnsPerScreen();

    // The timeline starts at the earliest date in the available work orders
    const orders = this.store.filteredWorkOrders().length > 0 
      ? this.store.filteredWorkOrders() 
      : this.store.workOrders();
    const earliestStart = calculateInitialStart(orders, this.timeScale);
    this.viewportStart = earliestStart;

    // Ensure viewportEnd extends to include today if today is after viewportEnd
    const minimumEnd = this.calculateMinimumEnd(earliestStart);
    const nowEnd = interval.offset(interval.floor(now), columnsPerScreen);
    this.viewportEnd = new Date(Math.max(minimumEnd.getTime(), nowEnd.getTime()));

    this.renderChart();
    this.updateActiveOrders();

    // Scroll to center on today
    setTimeout(() => {
      this.scrollToDate(now);
    }, 0);
  }

  /* ══════════════════════════════════════════════
     SCROLLING & INFINITE SCROLL
     ══════════════════════════════════════════════ */

  onLeftPanelScroll(): void {
    if (this.leftPanelRef?.nativeElement && this.ganttWrapperRef?.nativeElement) {
      this.ganttWrapperRef.nativeElement.scrollTop = this.leftPanelRef.nativeElement.scrollTop;
    }
  }

  onGanttScroll(): void {
    if (this.leftPanelRef?.nativeElement && this.ganttWrapperRef?.nativeElement) {
      this.leftPanelRef.nativeElement.scrollTop = this.ganttWrapperRef.nativeElement.scrollTop;
    }
    this.updateTimelineScrollSlider();
    this.checkInfiniteScroll();
  }

  /* ── Timeline Navigation & Scrubber Methods ── */
  getScrollStepPixels(): number {
    if (!this.xScale || !this.viewportStart) return this.COLUMN_MIN_WIDTH;
    const d1 = this.viewportStart;
    const d2 = DateTime.fromJSDate(d1).plus({ days: this.scrollStepDays }).toJSDate();
    const px = Math.abs(this.xScale(d2) - this.xScale(d1));
    return Math.max(10, px);
  }

  updateSliderStep(): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    if (maxScroll > 0) {
      const stepPx = this.getScrollStepPixels();
      this.sliderStepPercent = Math.max(0.01, Math.min(50, (stepPx / maxScroll) * 100));
    } else {
      this.sliderStepPercent = 0.5;
    }
    this.cdr.markForCheck();
  }

  setScrollStep(days: number): void {
    this.scrollStepDays = Math.max(1, Math.min(180, days));
    this.updateSliderStep();
    // Execute scroll forward by this selected amount
    this.scrollTimeline(1);
  }

  onCustomStepChange(val: number): void {
    if (val && !isNaN(val) && val >= 1) {
      this.scrollStepDays = Math.max(1, Math.min(180, val));
      this.updateSliderStep();
    }
  }

  applyCustomStep(): void {
    if (this.scrollStepDays >= 1) {
      this.updateSliderStep();
      this.scrollTimeline(1);
    }
  }

  getStepLabel(): string {
    if (this.scrollStepDays === 7) return '1 Week';
    if (this.scrollStepDays === 1) return '1 Day';
    if (this.scrollStepDays === 14) return '2 Weeks';
    if (this.scrollStepDays === 30) return '1 Month';
    return `${this.scrollStepDays} Days`;
  }

  scrollTimeline(direction: -1 | 1): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper || !this.xScale) return;

    const pixelDistance = this.getScrollStepPixels();
    const delta = pixelDistance * direction;
    let targetScroll = Math.max(0, wrapper.scrollLeft + delta);

    // Expand viewport if nearing the right edge buffer
    const buffer = this.COLUMN_MIN_WIDTH * 2;
    if (direction === 1 && targetScroll + wrapper.clientWidth >= wrapper.scrollWidth - buffer) {
      const interval = getInterval(this.timeScale);
      const columnsPerScreen = getColumnsPerScreen();
      const expandColumns = Math.max(columnsPerScreen, Math.ceil(this.scrollStepDays / 7) * 2);
      this.viewportEnd = interval.offset(this.viewportEnd, expandColumns);
      this.renderChart();
    }

    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    targetScroll = Math.max(0, Math.min(maxScroll > 0 ? maxScroll : targetScroll, targetScroll));

    // Smoothly scroll container to the target position
    wrapper.scrollTo({ left: targetScroll, behavior: 'smooth' });

    // Update slider drag percent immediately for instant UI responsiveness
    if (maxScroll > 0) {
      this.timelineScrollPercent = Math.min(100, Math.max(0, (targetScroll / maxScroll) * 100));
    }
    this.updateVisibleDateRange(targetScroll);
    this.checkInfiniteScroll();
    this.cdr.markForCheck();
  }

  onSliderInput(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.timelineScrollPercent = val;
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    if (maxScroll > 0) {
      const rawScroll = (val / 100) * maxScroll;
      const stepPx = this.getScrollStepPixels();
      // Snap drag scroll to exact step increments matching scrollStepDays
      const snappedScroll = Math.round(rawScroll / stepPx) * stepPx;
      const boundedScroll = Math.max(0, Math.min(maxScroll, snappedScroll));
      wrapper.scrollLeft = boundedScroll;
      this.updateVisibleDateRange(boundedScroll);
      this.checkInfiniteScroll();
    }
  }

  updateTimelineScrollSlider(): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    if (maxScroll > 0) {
      this.timelineScrollPercent = Math.min(100, Math.max(0, (wrapper.scrollLeft / maxScroll) * 100));
    } else {
      this.timelineScrollPercent = 0;
    }
    this.updateSliderStep();
    this.updateVisibleDateRange();
  }

  private updateVisibleDateRange(customLeft?: number): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper || !this.xScale) return;

    const leftX = customLeft !== undefined ? customLeft : wrapper.scrollLeft;
    const rightX = leftX + wrapper.clientWidth;

    try {
      const startDate = this.xScale.invert(leftX);
      const endDate = this.xScale.invert(rightX);

      const format = (d: Date) => {
        const dt = DateTime.fromJSDate(d);
        return dt.toFormat('MMM d, yyyy');
      };

      this.visibleDateRange = {
        start: format(startDate),
        end: format(endDate)
      };
      this.cdr.markForCheck();
    } catch (e) {}
  }

  onGanttWheel(event: WheelEvent): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;

    // Map vertical mouse wheel scrolling into horizontal timeline panning
    if (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      wrapper.scrollLeft += event.deltaY;
      event.preventDefault();
      this.checkInfiniteScroll();
    }
  }

  private scrollToDate(date: Date): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper) return;
    if (!this.xScale) return;

    const xPos = this.xScale(date);
    const scrollTarget = xPos - wrapper.clientWidth / 2;

    wrapper.scrollTo({
      left: Math.max(0, scrollTarget),
      behavior: 'smooth'
    });
  }

  private checkInfiniteScroll(): void {
    const wrapper = this.ganttWrapperRef?.nativeElement;
    if (!wrapper || this.isExpandingViewport) return;

    const { scrollLeft, scrollWidth, clientWidth } = wrapper;
    const buffer = this.COLUMN_MIN_WIDTH * 2;

    // Infinite scroll LEFT (Past dates) is disabled:
    // the timeline starts at the earliest date in the available work orders
    // and cannot scroll to the left beyond that earliest date.

    // Infinite scroll RIGHT (Future dates)
    if (scrollLeft + clientWidth >= scrollWidth - buffer) {
      this.isExpandingViewport = true;
      const interval = getInterval(this.timeScale);
      const columnsPerScreen = getColumnsPerScreen();
      this.viewportEnd = interval.offset(this.viewportEnd, columnsPerScreen);
      this.renderChart();
      requestAnimationFrame(() => {
        this.isExpandingViewport = false;
      });
    }
  }

  /* ══════════════════════════════════════════════
     STATUS HELPERS
     ══════════════════════════════════════════════ */

  /* ── Status Helpers ── */
  getStatusLabel(status: Models.WorkOrderStatus): string {
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

  onEllipsisClick(event: MouseEvent, order: Models.WorkOrderDocument): void {
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
      (o: Models.WorkOrderDocument) => o.docId === this.activeMenu!.orderId
    );
    this.activeMenu = null;
    this.cdr.detectChanges();
    if (order) this.openEditPanel(order);
  }

  onMenuDelete(): void {
    if (!this.activeMenu) return;
    const order = this.store.filteredWorkOrders().find(
      (o: Models.WorkOrderDocument) => o.docId === this.activeMenu!.orderId
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
    this.cdr.detectChanges();
  }

  onCancelDelete(): void {
    this.confirmOrderToDelete = null;
    this.confirmVisible = false;
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     CONFIRM UPDATE HANDLERS
     ══════════════════════════════════════════════ */

  onConfirmUpdate(): void {
    if (this.pendingUpdate) {
      const { order, newStartIso, newEndIso } = this.pendingUpdate;
      this.store.updateWorkOrder(order.docId, {
        ...order.data,
        startDate: newStartIso,
        endDate: newEndIso,
      });
    }
    this.ghostBar.visible = false;
    this.pendingUpdate = null;
    this.confirmUpdateVisible = false;
    this.dragAlertInfo = null;
    this.renderChart();
    this.cdr.detectChanges();
  }

  onCancelUpdate(): void {
    this.ghostBar.visible = false;
    this.pendingUpdate = null;
    this.confirmUpdateVisible = false;
    this.dragAlertInfo = null;
    this.renderChart(); // Revert visual drag
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     WORK CENTER OPERATIONS
     ══════════════════════════════════════════════ */

  openAddWorkCenter(): void {
    this.newWorkCenterName = '';
    this.addWorkCenterError = '';
    this.addWorkCenterVisible = true;
    this.cdr.detectChanges();
  }

  cancelAddWorkCenter(): void {
    this.addWorkCenterVisible = false;
    this.newWorkCenterName = '';
    this.addWorkCenterError = '';
    this.cdr.detectChanges();
  }

  onAddWorkCenterOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-overlay')) {
      this.cancelAddWorkCenter();
    }
  }

  confirmAddWorkCenter(): void {
    const trimmed = this.newWorkCenterName.trim();
    if (!trimmed) {
      this.addWorkCenterError = 'Work center name is required.';
      this.cdr.detectChanges();
      return;
    }

    const exists = this.store.workCenters().some(
      (wc) => wc.data.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      this.addWorkCenterError = 'A work center with this name already exists.';
      this.cdr.detectChanges();
      return;
    }

    this.store.addWorkCenter(trimmed);
    this.addWorkCenterVisible = false;
    this.newWorkCenterName = '';
    this.addWorkCenterError = '';
    this.renderChart();
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     PANEL OPERATIONS (Offcanvas)
     ══════════════════════════════════════════════ */

  openCreatePanelDefault(): void {
    const workCenters = this.store.workCenters();
    const defaultWcId = workCenters.length > 0 ? workCenters[0].docId : '';
    if (!defaultWcId) {
      this.openAddWorkCenter();
      return;
    }
    this.openCreatePanel(defaultWcId, this.cursorDate || new Date());
  }

  openCreatePanel(workCenterId: string, startDate: Date): void {
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

  onKanbanEdit(order: Models.WorkOrderDocument): void {
    this.openEditPanel(order);
  }

  onKanbanDelete(order: Models.WorkOrderDocument): void {
    this.confirmOrderToDelete = order;
    this.confirmVisible = true;
    this.cdr.detectChanges();
  }

  onKanbanCreate(event: { workCenterId: string; status?: Models.WorkOrderStatus }): void {
    this.openCreatePanel(event.workCenterId, this.cursorDate || new Date());
  }

  private openEditPanel(order: Models.WorkOrderDocument): void {
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
    }
    if (!target.closest('.data-menu-container')) {
      this.dataMenuOpen = false;
    }
    if (!target.closest('.collapsed-wc-cell') && !target.closest('.simplified-wc-menu')) {
      this.activeCollapsedMenuWcId = null;
    }
    this.cdr.detectChanges();
  }

  /* ══════════════════════════════════════════════
     COLLAPSIBLE WORK CENTERS & SIMPLIFIED MENU
     ══════════════════════════════════════════════ */

  toggleWorkCenterCollapse(): void {
    this.isWorkCenterCollapsed = !this.isWorkCenterCollapsed;
    this.activeCollapsedMenuWcId = null;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.ensureMinimumColumns();
      this.renderChart();
      this.scrollToDate(this.cursorDate || new Date());
    }, 280);
  }

  toggleCollapsedMenu(wcId: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.activeCollapsedMenuWcId === wcId) {
      this.activeCollapsedMenuWcId = null;
    } else {
      this.activeCollapsedMenuWcId = wcId;
    }
    this.cdr.detectChanges();
  }

  closeCollapsedMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.activeCollapsedMenuWcId = null;
    this.cdr.detectChanges();
  }

  getWcInitials(name: string): string {
    if (!name) return 'WC';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getWcColorClass(wcId: string): string {
    const map: Record<string, string> = {
      'wc-1': 'color-station-1',
      'wc-2': 'color-station-2',
      'wc-3': 'color-station-3',
      'wc-4': 'color-station-4',
      'wc-5': 'color-station-5',
    };
    return map[wcId] || 'color-station-default';
  }

  getStationOrderCount(wcId: string): number {
    return this.store.workOrders().filter(o => o.data.workCenterId === wcId).length;
  }

  filterByStation(wcId: string): void {
    const orders = this.store.workOrders().filter(o => o.data.workCenterId === wcId);
    if (orders.length > 0) {
      const dates = orders.map(o => new Date(o.data.startDate).getTime());
      const minDate = new Date(Math.min(...dates));
      this.cursorDate = minDate;
      this.scrollToDate(minDate);
      this.renderChart();
    }
  }

  deleteStation(wc: Models.WorkCenterDocument): void {
    this.store.deleteWorkCenter(wc.docId);
    this.renderChart();
    this.cdr.detectChanges();
  }
}
