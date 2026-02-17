import { Component, inject } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { WorkOrderStore, DataSource } from '../../store/work-order.store';

@Component({
  selector: 'app-data-source-selector',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './data-source-selector.html',
  styleUrl: './data-source-selector.scss'
})
export class DataSourceSelectorComponent {
  protected readonly store = inject(WorkOrderStore);
  private readonly router = inject(Router);

  selectSource(source: DataSource): void {
    this.store.setDataSource(source);
  }
}
