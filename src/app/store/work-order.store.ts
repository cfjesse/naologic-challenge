import { signalStore, withState, withMethods, withHooks, patchState, withComputed } from '@ngrx/signals';
import { effect, inject, computed } from '@angular/core';
import { WorkOrderDocument, WorkCenterDocument, WorkOrderStatus } from '../models/work-order.model';
import { v4 as uuidv4 } from 'uuid';
import { ApiService } from '../services/api';

export type DataSource = 'server' | 'local';

interface WorkOrderState {
  workOrders: WorkOrderDocument[];
  workCenters: WorkCenterDocument[];
  dataSource: DataSource;
  isLoading: boolean;
  statusFilter: WorkOrderStatus | 'all';
}

const initialState: WorkOrderState = {
  workOrders: [],
  workCenters: [],
  dataSource: 'server',
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
        this.refreshData();
      },
      refreshData(): void {
        patchState(store, { isLoading: true });
        api.reloadAll();
        api.getWorkCenters().subscribe({
          next: (centers) => patchState(store, { workCenters: centers }),
          error: (err) => console.error('API Error loading centers:', err)
        });
        api.getWorkOrders().subscribe({
          next: (orders) => patchState(store, { workOrders: orders, isLoading: false }),
          error: (err) => {
            console.error('API Error loading orders:', err);
            patchState(store, { isLoading: false });
          }
        });
      },
      generateNewData(): void {
        patchState(store, { isLoading: true });
        api.generateOrders().subscribe({
          next: (orders) => {
            patchState(store, { workOrders: orders, isLoading: false });
          },
          error: (err) => {
            console.error('API Error generating orders:', err);
            patchState(store, { isLoading: false });
          }
        });
      },
      resetToDefaults(): void {
        patchState(store, { isLoading: true });
        api.resetData().subscribe({
          next: (data) => {
            patchState(store, {
              workCenters: data.workCenters,
              workOrders: data.workOrders,
              isLoading: false,
            });
          },
          error: (err) => {
            console.error('API Error resetting data:', err);
            patchState(store, { isLoading: false });
          }
        });
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

        api.createWorkOrder(newOrder).subscribe({
          error: (err) => console.error('API Error creating work order:', err)
        });
      },
      updateWorkOrder(docId: string, data: WorkOrderDocument['data']): void {
        patchState(store, (state) => ({
          workOrders: state.workOrders.map((o) =>
            o.docId === docId ? { ...o, data: { ...data } } : o
          ),
        }));

        api.updateWorkOrder(docId, data).subscribe({
          error: (err) => console.error('API Error updating work order:', err)
        });
      },
      deleteWorkOrder(docId: string): void {
        patchState(store, (state) => ({
          workOrders: state.workOrders.filter((o) => o.docId !== docId),
        }));

        api.deleteWorkOrder(docId).subscribe({
          error: (err) => console.error('API Error deleting work order:', err)
        });
      },
      addWorkCenter(name: string): WorkCenterDocument {
        const trimmed = name.trim();
        const newCenter: WorkCenterDocument = {
          docId: `wc-${uuidv4().substring(0, 8)}`,
          docType: 'workCenter',
          data: { name: trimmed || 'New Work Center', isDefault: false },
        };
        patchState(store, (state) => ({
          workCenters: [...state.workCenters, newCenter],
        }));

        api.createWorkCenter(newCenter).subscribe({
          error: (err) => console.error('API Error creating work center:', err)
        });
        return newCenter;
      },
      updateWorkCenter(docId: string, name: string): void {
        patchState(store, (state) => ({
          workCenters: state.workCenters.map((wc) =>
            wc.docId === docId ? { ...wc, data: { ...wc.data, name } } : wc
          ),
        }));

        api.updateWorkCenter(docId, { name }).subscribe({
          error: (err) => console.error('API Error updating work center:', err)
        });
      },
      deleteWorkCenter(docId: string): void {
        patchState(store, (state) => ({
          workCenters: state.workCenters.filter((wc) => wc.docId !== docId),
          workOrders: state.workOrders.filter((wo) => wo.data.workCenterId !== docId),
        }));

        api.deleteWorkCenter(docId).subscribe({
          error: (err) => console.error('API Error deleting work center:', err)
        });
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
      const api = inject(ApiService);
      patchState(store, { isLoading: true });

      // Fetch Work Centers directly from API
      api.getWorkCenters().subscribe({
        next: (centers) => {
          if (centers && centers.length > 0) {
            patchState(store, { workCenters: centers });
          }
        },
        error: (err) => console.error('Failed to load initial work centers from API', err)
      });

      // Fetch Work Orders directly from API
      api.getWorkOrders().subscribe({
        next: (orders) => {
          patchState(store, { workOrders: orders, isLoading: false });
        },
        error: (err) => {
          console.error('Failed to load initial work orders from API', err);
          patchState(store, { isLoading: false });
        }
      });

      // Synchronize reactive signal resources from ApiService
      effect(() => {
        const orders = api.ordersSignal();
        if (orders && orders.length > 0 && store.workOrders().length === 0) {
          patchState(store, { workOrders: orders });
        }
      });

      effect(() => {
        const centers = api.centersSignal();
        if (centers && centers.length > 0 && store.workCenters().length === 0) {
          patchState(store, { workCenters: centers });
        }
      });
    },
  })
);
