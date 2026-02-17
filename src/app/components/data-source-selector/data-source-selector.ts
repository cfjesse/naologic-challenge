import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { WorkOrderStore, DataSource } from '../../store/work-order.store';

@Component({
  selector: 'app-data-source-selector',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="selector-container">
      <header class="selector-header">
        <span class="brand">NAO<span class="brand-accent">LOGIC</span></span>
        <h1 class="page-title">Data Source Settings</h1>
        <p class="page-subtitle">Choose how you want to manage your work order data.</p>
      </header>

      <div class="cards-grid">
        <div 
          class="source-card" 
          [class.active]="store.dataSource() === 'local'"
          (click)="selectSource('local')"
        >
          <div class="card-icon local-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 8V21H3V8M1 3H23V8H1V3ZM10 12H14" />
            </svg>
          </div>
          <div class="card-content">
            <h3>Local Storage</h3>
            <p>Save data directly in your browser. Fast, offline-first, but restricted to this device.</p>
            <span class="status-badge" *ngIf="store.dataSource() === 'local'">ACTIVE</span>
          </div>
        </div>

        <div 
          class="source-card" 
          [class.active]="store.dataSource() === 'server'"
          (click)="selectSource('server')"
        >
          <div class="card-icon server-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12H19M5 12L11 6M5 12L11 18" transform="rotate(180 12 12)"/>
              <path d="M12 21V15M12 9V3" />
              <rect x="2" y="9" width="20" height="6" rx="1" />
            </svg>
          </div>
          <div class="card-content">
            <h3>Remote Server</h3>
            <p>Connect to the Naologic Cloud API. Sync data across devices and collaborate in real-time.</p>
            <span class="status-badge" *ngIf="store.dataSource() === 'server'">ACTIVE</span>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn-primary" routerLink="/">Go to Timeline</button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background-color: var(--bg-body);
      font-family: 'Circular Std', 'Inter', sans-serif;
      padding: 3rem 2rem;
    }

    .selector-container {
      max-width: 900px;
      margin: 0 auto;
    }

    .selector-header {
      text-align: center;
      margin-bottom: 4rem;
    }

    .brand {
      font-weight: 800;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
      color: var(--text-main);
      display: block;
      margin-bottom: 1rem;
    }

    .brand-accent {
      color: var(--primary-color);
    }

    .page-title {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--text-main);
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.03em;
    }

    .page-subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 2rem;
      margin-bottom: 4rem;
    }

    .source-card {
      background: white;
      border: 2px solid var(--border-color);
      border-radius: 1.25rem;
      padding: 2.5rem;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      position: relative;
    }

    .source-card:hover {
      transform: translateY(-8px);
      border-color: var(--primary-color);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.01);
    }

    .source-card.active {
      border-color: var(--primary-color);
      background-color: #f5f3ff; /* Very light primary alpha */
    }

    .card-icon {
      width: 64px;
      height: 64px;
      border-radius: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
      color: white;
    }

    .local-icon { background: linear-gradient(135deg, #6366f1, #4f46e5); }
    .server-icon { background: linear-gradient(135deg, #10b981, #059669); }

    .card-icon svg {
      width: 32px;
      height: 32px;
    }

    .card-content h3 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      color: var(--text-main);
    }

    .card-content p {
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 0;
    }

    .status-badge {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      background: var(--primary-color);
      color: white;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.75rem;
      border-radius: 2rem;
      letter-spacing: 0.05em;
    }

    .actions {
      display: flex;
      justify-content: center;
    }

    .btn-primary {
      background-color: var(--primary-color);
      color: white;
      border: none;
      padding: 1rem 2.5rem;
      font-size: 1.1rem;
      font-weight: 600;
      border-radius: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary:hover {
      background-color: #4338ca;
      transform: scale(1.02);
    }
  `]
})
export class DataSourceSelectorComponent {
  protected readonly store = inject(WorkOrderStore);
  private readonly router = inject(Router);

  selectSource(source: DataSource): void {
    this.store.setDataSource(source);
  }
}
