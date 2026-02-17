import { Component, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  username = '';
  password = '';
  error = signal('');
  loading = signal(false);

  private auth = inject(AuthService);
  private router = inject(Router);

  onSubmit(): void {
    if (!this.username || !this.password) return;
    
    this.loading.set(true);
    this.error.set('');

    this.auth.login(this.username, this.password).subscribe({
      next: (success) => {
        if (!success) {
          this.error.set('Invalid credentials');
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Login failed');
        this.loading.set(false);
      }
    });
  }
}
