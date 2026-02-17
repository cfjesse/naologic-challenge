import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/work-order-timeline/work-order-timeline').then(
        (m) => m.WorkOrderTimelineComponent
      ),
  },
];
