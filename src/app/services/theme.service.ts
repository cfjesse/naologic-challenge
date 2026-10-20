import { Injectable, signal, computed, effect } from '@angular/core';

export type AppTheme = 'light' | 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly STORAGE_KEY = 'theme';
  private readonly SETTINGS_STORAGE_KEY = 'naologic_erp_settings';

  /**
   * Primary Angular Signal for the application theme.
   * Defaults to 'dark' and restores from sessionStorage if available.
   */
  readonly theme = signal<AppTheme>(this.readInitialTheme());

  /**
   * Computed boolean signal indicating whether dark mode is currently active.
   */
  readonly isDarkMode = computed(() => this.theme() === 'dark');

  /**
   * Computed title for theme toggle accessibility and tooltips.
   */
  readonly themeTitle = computed(() =>
    this.isDarkMode() ? 'Switch to Light Theme' : 'Switch to Dark Theme'
  );

  constructor() {
    // Apply theme immediately to DOM on service instantiation
    this.applyThemeToDom(this.theme());

    // Angular Signal Effect: Reactively synchronizes DOM attributes and storage on any change
    effect(() => {
      const currentTheme = this.theme();
      this.applyThemeToDom(currentTheme);
      this.persistTheme(currentTheme);
    });
  }

  /**
   * Update theme signal value.
   */
  setTheme(theme: AppTheme): void {
    if (theme === 'light' || theme === 'dark') {
      this.theme.set(theme);
    }
  }

  /**
   * Toggle between light and dark themes using Angular Signals.
   */
  toggleTheme(): AppTheme {
    const nextTheme: AppTheme = this.theme() === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
    return nextTheme;
  }

  private readInitialTheme(): AppTheme {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return 'dark';
    }
    try {
      const storedTheme = window.sessionStorage.getItem(this.STORAGE_KEY) as AppTheme | null;
      if (storedTheme === 'light' || storedTheme === 'dark') {
        return storedTheme;
      }
      const rawSettings = window.sessionStorage.getItem(this.SETTINGS_STORAGE_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        if (parsed?.theme === 'light' || parsed?.theme === 'dark') {
          return parsed.theme;
        }
      }
    } catch (e) {
      console.warn('ThemeService: Error reading initial theme from storage', e);
    }
    return 'dark';
  }

  private applyThemeToDom(theme: AppTheme): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.body?.classList.add('dark-theme');
    } else {
      document.body?.classList.remove('dark-theme');
    }
  }

  private persistTheme(theme: AppTheme): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem(this.STORAGE_KEY, theme);
      const rawSettings = window.sessionStorage.getItem(this.SETTINGS_STORAGE_KEY);
      if (rawSettings) {
        const settings = JSON.parse(rawSettings);
        settings.theme = theme;
        window.sessionStorage.setItem(this.SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      }
    } catch (e) {
      console.warn('ThemeService: Error persisting theme', e);
    }
  }
}
