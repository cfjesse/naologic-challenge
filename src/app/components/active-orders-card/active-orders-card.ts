import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { WorkOrderDocument } from '../../models/work-order.model';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

@Component({
  selector: 'app-active-orders-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './active-orders-card.html',
  styleUrl: './active-orders-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('cardAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate('400ms cubic-bezier(0.25, 0.8, 0.25, 1)', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('300ms cubic-bezier(0.25, 0.8, 0.25, 1)', style({ opacity: 0, transform: 'translateY(20px)' }))
      ])
    ]),
    trigger('listAnimation', [
      transition('* => *', [ // trigger on list change
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(10px)' }),
          stagger(50, [
            animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
          ])
        ], { optional: true })
      ])
    ]),
    // We can also have an itemAnimation if we want per-item control, but listAnimation handles stagger.
    // However, user asked for items to fade in/out specifically.
    // Let's add itemAnimation for leave transition which listAnimation query supports but explicit is nice.
    trigger('itemAnimation', [
       transition(':leave', [
         animate('200ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))
       ])
    ])
  ]
})
export class ActiveOrdersCardComponent {
  @Input() activeOrders: WorkOrderDocument[] = [];
  @Input() periodLabel: string = '';

  trackByOrderId(index: number, order: WorkOrderDocument): string {
    return order.docId;
  }
}
