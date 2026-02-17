import * as d3 from 'd3';
import { WorkOrderStatus, TimeScale } from '../../models/work-order.model';

import { ColumnHeader, ActiveMenu, TooltipState } from './work-order-timeline.types';

/* ── Status Helpers ── */
export function getStatusLabel(status: WorkOrderStatus): string {
  switch (status) {
    case 'open': return 'Open';
    case 'in-progress': return 'In Progress';
    case 'complete': return 'Complete';
    case 'blocked': return 'Blocked';
  }
}

export function getBarClass(status: WorkOrderStatus): string {
  switch (status) {
    case 'complete': return 'bar-complete';
    case 'in-progress': return 'bar-in-progress';
    case 'open': return 'bar-open';
    case 'blocked': return 'bar-blocked';
  }
}

export function getStatusClass(status: WorkOrderStatus): string {
  switch (status) {
    case 'complete': return 'status-complete';
    case 'in-progress': return 'status-in-progress';
    case 'open': return 'status-open';
    case 'blocked': return 'status-blocked';
  }
}

/* ── Date & Format Helpers ── */
export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatColumnLabel(date: Date, scale: TimeScale): string {
  switch (scale) {
    case 'Day': return d3.timeFormat('%b %d')(date);
    case 'Week': {
      const endOfWeek = d3.timeDay.offset(date, 6);
      return `${d3.timeFormat('%b %d')(date)} – ${d3.timeFormat('%b %d')(endOfWeek)}`;
    }
    case 'Month': return d3.timeFormat('%b %Y')(date);
  }
}

export function isDateInCurrentPeriod(colDate: Date, now: Date, scale: TimeScale): boolean {
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

/* ── Deep Calculation Helpers ── */

export function calculateBarLeft(order: any, viewportStartMs: number, totalSpanMs: number): number {
  if (totalSpanMs <= 0) return 0;
  return ((new Date(order.data.startDate).getTime() - viewportStartMs) / totalSpanMs) * 100;
}

export function calculateBarWidth(order: any, totalSpanMs: number): number {
  if (totalSpanMs <= 0) return 0;
  return (
    ((new Date(order.data.endDate).getTime() -
      new Date(order.data.startDate).getTime()) /
      totalSpanMs) *
    100
  );
}

export function calculateCursorPositionPercent(cursorDate: Date | null, viewportStart: Date, viewportEnd: Date): number {
  if (!cursorDate) return -10;
  const start = viewportStart.getTime();
  const end = viewportEnd.getTime();
  const current = cursorDate.getTime();
  const total = end - start;
  if (total <= 0) return 0;
  return ((current - start) / total) * 100;
}

export function calculateColumns(scale: TimeScale, start: Date, end: Date, now: Date): ColumnHeader[] {
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return [];

  let interval: d3.TimeInterval;
  switch (scale) {
    case 'Day': interval = d3.timeDay; break;
    case 'Week': interval = d3.timeWeek; break;
    case 'Month': interval = d3.timeMonth; break;
  }

  const ticks = interval.range(interval.floor(start), interval.ceil(end));
  
  return ticks.map((tickDate) => {
    const colStart = tickDate.getTime();
    const colEnd = interval.offset(tickDate, 1).getTime();
    
    const renderStart = Math.max(start.getTime(), colStart);
    const renderEnd = Math.min(end.getTime(), colEnd);
    
    const width = ((renderEnd - renderStart) / totalMs) * 100;
    const left = ((renderStart - start.getTime()) / totalMs) * 100;

    return {
      label: formatColumnLabel(tickDate, scale),
      date: new Date(tickDate),
      isCurrent: isDateInCurrentPeriod(tickDate, now, scale),
      left,
      width
    };
  }).filter(col => col.width > 0);
}

export function calculateFitToData(orders: any[], scale: TimeScale): { start: Date | null, end: Date | null } {
  if (orders.length === 0) return { start: null, end: null };

  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const order of orders) {
    const startTime = new Date(order.data.startDate).getTime();
    const endTime = new Date(order.data.endDate).getTime();
    if (startTime < minTime) minTime = startTime;
    if (endTime > maxTime) maxTime = endTime;
  }

  let start: Date;
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

  const minDurationMs = 30 * 24 * 60 * 60 * 1000;
  const durationMs = Math.max(maxTime - start.getTime() + (7 * 24 * 60 * 60 * 1000), minDurationMs);
  
  return {
    start,
    end: new Date(start.getTime() + durationMs)
  };
}

export function calculateViewportRange(date: Date, scale: TimeScale): { start: Date, end: Date } {
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

  let flooredStart: Date;
  let ceiledEnd: Date;
  
  switch (scale) {
    case 'Day':
      flooredStart = d3.timeDay.floor(start);
      ceiledEnd = d3.timeDay.ceil(end);
      break;
    case 'Week':
      flooredStart = d3.timeWeek.floor(start);
      ceiledEnd = d3.timeWeek.ceil(end);
      break;
    case 'Month':
      flooredStart = d3.timeMonth.floor(start);
      ceiledEnd = d3.timeMonth.ceil(end);
      break;
  }

  return { start: flooredStart, end: ceiledEnd };
}
