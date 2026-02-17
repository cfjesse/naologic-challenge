/* ── UI Interfaces ── */
export interface ColumnHeader {
  label: string;
  date: Date;
  isCurrent: boolean;
  left: number;
  width: number;
}

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
