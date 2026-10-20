import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, RouterModule } from '@angular/router';
import { AuthService } from './services/auth';
import { ApiService } from './services/api';
import { ThemeService } from './services/theme.service';

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
  protected readonly themeService = inject(ThemeService);

  protected readonly isDarkMode = this.themeService.isDarkMode;
  protected readonly themeTitle = this.themeService.themeTitle;

  protected toggleTheme(): void {
    this.themeService.toggleTheme();
    this.api.updateSettings({ theme: this.themeService.theme() }).subscribe({
      error: (err) => console.error('Failed to sync theme to backend', err)
    });
  }
}

