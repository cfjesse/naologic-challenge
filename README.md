# Naologic ERP Work Order Timeline

An interactive timeline component for visualizing and managing work orders across multiple work centers. Built with **Angular 21** (standalone headers), **D3.js** for timeline logic, **@ng-select** for dropdowns, and **@ng-bootstrap** for date pickers.

## Features

- **Timeline Grid**: Zoomable view (Day, Week, Month) with dynamic column generation.
- **Interactive Bars**: Drag to move, resize handles to adjust duration.
- **CRUD Operations**:
  - **Create**: Click on an empty timeline area to open the slide-out panel.
  - **Read**: View orders across work centers with status visualization.
  - **Update**: Edit details via the 3-dot menu or resize/move bars directly.
  - **Delete**: Remove orders via the 3-dot menu (with confirmation dialog).
- **Validation**: Prevents work order overlaps on the same work center.
- **Data Persistence**: Saves changes to `localStorage` (bonus feature).
- **Responsive**: Adapts to screen size, optimized for desktop.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run dev server**:
   ```bash
   ng serve
   ```
   Navigate to `http://localhost:4200`.

## Architecture & Approach

### Component Structure
- `WorkOrderTimelineComponent`: The main orchestrator. Handles D3 timescale logic, viewport calculations, and drag-and-drop events.
- `WorkOrderPanelComponent`: A slide-out panel for Create/Edit forms. Uses **Reactive Forms** for validation (e.g., end date > start date).
- `WorkOrderService`: A centralized signal-based store for data management and business logic (like overlap detection).

### Key Decisions
- **Signals**: Used extensively for state management to ensure fine-grained reactivity and OnPush performance.
- **D3.js**: Chosen for robust time scale calculations (`d3.timeDay`, `d3.timeWeek`, etc.) rather than writing custom date math.
- **View Encapsulation**: Kept `Emulated` but used specific `::ng-deep` overrides for third-party libraries (`ng-select`) to match the Naologic design system.
- **UUIDs**: All data uses UUIDs for `docId` to ensure uniqueness, with a fallback generator if `crypto.randomUUID` is unavailable.

## Libraries

- **Angular 21**: Core framework.
- **D3.js**: Timeline math and scales.
- **@ng-select/ng-select**: Custom dropdowns matching the design.
- **@ng-bootstrap/ng-bootstrap**: Datepicker integration.
- **RxJS**: Reactive event handling.

## License

Private / Technical Assessment
