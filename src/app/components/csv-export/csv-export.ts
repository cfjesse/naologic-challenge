import { Component, inject, signal, computed } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { WorkOrderStore } from '../../store/work-order.store';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkOrderDocument } from '../../models/work-order.model';

@Component({
  selector: 'app-csv-export',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './csv-export.html',
  styleUrl: './csv-export.scss'
})
export class CsvExportComponent {
  activeModal = inject(NgbActiveModal);
  store = inject(WorkOrderStore);
  
  filename = signal('work-orders');
  selectedOrderIds = signal<Set<string>>(new Set());
  
  orders = this.store.workOrders;
  
  constructor() {
    const allIds = new Set(this.orders().map(o => o.docId));
    this.selectedOrderIds.set(allIds);
  }

  isValidName = computed(() => {
    const name = this.filename();
    return /^[a-zA-Z0-9-_]+$/.test(name) && name.length > 0;
  });

  toggleOrder(id: string, event: any) {
    const current = new Set(this.selectedOrderIds());
    if (event.target.checked) current.add(id);
    else current.delete(id);
    this.selectedOrderIds.set(current);
  }
  
  toggleAll(event: any) {
    if (event.target.checked) {
      this.selectedOrderIds.set(new Set(this.orders().map(o => o.docId)));
    } else {
      this.selectedOrderIds.set(new Set());
    }
  }

  download() {
    if (!this.isValidName()) return;
    
    const selected = this.orders().filter(o => this.selectedOrderIds().has(o.docId));
    if (selected.length === 0) return;

    const headers = ['ID', 'Name', 'Status', 'Start Date', 'End Date', 'Work Center'];
    const rows = selected.map(o => [
        o.docId,
        o.data.name,
        o.data.status,
        o.data.startDate,
        o.data.endDate,
        this.store.getWorkCenterName(o.data.workCenterId)
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(c => `"${c}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${this.filename()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    this.activeModal.close();
  }
}
