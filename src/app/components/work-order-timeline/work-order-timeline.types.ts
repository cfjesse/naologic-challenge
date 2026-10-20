/* ── UI Interfaces ── */
export interface ActiveMenu {
  orderId: string;
  x: number;
  y: number;
}

export interface TooltipState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
}

export interface DragAlertInfo {
  orderName: string;
  mode: 'move' | 'resize-left' | 'resize-right';
  startDateIso: string;
  endDateIso: string;
  startDateFormatted: string;
  endDateFormatted: string;
  durationDays: number;
  hasOverlap: boolean;
  overlapOrderName?: string;
}

export interface DragDateEvent {
  order: import('../../models/work-order.model').WorkOrderDocument;
  newStartDate: Date;
  newEndDate: Date;
  isoStartDate: string;
  isoEndDate: string;
  mode: 'move' | 'resize-left' | 'resize-right';
}
