/**
 * Shared TypeScript types for the presence monitoring app.
 */

export type ActionType = 'PRESENT' | 'REJECTED' | 'LEAVE' | 'SICK' | 'ABSENT' | 'REMOTE' | 'DAYOFF';

/** A row in the attendance table — merged employee + card entry + manager action */
export interface PresenceRow {
  // Employee fields (from ERP vSEM_EMPS)
  code: string;
  surname: string;
  name: string;
  department: string | null;

  // Card entry fields (from ERP io_10days / SS_vEMP_CARD)
  hasCardEntry: boolean;
  timeIn: string | null;   // HH:MM or null
  timeOut: string | null;  // HH:MM or null

  // The date this row is for
  date: string; // YYYY-MM-DD

  // Manager override (from local SQLite)
  actionId?: string | null;   // PresenceAction.id — null if not yet actioned
  action?: ActionType | null; // null = not yet actioned
  actionNote?: string | null;
  managerId?: string | null;

  // ERP leave request for this employee on this date (if any)
  leaveRequest?: { description: string; excelCode: string; actionType: ActionType } | null;

  // Computed display status
  status: ActionType | 'UNKNOWN'; // 'UNKNOWN' = no card + no action yet
}

/** Raw employee record from ERP */
export interface ErpEmployee {
  code: string;
  surname: string;
  name: string;
  department: string | null;
}

/** Raw card entry from ERP */
export interface ErpAttendanceEntry {
  code: string;
  surname: string;
  name: string;
  department: string | null;
  timeIn: string | null;
  timeOut: string | null;
}

/** Manager action record from local SQLite */
export interface ManagerAction {
  id: string;
  employeeCode: string;
  date: string;
  action: ActionType;
  note: string | null;
  managerId: string;
}

/** Summary counts for the status bar */
export interface StatusSummary {
  present: number;
  leave: number;
  sick: number;
  absent: number;
  remote: number;
  dayoff: number;
  unknown: number;
}
