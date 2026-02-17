# Naologic ERP Work Order Timeline

An interactive timeline component for visualizing and managing work orders across multiple work centers. Built with **Angular 21** (using standalone architecture), **D3.js** for robust timeline visualization, **@ng-select** for dropdowns, and **@ng-bootstrap** for date interactions.

## Features

### Core Requirements (Completed)
- **Timeline Grid**: Zoomable view (Day, Week, Month) with dynamic column generation and responsive horizontal scrolling.
- **Work Order Bars**: Color-coded status indicators (Open, In Progress, Complete, Blocked) with accurate date positioning.
- **CRUD Operations**:
  - **Create**: Click-to-add functionality on empty timeline areas via a slide-out panel.
  - **Read**: Visual overview of all work orders across work centers.
  - **Update**: Edit details via context menu or directly dragging/resizing bars.
  - **Delete**: Remove orders via the context menu with confirmation.
- **Validation**: Strict overlap detection prevents scheduling conflicts on the same work center.
- **Responsive Design**: Adapts to screen sizes, optimized for desktop use.

### Bonus Features (Implemented)
- **Local Storage Persistence**: Data persists across page reloads (default "Local" mode).
- **Remote Server Integration**: Full backend integration with a Node.js server for data persistence and synchronization.
- **Smooth Animations**: 
  - Slide-in/out panels.
  - Staggered list animations for work order summaries.
  - Pulsing status indicators for a "live" feel.
- **Interactive Drag & Drop**: Makes scheduling changes intuitive.
- **Automated Tests**: Comprehensive unit tests for Stores, Components, and Services using **Vitest**.

## Setup

### Angular Frontend

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run dev server**:
   ```bash
   npm start
   ```
   Navigate to `http://localhost:4200`.

### Node.js Backend (Optional)

This provides the API for the "Remote Server" data source, allowing for data synchronization.

1. **Navigate to server directory**:
   ```bash
   cd server
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```
   The backend runs on `http://localhost:3000`. 
   
   **Note**: Use the "Settings" page in the application (via the Cog icon) to switch between "Local Storage" and "Remote Server" data sources.

## Architecture & Approach

### Component Structure
- **WorkOrderTimelineComponent**: The core orchestrator. Integrates D3.js for SVG rendering, handles timescale logic, viewport calculations, and user interactions (drag, resize, click).
- **WorkOrderPanelComponent**: A reusable slide-out panel for Create/Edit forms, leveraging **NgbOffcanvas** and **Reactive Forms** for robust validation.
- **DataSourceSelectorComponent**: A dedicated view for managing data persistence strategies (Local vs. Server).
- **ActiveOrdersCardComponent**: A dashboard widget displaying a summary of active work orders with animations.

### State Management
- **SignalStore (NGRX Signals)**: The application uses a centralized, signal-based store (`WorkOrderStore`) for:
  - Managing Work Orders and Work Centers.
  - Handling business logic like overlap detection.
  - Abstracting the data source (switching between LocalService and ApiService).
  - Ensuring fine-grained reactivity across components.

### Key Decisions
- **Angular 21 & Standalone**: Fully embraced modern Angular practices with standalone components and signals.
- **D3.js Integration**: Selected for its precision in handling time scales and SVG manipulation, offering cleaner control than pure HTML/CSS grids for this level of complexity.
- **View Encapsulation**: Used `ViewEncapsulation.None` selectively to allow global styles to penetrate D3-generated SVG elements while keeping component styles modular.
- **UUIDs**: All entities use UUIDs for robust unique identification.

## Libraries

- **Angular 21**: Core framework.
- **D3.js**: Visualization and Time Scales.
- **@ng-select/ng-select**: Custom dropdowns matching the design.
- **@ng-bootstrap/ng-bootstrap**: Datepickers and Modals.
- **RxJS**: Reactive streams.
- **Vitest**: Unit testing runner.

## License

Private / Technical Assessment
