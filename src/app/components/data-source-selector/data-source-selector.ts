import { Component, inject } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { WorkOrderStore, DataSource } from '../../store/work-order.store';
import { ApiService } from '../../services/api';

@Component({
  selector: 'app-data-source-selector',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './data-source-selector.html',
  styleUrl: './data-source-selector.scss'
})
export class DataSourceSelectorComponent {
  protected readonly store = inject(WorkOrderStore);
  protected readonly api = inject(ApiService);
  private readonly router = inject(Router);

  selectSource(source: DataSource): void {
    this.store.setDataSource(source);
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.api.setTheme(theme).subscribe({
      error: (err) => console.error('Failed to sync theme preference', err)
    });
  }
}
