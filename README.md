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
- **Responsive**: Adapts to screen size, optimized for desktop.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run dev server**:
   ```bash
   npm start
   ```
   Navigate to `http://localhost:4200`.

## Architecture & Approach

### Component Structure
- `WorkOrderTimelineComponent`: The main orchestrator. Handles D3 SVG rendering, timescale logic, viewport calculations, and drag-and-drop events.
- `WorkOrderPanelComponent`: A slide-out panel for Create/Edit forms, powered by **NgbOffcanvas**. Uses **Reactive Forms** for validation.
- `WorkOrderService` (Store): A centralized signal-based store for data management and business logic (overlap detection).

### Key Decisions
- **Signals**: Used for state management to ensure fine-grained reactivity.
- **D3.js**: Chosen for robust SVG rendering, time scale calculations, and drag behaviors.
- **View Encapsulation**: Set to `None` to allow component styles to apply to D3-generated SVG elements.
- **UUIDs**: All data uses UUIDs for `docId` to ensure uniqueness.

## Libraries

- **Angular 21**: Core framework.
- **D3.js**: Timeline math and scales.
- **@ng-select/ng-select**: Custom dropdowns matching the design.
- **@ng-bootstrap/ng-bootstrap**: Datepicker integration.
- **RxJS**: Reactive event handling.

## License

Private / Technical Assessment
