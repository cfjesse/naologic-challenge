import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterModule } from '@angular/router';

import { inject } from '@angular/core';
import { AuthService } from './services/auth';

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
}
