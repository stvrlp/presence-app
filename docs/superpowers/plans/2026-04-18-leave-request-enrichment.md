# Leave Request Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an employee is absent, auto-assign their status from the ERP leave request table (`ADEIES_DT`), show the leave type in the UI, warn when a leave request conflicts with clock-in hours, and use granular Excel codes in the monthly export.

**Architecture:** Runtime ERP lookup via a new `/api/leaves` route (same MSSQL pool). Leave data is never persisted locally — it's a virtual layer beneath manager actions. `PresenceRow` gains an optional `leaveRequest` field. Manager actions always win; leave request enriches display and export when no manager action exists.

**Tech Stack:** Next.js 15 App Router, TypeScript, mssql, Prisma (MySQL), xlsx, Tailwind CSS, Radix UI / shadcn

---

## File Map

| File | Change |
|------|--------|
| `lib/leaveTypes.ts` | **Create** — mapping from ERP description → `{ actionType, excelCode }` |
| `lib/types.ts` | **Modify** — add `leaveRequest` field to `PresenceRow` |
| `app/api/leaves/route.ts` | **Create** — `GET /api/leaves?date=YYYY-MM-DD` |
| `app/page.tsx` | **Modify** — fetch leaves, update merge logic, update UI rows, update delete revert, update monthly export |
| `app/api/export/monthly/route.ts` | **Modify** — add leave query for the full month, include in response |

---

## Task 1: `lib/leaveTypes.ts` — leave type lookup table

**Files:**
- Create: `lib/leaveTypes.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { ActionType } from './types';

export interface LeaveTypeInfo {
  actionType: ActionType;
  excelCode: string;
}

const LEAVE_TYPE_MAP: Record<string, LeaveTypeInfo> = {
  'Κανονική - Άδεια':                                                    { actionType: 'LEAVE',  excelCode: 'A'   },
  'Υπόλοιπο Κανονικής Προηγ. Έτους - Άδεια':                            { actionType: 'LEAVE',  excelCode: 'A'   },
  'Απουσία - Α':                                                          { actionType: 'ABSENT', excelCode: 'A'   },
  'Άδεια φροντιστή - Ειδική άδεια':                                      { actionType: 'LEAVE',  excelCode: 'ΕΑΧ' },
  'Γονική Άδεια (αρ.28 Ν.4808/2021) - Ειδική άδεια':                    { actionType: 'LEAVE',  excelCode: 'ΕΑΧ' },
  'Λόγω ασθένειας παιδιού ή άλλου εξαρτώμενου μέλους - Ειδική άδεια':  { actionType: 'LEAVE',  excelCode: 'ΕΑΧ' },
  'Μεταπτυχιακή - Ειδική άδεια':                                         { actionType: 'LEAVE',  excelCode: 'ΕΑΧ' },
  'Σπουδαστική - Ειδική άδεια':                                          { actionType: 'LEAVE',  excelCode: 'ΕΑΧ' },
  'Αιμοδοσίας - Ειδική άδεια':                                           { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Γυναικολογικού Ελέγχου - Ειδική άδεια':                               { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Θανάτου Συγγενούς - Ειδική άδεια':                                    { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Μονογονεϊκή - Ειδική άδεια':                                          { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Παράσταση σε δίκη - Ειδική άδεια':                                    { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Πατρότητας (Γέννησης Τέκνων) - Ειδική άδεια':                        { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Συμμετοχή σε δίκη - Ειδική άδεια':                                    { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Σχολική - Ειδική άδεια':                                              { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Φροντίδας Παιδιού -  Ειδική άδεια':                                   { actionType: 'LEAVE',  excelCode: 'ΕΑ'  },
  'Ασθένεια χωρίς ασφαλιστικά - Ασθένεια':                              { actionType: 'SICK',   excelCode: 'ΑΓΧ' },
};

export function resolveLeaveType(description: string): LeaveTypeInfo {
  return LEAVE_TYPE_MAP[description] ?? { actionType: 'ABSENT', excelCode: '0' };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `lib/leaveTypes.ts`

- [ ] **Step 3: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add lib/leaveTypes.ts && git commit -m "feat: add leave type lookup table"
```

---

## Task 2: Update `PresenceRow` type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `leaveRequest` field to `PresenceRow`**

In `lib/types.ts`, replace the `PresenceRow` interface with:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add lib/types.ts && git commit -m "feat: add leaveRequest field to PresenceRow"
```

---

## Task 3: `app/api/leaves/route.ts` — new API route

**Files:**
- Create: `app/api/leaves/route.ts`

- [ ] **Step 1: Create the route**

```typescript
/**
 * GET /api/leaves?date=YYYY-MM-DD
 * Returns ERP leave requests active on the given date.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { resolveLeaveType } from '@/lib/leaveTypes';
import sql from 'mssql';

export interface LeaveEntry {
  employeeCode: string;
  description: string;
  excelCode: string;
  actionType: import('@/lib/types').ActionType;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Μη εξουσιοδοτημένος' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Απαιτείται παράμετρος date σε μορφή YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('date', sql.Date, new Date(date));

    const result = await request.query(`
      SELECT
        e.[CODE]     AS employeeCode,
        t.[DESCR]    AS description
      FROM [PYLON].[dbo].[ADEIES_DT] a
      LEFT JOIN [PYLON].[dbo].[EMPLOYEE] e ON a.[ID_EMP] = e.[ID_EMP]
      LEFT JOIN [PYLON].[dbo].[ADEIES_TYPE] t ON a.[ID_TYPE] = t.[ID]
      WHERE a.[START_DATE] <= @date
        AND a.[END_DATE] >= @date
        AND e.[CODE] IS NOT NULL
    `);

    const leaves: LeaveEntry[] = result.recordset.map((row: { employeeCode: string; description: string }) => {
      const info = resolveLeaveType(row.description);
      return {
        employeeCode: row.employeeCode,
        description: row.description,
        excelCode: info.excelCode,
        actionType: info.actionType,
      };
    });

    return NextResponse.json({ leaves });
  } catch (err) {
    console.error('[GET /api/leaves]', err);
    return NextResponse.json({ error: 'Σφάλμα σύνδεσης με τη βάση δεδομένων ERP' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Manual smoke test** — start the dev server and open in browser:

```
http://localhost:3000/api/leaves?date=2026-04-18
```

Expected: JSON response `{ "leaves": [...] }` — either an empty array or leave entries with `employeeCode`, `description`, `excelCode`, `actionType`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add app/api/leaves/route.ts && git commit -m "feat: add /api/leaves route for ERP leave request lookup"
```

---

## Task 4: Update `fetchData` — fetch leaves and update merge logic

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `/api/leaves` to the parallel fetch in `fetchData`**

In `app/page.tsx`, find the `fetchData` function (around line 166). Replace the `Promise.all` block:

```typescript
const [empRes, attRes, actRes, leaveRes] = await Promise.all([
  fetch(`/api/employees?date=${date}`),
  fetch(`/api/attendance?date=${date}`),
  fetch(`/api/actions?date=${date}`),
  fetch(`/api/leaves?date=${date}`),
]);

const [empData, attData, actData, leaveData] = await Promise.all([
  empRes.json(),
  attRes.json(),
  actRes.json(),
  leaveRes.json(),
]);

if (!empRes.ok) throw new Error(empData.error ?? 'Σφάλμα φόρτωσης εργαζομένων');
if (!attRes.ok) throw new Error(attData.error ?? 'Σφάλμα φόρτωσης παρουσιών');
if (!actRes.ok) throw new Error(actData.error ?? 'Σφάλμα φόρτωσης ενεργειών');
// leave errors are non-fatal — we continue without leave data
```

- [ ] **Step 2: Build the `leaveMap` after the `actionMap` block**

Add this block right after the `actionMap` is built (around line 211):

```typescript
type LeaveRecord = {
  employeeCode: string;
  description: string;
  excelCode: string;
  actionType: ActionType;
};
const leaveMap = new Map<string, LeaveRecord>();
for (const leave of (leaveData?.leaves ?? []) as LeaveRecord[]) {
  leaveMap.set(leave.employeeCode, leave);
}
```

- [ ] **Step 3: Update the merge logic to use leave data**

Replace the merge block (around lines 227–257) — specifically the status calculation and the `return` object:

```typescript
const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 6 = Saturday
const merged: PresenceRow[] = Array.from(empMap.values()).map((emp) => {
  const card  = cardMap.get(emp.code);
  const act   = actionMap.get(emp.code);
  const leave = leaveMap.get(emp.code);

  let status: PresenceRow['status'];
  if (act) {
    status = act.action;
  } else if (card) {
    status = 'PRESENT';
  } else if (leave) {
    status = leave.actionType;
  } else if (dayOfWeek === 0 || dayOfWeek === 6) {
    status = 'DAYOFF';
  } else {
    status = 'UNKNOWN';
  }

  return {
    code: emp.code,
    surname: emp.surname,
    name: emp.name,
    department: emp.department,
    hasCardEntry: !!card,
    timeIn:  card ? formatTime(card.timeIn)  : null,
    timeOut: card ? formatTime(card.timeOut) : null,
    date,
    actionId:   act?.id ?? null,
    action:     act?.action ?? null,
    actionNote: act?.note ?? null,
    managerId:  act?.managerId ?? null,
    leaveRequest: leave
      ? { description: leave.description, excelCode: leave.excelCode, actionType: leave.actionType }
      : null,
    status,
  };
});
```

- [ ] **Step 4: Update the ex-employee block** (around line 260, where card entries for employees not in active list are added). Add `leaveRequest` to that push:

```typescript
for (const [code, card] of Array.from(cardMap.entries())) {
  if (!merged.find((r) => r.code === code)) {
    const act   = actionMap.get(code);
    const leave = leaveMap.get(code);
    merged.push({
      code,
      surname: card.surname,
      name: card.name,
      department: card.department,
      hasCardEntry: true,
      timeIn:  formatTime(card.timeIn),
      timeOut: formatTime(card.timeOut),
      date,
      actionId:   act?.id ?? null,
      action:     act?.action ?? null,
      actionNote: act?.note ?? null,
      managerId:  act?.managerId ?? null,
      leaveRequest: leave
        ? { description: leave.description, excelCode: leave.excelCode, actionType: leave.actionType }
        : null,
      status: act ? act.action : 'PRESENT',
    });
  }
}
```

- [ ] **Step 5: Update `handleDeleteAction` to revert to leave status when applicable**

Find the optimistic state update inside `handleDeleteAction` (around line 421). Replace:

```typescript
status: r.hasCardEntry ? 'PRESENT' : 'UNKNOWN',
```

with:

```typescript
status: r.hasCardEntry ? 'PRESENT' : (r.leaveRequest?.actionType ?? 'UNKNOWN'),
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 7: Manual test** — open the app on a day when some employees have leave requests. Confirm absence rows show the correct status pill (LEAVE or SICK rather than UNKNOWN) for employees with ERP leave requests.

- [ ] **Step 8: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add app/page.tsx && git commit -m "feat: fetch and merge ERP leave requests into presence rows"
```

---

## Task 5: UI — leave sub-label and conflict warning badge

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the `TriangleAlert` icon import**

At the top of `app/page.tsx`, find the lucide-react import block and add `TriangleAlert`:

```typescript
import {
  Download,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  Table2,
  Calendar,
  TriangleAlert,
} from 'lucide-react';
```

- [ ] **Step 2: Add leave description sub-label on absence rows**

Find the status `TableCell` (around line 902):

```tsx
<TableCell className="text-center">
  <Badge className={sc.className}>{sc.label}</Badge>
  {row.actionNote && (
    <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px] truncate">
      {row.actionNote}
    </p>
  )}
</TableCell>
```

Replace with:

```tsx
<TableCell className="text-center">
  <Badge className={sc.className}>{sc.label}</Badge>
  {!row.action && row.leaveRequest && (
    <p className="text-xs text-amber-700 mt-0.5 max-w-[140px] truncate" title={row.leaveRequest.description}>
      {row.leaveRequest.description}
    </p>
  )}
  {row.actionNote && (
    <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px] truncate">
      {row.actionNote}
    </p>
  )}
</TableCell>
```

- [ ] **Step 3: Add conflict warning badge on presence rows**

Find the employee name cells (around line 887):

```tsx
<TableCell className="font-medium">{row.surname}</TableCell>
<TableCell>{row.name}</TableCell>
```

Replace with:

```tsx
<TableCell className="font-medium">{row.surname}</TableCell>
<TableCell>
  <span>{row.name}</span>
  {row.hasCardEntry && row.leaveRequest && (
    <span
      className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600 font-medium"
      title="Ο εργαζόμενος έχει αίτημα άδειας αλλά εμφανίζει ώρες εργασίας"
    >
      <TriangleAlert className="h-3 w-3" />
      Αίτημα άδειας
    </span>
  )}
</TableCell>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Manual test**

- On an absence row with a leave request: status pill shows LEAVE/SICK, and the leave description appears below in amber text.
- If a manager manually sets an action on that row, the description sub-label should disappear (because `!row.action` is false).
- On a presence row (has card entry) where the employee also has a leave request: an amber "⚠ Αίτημα άδειας" badge appears next to the name.

- [ ] **Step 6: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add app/page.tsx && git commit -m "feat: show leave type sub-label and conflict warning in UI"
```

---

## Task 6: Update monthly export API to include leave data

**Files:**
- Modify: `app/api/export/monthly/route.ts`

- [ ] **Step 1: Add leave query to the parallel fetch**

In `app/api/export/monthly/route.ts`, find the `Promise.all` block (around line 63). Replace it:

```typescript
const leaveRequest = pool.request();
leaveRequest.input('monthStart', sql.Date, monthStart);
leaveRequest.input('monthEndDate', sql.Date, new Date(year, month - 1, new Date(year, month, 0).getDate()));

const [empResult, attResult, dbActions, leaveResult] = await Promise.all([
  empRequest.query(`
    SELECT
      e.[CODE]       AS code,
      e.[SURNAME]    AS surname,
      e.[NAME]       AS name,
      t.[DESCR]      AS department
    FROM [PYLON].[dbo].[vSEM_EMPS] e
    LEFT JOIN [PYLON].[dbo].[TMIMATA_apasx] t ON e.[TMHMA] = t.[TMHMA]
    WHERE e.[ISACTIVE] = 1
      AND e.[HRDATE] <= @monthStart
      AND (e.[FRDATE] IS NULL OR e.[FRDATE] >= @monthStart)
      ${deptFilter}
    ORDER BY e.[SURNAME], e.[NAME]
  `),
  attRequest.query(`
    SELECT
      e.[CODE]                    AS code,
      CAST(i.[Expr3] AS DATE)     AS entryDate,
      MIN(CASE WHEN i.[Expr4] = 1 THEN CAST(i.[Expr3] AS TIME) END) AS timeIn,
      MAX(CASE WHEN i.[Expr4] = 2 THEN CAST(i.[Expr3] AS TIME) END) AS timeOut
    FROM [PYLON].[dbo].[io_10days] i
    INNER JOIN [PYLON].[dbo].[CARD_CODES] cc ON cc.[CARD_CODE] = i.[Expr2]
      AND cc.[FROM_DATE] <= @monthEnd
      AND (cc.[TO_DATE] IS NULL OR cc.[TO_DATE] >= @monthStart)
    INNER JOIN [PYLON].[dbo].[vSEM_EMPS] e ON e.[ID_EMP] = cc.[ID_EMP]
    WHERE i.[Expr3] >= @monthStart AND i.[Expr3] < @monthEnd
      AND i.[Expr4] IN (1, 2)
    GROUP BY e.[CODE], CAST(i.[Expr3] AS DATE)
  `),
  prisma.presenceAction.findMany({
    where: { date: { gte: monthStartStr, lte: monthEndStr } },
  }),
  leaveRequest.query(`
    SELECT
      e.[CODE]     AS employeeCode,
      t.[DESCR]    AS description,
      CAST(a.[START_DATE] AS DATE) AS startDate,
      CAST(a.[END_DATE]   AS DATE) AS endDate
    FROM [PYLON].[dbo].[ADEIES_DT] a
    LEFT JOIN [PYLON].[dbo].[EMPLOYEE] e ON a.[ID_EMP] = e.[ID_EMP]
    LEFT JOIN [PYLON].[dbo].[ADEIES_TYPE] t ON a.[ID_TYPE] = t.[ID]
    WHERE a.[START_DATE] <= @monthEndDate
      AND a.[END_DATE]   >= @monthStart
      AND e.[CODE] IS NOT NULL
  `),
]);
```

- [ ] **Step 2: Add `resolveLeaveType` import at top of the file**

`toLocalDateString` is already imported on line 10. Only add the new import:

```typescript
import { resolveLeaveType } from '@/lib/leaveTypes';
```

- [ ] **Step 3: Build the `leaves` response map**

After the `actions` map is built (around line 114), add:

```typescript
type LeaveRow = { employeeCode: string; description: string; startDate: Date | string; endDate: Date | string };
const leaves: Record<string, { employeeCode: string; excelCode: string }[]> = {};

for (const row of leaveResult.recordset as LeaveRow[]) {
  const start = typeof row.startDate === 'string' ? row.startDate.slice(0, 10) : toLocalDateString(row.startDate);
  const end   = typeof row.endDate   === 'string' ? row.endDate.slice(0, 10)   : toLocalDateString(row.endDate);
  const { excelCode } = resolveLeaveType(row.description);

  // Expand each leave record into individual dates within the month
  let cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) {
    const dateStr = toLocalDateString(cur);
    if (!leaves[dateStr]) leaves[dateStr] = [];
    leaves[dateStr].push({ employeeCode: row.employeeCode, excelCode });
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
}
```

- [ ] **Step 4: Include `leaves` in the response**

Replace the final `return NextResponse.json(...)`:

```typescript
return NextResponse.json({ employees, attendance, actions, leaves });
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add app/api/export/monthly/route.ts && git commit -m "feat: add leave data to monthly export API response"
```

---

## Task 7: Update `handleMonthlyExport` to use granular leave codes

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update the type definitions inside `handleMonthlyExport`**

Find `handleMonthlyExport` (around line 532). After the existing type declarations (`EmpRow`, `ActEntry`, `AttEntry`), add:

```typescript
type LeaveEntry = { employeeCode: string; excelCode: string };
```

- [ ] **Step 2: Update the cell code resolution inside the date loop**

Find the per-cell logic (around line 578–594):

```typescript
for (const dateStr of dates) {
  const [y, m, d] = dateStr.split('-');
  const colHeader = `${d}/${m}/${y}`;

  if (dateStr > today) {
    row[colHeader] = '';
    continue;
  }

  const dayActions: ActEntry[] = data.actions[dateStr] ?? [];
  const empAction = dayActions.find((a) => a.employeeCode === emp.code);

  if (empAction) {
    row[colHeader] = STATUS_CODE[empAction.action] ?? '';
  } else {
    const dayAtt: AttEntry[] = data.attendance[dateStr] ?? [];
    row[colHeader] = dayAtt.some((a) => a.code === emp.code) ? STATUS_CODE.PRESENT : '';
  }
}
```

Replace with:

```typescript
for (const dateStr of dates) {
  const [y, m, d] = dateStr.split('-');
  const colHeader = `${d}/${m}/${y}`;

  if (dateStr > today) {
    row[colHeader] = '';
    continue;
  }

  const dayActions: ActEntry[] = data.actions[dateStr] ?? [];
  const empAction = dayActions.find((a) => a.employeeCode === emp.code);

  if (empAction) {
    // Manager-set action — use broad STATUS_CODE (unchanged behaviour)
    row[colHeader] = STATUS_CODE[empAction.action] ?? '';
  } else {
    const dayAtt: AttEntry[] = data.attendance[dateStr] ?? [];
    if (dayAtt.some((a) => a.code === emp.code)) {
      row[colHeader] = STATUS_CODE.PRESENT;
    } else {
      // No card entry — check for ERP leave request (granular code)
      const dayLeaves: LeaveEntry[] = data.leaves?.[dateStr] ?? [];
      const empLeave = dayLeaves.find((l) => l.employeeCode === emp.code);
      row[colHeader] = empLeave ? empLeave.excelCode : '';
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Manual test** — trigger a monthly export. Open the file and verify:
  - Employees with manager-set actions still show the broad codes (A, ΑΓ, R, etc.)
  - Employees with ERP leave requests and no manager action show granular codes (ΕΑ, ΕΑΧ, ΑΓΧ, etc.)
  - Employees with card entries show `1`
  - Future dates are blank

- [ ] **Step 5: Commit**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && git add app/page.tsx && git commit -m "feat: use granular leave codes in monthly Excel export"
```

---

## Done

All tasks complete. The feature delivers:
- Auto-assigned statuses from ERP leave requests when no manager action exists
- Leave type description shown as a sub-label on absence rows
- Amber warning badge on presence rows where a leave request also exists
- Granular Excel codes (ΕΑ, ΕΑΧ, ΑΓΧ, A, etc.) in the monthly export for ERP-derived leaves
- Manager actions always override auto-assignment; the ActionDialog dropdown is unchanged
