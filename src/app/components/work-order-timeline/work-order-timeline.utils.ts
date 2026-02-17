import { DateTime } from 'luxon';
import { WorkOrderStatus, TimeScale } from '../../models/work-order.model';

/* ── Constants ── */
export const LEFT_PANEL_WIDTH = 280;
export const COLUMN_MIN_WIDTH = 106.25;

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
  return DateTime.fromJSDate(d).toFormat('yyyy-MM-dd');
}

/** Returns the Luxon duration unit matching the timescale */
function getScaleUnit(scale: TimeScale): 'days' | 'weeks' | 'months' {
  switch (scale) {
    case 'Day': return 'days';
    case 'Week': return 'weeks';
    case 'Month': return 'months';
  }
}

/** Floors a DateTime to the start of the timescale unit */
function floorToScale(dt: DateTime, scale: TimeScale): DateTime {
  switch (scale) {
    case 'Day': return dt.startOf('day');
    case 'Week': return dt.startOf('week');
    case 'Month': return dt.startOf('month');
  }
}

export function formatColumnLabel(date: Date, scale: TimeScale): string {
  const dt = DateTime.fromJSDate(date);
  switch (scale) {
    case 'Day': return dt.toFormat('MMM dd');
    case 'Week': {
      const endOfWeek = dt.plus({ days: 6 });
      return `${dt.toFormat('MMM dd')} – ${endOfWeek.toFormat('MMM dd')}`;
    }
    case 'Month': return dt.toFormat('MMM yyyy');
  }
}

export function isDateInCurrentPeriod(colDate: Date, now: Date, scale: TimeScale): boolean {
  const dtCol = DateTime.fromJSDate(colDate);
  const dtNow = DateTime.fromJSDate(now);
  switch (scale) {
    case 'Day':
      return dtCol.startOf('day').equals(dtNow.startOf('day'));
    case 'Week': {
      const weekStart = dtNow.startOf('week');
      const weekEnd = weekStart.plus({ weeks: 1 });
      return dtCol >= weekStart && dtCol < weekEnd;
    }
    case 'Month':
      return dtCol.startOf('month').equals(dtNow.startOf('month'));
  }
}

/**
 * Returns an object with floor and offset helpers for the given timescale.
 * Replaces the d3 TimeInterval interface.
 */
export function getInterval(scale: TimeScale) {
  const unit = getScaleUnit(scale);

  return {
    /** Floor a JS Date to the start of the timescale unit */
    floor(date: Date): Date {
      return floorToScale(DateTime.fromJSDate(date), scale).toJSDate();
    },
    /** Offset a JS Date by N timescale units */
    offset(date: Date, n: number): Date {
      return DateTime.fromJSDate(date).plus({ [unit]: n }).toJSDate();
    },
    /** Generate an array of JS Dates from start to end, one per timescale unit */
    range(start: Date, end: Date): Date[] {
      const dates: Date[] = [];
      let current = floorToScale(DateTime.fromJSDate(start), scale);
      const endDt = DateTime.fromJSDate(end);
      while (current < endDt) {
        dates.push(current.toJSDate());
        current = current.plus({ [unit]: 1 });
      }
      return dates;
    }
  };
}

/** Rounds a JS Date to the nearest day */
export function roundToDay(date: Date): Date {
  const dt = DateTime.fromJSDate(date);
  // If past noon, round up; otherwise round down
  return dt.hour >= 12
    ? dt.plus({ days: 1 }).startOf('day').toJSDate()
    : dt.startOf('day').toJSDate();
}

/* ── Deep Calculation Helpers ── */


/**
 * Calculates how many columns of `columnMinWidth` fit into one screen
 * of the right panel (screen width minus left panel).
 */
export function getColumnsPerScreen(): number {
  const rightPanelWidth = Math.max(window.innerWidth - LEFT_PANEL_WIDTH, 400);
  return Math.ceil(rightPanelWidth / COLUMN_MIN_WIDTH);
}

/**
 * Given a start date, timescale, and a total column count,
 * returns the end date that covers exactly that many timescale units.
 */
export function getEndDateForColumnCount(start: Date, scale: TimeScale, columnCount: number): Date {
  const interval = getInterval(scale);
  return interval.offset(interval.floor(start), columnCount);
}


/**
 * Calculates the initial viewport start date from work orders.
 * Starts at the earliest work order date, offset back by 1 timescale unit
 * (1 day for Day, 1 week for Week, 1 month for Month),
 * floored to the current timescale boundary.
 */
export function calculateInitialStart(orders: any[], scale: TimeScale): Date {
  const interval = getInterval(scale);

  if (orders.length === 0) {
    return interval.offset(interval.floor(new Date()), -1);
  }

  let minTime = Infinity;
  for (const order of orders) {
    const t = new Date(order.data.startDate).getTime();
    if (t < minTime) minTime = t;
  }

  const floored = interval.floor(new Date(minTime));
  return interval.offset(floored, -1);
}

export function calculateViewportRange(date: Date, scale: TimeScale): { start: Date, end: Date } {
  const interval = getInterval(scale);
  const columnsPerScreen = getColumnsPerScreen();
  const totalColumns = columnsPerScreen * 3;

  const halfColumns = Math.floor(totalColumns / 2);
  const start = interval.offset(interval.floor(date), -halfColumns);
  const end = interval.offset(start, totalColumns);

  return { start, end };
}
