import { signalStore, withState, withMethods, withHooks, patchState, withComputed } from '@ngrx/signals';
import { effect, inject, computed } from '@angular/core';
import { WorkOrderDocument, WorkCenterDocument, TimeScale, WorkOrderStatus } from '../models/work-order.model';
import { v4 as uuidv4 } from 'uuid';

export type DataSource = 'local' | 'server';

interface WorkOrderState {
  workOrders: WorkOrderDocument[];
  workCenters: WorkCenterDocument[];
  dataSource: DataSource;
  isLoading: boolean;
  statusFilter: WorkOrderStatus | 'all';
}

const STORAGE_KEY = 'naologic_work_orders_v4'; // Bumping for data refresh

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
  withMethods((store) => ({
    setLoading(isLoading: boolean): void {
      patchState(store, { isLoading });
    },
    setStatusFilter(statusFilter: WorkOrderStatus | 'all'): void {
      patchState(store, { statusFilter });
    },
    setDataSource(dataSource: DataSource): void {
      patchState(store, { dataSource });
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
    },
    updateWorkOrder(docId: string, data: WorkOrderDocument['data']): void {
      patchState(store, (state) => ({
        workOrders: state.workOrders.map((o) =>
          o.docId === docId ? { ...o, data: { ...data } } : o
        ),
      }));
    },
    deleteWorkOrder(docId: string): void {
      patchState(store, (state) => ({
        workOrders: state.workOrders.filter((o) => o.docId !== docId),
      }));
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

        // Check if [startMs, endMs] overlaps with [orderStartMs, orderEndMs]
        // Overlap if (StartA < EndB) and (EndA > StartB)
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
  })),
  withHooks({
    onInit(store) {
      // Load initial work centers
      store.setWorkCenters([
        { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line A' } },
        { docId: 'wc-2', docType: 'workCenter', data: { name: 'CNC Machine 1' } },
        { docId: 'wc-3', docType: 'workCenter', data: { name: 'Assembly Station' } },
        { docId: 'wc-4', docType: 'workCenter', data: { name: 'Quality Control' } },
        { docId: 'wc-5', docType: 'workCenter', data: { name: 'Packaging Line' } },
      ]);

      // Handle persistence
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
          console.error('Failed to parse stored work orders', e);
          store.setWorkOrders(getDefaultWorkOrders());
        }
      } else {
        store.setWorkOrders(getDefaultWorkOrders());
      }

      // Auto-save effect
      effect(() => {
        const orders = store.workOrders();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      });
    },
  })
);

function getDefaultWorkOrders(): WorkOrderDocument[] {
  return [
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Omega Forge', workCenterId: 'wc-1', status: 'complete', startDate: '2026-03-01', endDate: '2026-03-10' },
    },
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Titanium Weld', workCenterId: 'wc-2', status: 'in-progress', startDate: '2026-03-15', endDate: '2026-04-20' },
    },
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Cyberdyne Systems', workCenterId: 'wc-3', status: 'open', startDate: '2026-04-01', endDate: '2026-05-15' },
    },
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Mars Rover Chassis', workCenterId: 'wc-4', status: 'blocked', startDate: '2026-02-15', endDate: '2026-04-20' },
    },
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Nano Coating', workCenterId: 'wc-1', status: 'in-progress', startDate: '2026-04-10', endDate: '2026-05-30' },
    },
    {
      docId: uuidv4(),
      docType: 'workOrder',
      data: { name: 'Fusion Core V4', workCenterId: 'wc-5', status: 'open', startDate: '2026-05-01', endDate: '2026-07-15' },
    },
  ];
}
