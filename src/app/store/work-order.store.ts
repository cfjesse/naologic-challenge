import { signalStore, withState, withMethods, withHooks, patchState, withComputed } from '@ngrx/signals';
import { effect, inject, computed } from '@angular/core';
import { WorkOrderDocument, WorkCenterDocument, TimeScale, WorkOrderStatus } from '../models/work-order.model';
import { v4 as uuidv4 } from 'uuid';
import { ApiService } from '../services/api';
import { tap } from 'rxjs/operators';

export type DataSource = 'local' | 'server';

interface WorkOrderState {
  workOrders: WorkOrderDocument[];
  workCenters: WorkCenterDocument[];
  dataSource: DataSource;
  isLoading: boolean;
  statusFilter: WorkOrderStatus | 'all';
}

const STORAGE_KEY = 'naologic_work_orders_v4';

const initialState: WorkOrderState = {
  workOrders: [],
  workCenters: [],
  dataSource: 'local',
  isLoading: false,
  statusFilter: 'all',
};

export const WorkOrderStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ workOrders, statusFilter }) => ({
    filteredWorkOrders: computed(() => {
      const filter = statusFilter();
      const orders = workOrders();
      if (filter === 'all') return orders;
      return orders.filter((o) => o.data.status === filter);
    }),
  })),
  withMethods((store) => {
    const api = inject(ApiService);
    
    return {
      setLoading(isLoading: boolean): void {
        patchState(store, { isLoading });
      },
      setStatusFilter(statusFilter: WorkOrderStatus | 'all'): void {
        patchState(store, { statusFilter });
      },
      setDataSource(dataSource: DataSource): void {
        patchState(store, { dataSource });
        
        if (dataSource === 'server') {
          patchState(store, { isLoading: true });
          api.getWorkOrders().pipe(
            tap(() => patchState(store, { isLoading: false }))
          ).subscribe(orders => {
            patchState(store, { workOrders: orders });
          });
        } else {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed)) {
                patchState(store, { workOrders: parsed });
              }
            } catch {}
          }
        }
      },
      setWorkOrders(workOrders: WorkOrderDocument[]): void {
        patchState(store, { workOrders });
      },
      setWorkCenters(workCenters: WorkCenterDocument[]): void {
        patchState(store, { workCenters });
      },
      addWorkOrder(data: WorkOrderDocument['data']): void {
        const newOrder: WorkOrderDocument = {
          docId: uuidv4(),
          docType: 'workOrder',
          data: { ...data },
        };
        
        patchState(store, (state) => ({
          workOrders: [...state.workOrders, newOrder],
        }));

        if (store.dataSource() === 'server') {
          api.createWorkOrder(newOrder).subscribe();
        }
      },
      updateWorkOrder(docId: string, data: WorkOrderDocument['data']): void {
        patchState(store, (state) => ({
          workOrders: state.workOrders.map((o) =>
            o.docId === docId ? { ...o, data: { ...data } } : o
          ),
        }));

        if (store.dataSource() === 'server') {
          api.updateWorkOrder(docId, data).subscribe();
        }
      },
      deleteWorkOrder(docId: string): void {
        patchState(store, (state) => ({
          workOrders: state.workOrders.filter((o) => o.docId !== docId),
        }));

        if (store.dataSource() === 'server') {
          api.deleteWorkOrder(docId).subscribe();
        }
      },
      checkOverlap(
        workCenterId: string,
        startDate: string,
        endDate: string,
        excludeDocId?: string
      ): WorkOrderDocument | undefined {
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();

        return store.workOrders().find((order) => {
          if (order.docId === excludeDocId) return false;
          if (order.data.workCenterId !== workCenterId) return false;

          const orderStartMs = new Date(order.data.startDate).getTime();
          const orderEndMs = new Date(order.data.endDate).getTime();

          return startMs < orderEndMs && endMs > orderStartMs;
        });
      },
      getOrdersForWorkCenter(workCenterId: string): WorkOrderDocument[] {
        return store.workOrders().filter((o) => o.data.workCenterId === workCenterId);
      },
      getWorkCenterName(workCenterId: string): string {
        const wc = store.workCenters().find((c) => c.docId === workCenterId);
        return wc ? wc.data.name : 'Unknown';
      },
    };
  }),
  withHooks({
    onInit(store) {
      store.setWorkCenters([
        { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line A' } },
        { docId: 'wc-2', docType: 'workCenter', data: { name: 'CNC Machine 1' } },
        { docId: 'wc-3', docType: 'workCenter', data: { name: 'Assembly Station' } },
        { docId: 'wc-4', docType: 'workCenter', data: { name: 'Quality Control' } },
        { docId: 'wc-5', docType: 'workCenter', data: { name: 'Packaging Line' } },
      ]);

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            store.setWorkOrders(parsed);
          } else {
            store.setWorkOrders(getDefaultWorkOrders());
          }
        } catch (e) {
          store.setWorkOrders(getDefaultWorkOrders());
        }
      } else {
        store.setWorkOrders(getDefaultWorkOrders());
      }

      effect(() => {
        const orders = store.workOrders();
        const source = store.dataSource();
        
        if (source === 'local') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
        }
      });
    },
  })
);

function getDefaultWorkOrders(): WorkOrderDocument[] {
  const orders: WorkOrderDocument[] = [];
  const now = new Date();
  
  // +/- 3 months
  const minDate = new Date(now);
  minDate.setMonth(now.getMonth() - 3);
  
  const maxDate = new Date(now);
  maxDate.setMonth(now.getMonth() + 3);
  
  const totalDaysSpan = Math.floor((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  const titles = [
    'Omega Forge', 'Titanium Weld', 'Cyberdyne Systems', 
    'Mars Rover Chassis', 'Nano Coating', 'Fusion Core V4',
    'Quantum Stabilizer', 'Flux Capacitor', 'Positron Matrix'
  ];
  const wcIds = ['wc-1', 'wc-2', 'wc-3', 'wc-4', 'wc-5'];
  const statuses: WorkOrderStatus[] = ['open', 'in-progress', 'complete', 'blocked'];
  
  const occupied: Record<string, { startMs: number; endMs: number }[]> = {};
  wcIds.forEach(id => occupied[id] = []);

  let createdCount = 0;
  let attempts = 0;
  const targetOrders = 20;

  while (createdCount < targetOrders && attempts < 200) {
    attempts++;
    
    // Random WC
    const wcId = wcIds[Math.floor(Math.random() * wcIds.length)];
    
    // Random duration: 7 to 21 days
    const durationDays = Math.floor(Math.random() * 15) + 7; 
    
    // Random start date within range
    const randomOffset = Math.floor(Math.random() * (totalDaysSpan - durationDays));
    const start = new Date(minDate);
    start.setDate(start.getDate() + randomOffset);
    
    const end = new Date(start);
    end.setDate(start.getDate() + durationDays);
    
    const startMs = start.getTime();
    const endMs = end.getTime();
    
    // Check overlap
    const hasOverlap = occupied[wcId].some(slot => {
        return (startMs < slot.endMs && endMs > slot.startMs);
    });
    
    if (!hasOverlap) {
        orders.push({
            docId: uuidv4(),
            docType: 'workOrder',
            data: {
                name: `${titles[Math.floor(Math.random() * titles.length)]} #${createdCount + 101}`,
                workCenterId: wcId,
                status: statuses[Math.floor(Math.random() * statuses.length)],
                startDate: start.toISOString().split('T')[0],
                endDate: end.toISOString().split('T')[0]
            }
        });
        
        occupied[wcId].push({ startMs, endMs });
        createdCount++;
    }
  }
  
  return orders;
}
