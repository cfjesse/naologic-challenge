import { Component, signal, computed, inject } from '@angular/core';
import { RouterOutlet, RouterModule } from '@angular/router';
import { AuthService } from './services/auth';
import { ApiService } from './services/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('erp');
  protected readonly auth = inject(AuthService);
  protected readonly api = inject(ApiService);

  protected readonly isDarkMode = computed(() => this.api.currentTheme() === 'dark');
  protected readonly themeTitle = computed(() =>
    this.isDarkMode() ? 'Switch to Light Theme' : 'Switch to Dark Theme'
  );

  protected toggleTheme(): void {
    this.api.toggleTheme().subscribe({
      error: (err) => console.error('Failed to sync theme to backend', err)
    });
  }
}

