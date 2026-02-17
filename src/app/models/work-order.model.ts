/** Status values per the spec */
export type WorkOrderStatus = 'open' | 'in-progress' | 'complete' | 'blocked';

/** Document-based Work Center */
export interface WorkCenterDocument {
  docId: string;
  docType: 'workCenter';
  data: {
    name: string;
    isDefault?: boolean;
  };
}

/** Document-based Work Order */
export interface WorkOrderDocument {
  docId: string;
  docType: 'workOrder';
  data: {
    name: string;
    workCenterId: string; // references WorkCenterDocument.docId
    status: WorkOrderStatus;
    startDate: string;    // ISO date "YYYY-MM-DD"
    endDate: string;      // ISO date "YYYY-MM-DD"
  };
}

/** Timescale options */
export type TimeScale = 'Day' | 'Week' | 'Month';
