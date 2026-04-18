# Leave Request Enrichment Design

**Date:** 2026-04-18

## Overview

When an employee is absent (no card entry), the system checks the ERP `ADEIES_DT` table for a matching leave request and auto-assigns the correct status. If the employee has both a leave request and clock-in hours, a warning is shown. Manager actions always take precedence. The monthly Excel export uses granular leave type codes when the status is auto-assigned from ERP data.

---

## 1. Data Layer

### New API route: `GET /api/leaves?date=YYYY-MM-DD`

- Queries `[PYLON].[dbo].[ADEIES_DT]` joined with `[PYLON].[dbo].[EMPLOYEE]` and `[PYLON].[dbo].[ADEIES_TYPE]` via the existing MSSQL connection pool (`lib/db.ts`)
- Filters: `START_DATE <= date AND END_DATE >= date`
- Returns one record per employee (matched by `CODE`/`VAT`) with:
  - `employeeCode: string`
  - `description: string` — the leave type description from ERP
  - `actionType: ActionType` — mapped from description (LEAVE, SICK, or ABSENT)
  - `excelCode: string` — granular Excel code (A, ΕΑ, ΕΑΧ, ΑΓΧ, etc.)

### New file: `lib/leaveTypes.ts`

Lookup table mapping ERP leave type description → `{ actionType: ActionType, excelCode: string }`:

| ERP Description | ActionType | Excel Code |
|---|---|---|
| Κανονική - Άδεια | LEAVE | A |
| Υπόλοιπο Κανονικής Προηγ. Έτους - Άδεια | LEAVE | A |
| Απουσία - Α | ABSENT | A |
| Άδεια φροντιστή - Ειδική άδεια | LEAVE | ΕΑΧ |
| Γονική Άδεια (αρ.28 Ν.4808/2021) - Ειδική άδεια | LEAVE | ΕΑΧ |
| Λόγω ασθένειας παιδιού ή άλλου εξαρτώμενου μέλους - Ειδική άδεια | LEAVE | ΕΑΧ |
| Μεταπτυχιακή - Ειδική άδεια | LEAVE | ΕΑΧ |
| Σπουδαστική - Ειδική άδεια | LEAVE | ΕΑΧ |
| Αιμοδοσίας - Ειδική άδεια | LEAVE | ΕΑ |
| Γυναικολογικού Ελέγχου - Ειδική άδεια | LEAVE | ΕΑ |
| Θανάτου Συγγενούς - Ειδική άδεια | LEAVE | ΕΑ |
| Μονογονεϊκή - Ειδική άδεια | LEAVE | ΕΑ |
| Παράσταση σε δίκη - Ειδική άδεια | LEAVE | ΕΑ |
| Πατρότητας (Γέννησης Τέκνων) - Ειδική άδεια | LEAVE | ΕΑ |
| Συμμετοχή σε δίκη - Ειδική άδεια | LEAVE | ΕΑ |
| Σχολική - Ειδική άδεια | LEAVE | ΕΑ |
| Φροντίδας Παιδιού - Ειδική άδεια | LEAVE | ΕΑ |
| Ασθένεια χωρίς ασφαλιστικά - Ασθένεια | SICK | ΑΓΧ |

Unknown descriptions fall back to `{ actionType: 'ABSENT', excelCode: '0' }`.

### `PresenceRow` — new optional field (`lib/types.ts`)

```ts
leaveRequest?: { description: string; excelCode: string; actionType: ActionType } | null
```

### Merge priority in `page.tsx`

1. Manager action (local DB `PresenceAction`) — always wins
2. Card entry → PRESENT (if leave request also exists, populates `leaveRequest` for warning display only — no status override)
3. Leave request from ERP (no card entry) → auto-assigns `actionType` as status; populates `leaveRequest`
4. Weekend (Sat/Sun) → DAYOFF
5. Weekday, nothing → UNKNOWN

---

## 2. UI

### Absence rows (no card entry, leave request found)

- Status pill shows the auto-assigned `actionType` (e.g., LEAVE, SICK)
- Sub-label below the employee name shows the ERP description (e.g., "Θανάτου Συγγενούς")
- If a manager manually assigns an action, it overwrites the auto-assignment and the sub-label is hidden

### Presence rows (card entry + leave request — conflict)

- Amber warning badge on the row: "⚠ Αίτημα άδειας"
- Informational only — no auto-assignment (card entry takes precedence for status)
- Signals to the manager that the employee needs to reject their leave request

### ActionDialog

No changes. Dropdown options remain: Παρών, Άδεια, Ασθένεια, Απουσία, Τηλεργασία, Ρεπό.

---

## 3. Monthly Excel Export

### `/api/export/monthly`

- Fetches leave requests for the full month in one query: `START_DATE <= lastDay AND END_DATE >= firstDay`
- Builds a `leaveMap` indexed by `(employeeCode, date)` for O(1) lookup per cell

### Cell code resolution (priority order)

1. Manager action exists → existing `STATUS_CODE` map (unchanged: LEAVE→A, SICK→ΑΓ, ABSENT→0, etc.)
2. Leave request found → granular `excelCode` from `leaveTypes.ts` mapping
3. Card entry → `1`
4. Weekend → `R`
5. Otherwise → `0`

---

## Out of Scope

- No changes to the `PresenceAction` schema — leave data is never persisted locally
- No changes to the ActionDialog dropdown options
- No changes to daily (non-monthly) export
