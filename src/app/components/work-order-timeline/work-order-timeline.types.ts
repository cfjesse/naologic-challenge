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
