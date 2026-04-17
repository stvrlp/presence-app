# Monthly Calendar Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Εξαγωγή Μηνός" button that exports the current calendar month's attendance as a calendar-grid Excel file (rows = employees, columns = dates, cells = status codes).

**Architecture:** A new `/api/export/monthly` route runs three parallel queries (employees, full-month attendance via CARD_CODES→vSEM_EMPS, full-month actions from SQLite) and returns consolidated JSON. The client builds the Excel grid using the existing `xlsx` library and downloads it.

**Tech Stack:** Next.js 14 App Router, TypeScript, mssql (SQL Server / PYLON ERP), Prisma (SQLite), xlsx (client-side)

---

## File Map

| File | Change |
|---|---|
| `app/api/export/monthly/route.ts` | Create — new API endpoint |
| `app/page.tsx` | Modify — add `handleMonthlyExport` and button |

---

### Task 1: Create `/api/export/monthly` route

**Files:**
- Create: `app/api/export/monthly/route.ts`

- [ ] **Step 1: Create the file with auth, param validation and month boundary calculation**

```ts
/**
 * GET /api/export/monthly?month=YYYY-MM
 * Returns full-month attendance data for calendar export.
 * ADMIN sees all; USER sees their departments only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isExcludedEmployeeCode } from '@/lib/employees';
import { toLocalDateString } from '@/lib/utils';
import { prisma } from '@/lib/prisma';
import sql from 'mssql';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Μη εξουσιοδοτημένος' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const monthParam = searchParams.get('month');

  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return NextResponse.json(
      { error: 'Απαιτείται παράμετρος month σε μορφή YYYY-MM' },
      { status: 400 }
    );
  }

  const [year, month] = monthParam.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
  const monthEnd   = new Date(year, month, 1, 0, 0, 0); // exclusive upper bound

  const monthStartStr = toLocalDateString(monthStart);
  const monthEndStr   = toLocalDateString(new Date(year, month - 1, new Date(year, month, 0).getDate()));

  try {
    const pool = await getPool();

    // ── Dept filter ──────────────────────────────────────────────────────────
    let deptFilter = '';
    const empRequest = pool.request();
    empRequest.input('monthStart', sql.Date, monthStart);

    if (session.role === 'USER' && session.departments.length > 0) {
      const placeholders = session.departments.map((_, i) => `@dept${i}`).join(', ');
      session.departments.forEach((code, i) => {
        empRequest.input(`dept${i}`, sql.NVarChar, code);
      });
      deptFilter = `AND e.[TMHMA] IN (${placeholders})`;
    } else if (session.role === 'USER' && session.departments.length === 0) {
      return NextResponse.json({ employees: [], attendance: {}, actions: {} });
    }

    // ── Queries 1, 2, 3 in parallel ─────────────────────────────────────────
    const attRequest = pool.request();
    attRequest.input('monthStart', sql.DateTime, monthStart);
    attRequest.input('monthEnd',   sql.DateTime, monthEnd);

    const [empResult, attResult, dbActions] = await Promise.all([
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
    ]);

    // ── Build response maps ──────────────────────────────────────────────────
    type EmpRow = { code: string; surname: string; name: string; department: string | null };
    const employees: EmpRow[] = empResult.recordset
      .filter((e: EmpRow) => !isExcludedEmployeeCode(e.code));

    type AttRow = { code: string; entryDate: Date | string; timeIn: string | null; timeOut: string | null };
    const attendance: Record<string, { code: string; timeIn: string | null; timeOut: string | null }[]> = {};
    for (const row of attResult.recordset as AttRow[]) {
      const dateStr = typeof row.entryDate === 'string'
        ? row.entryDate.slice(0, 10)
        : toLocalDateString(row.entryDate);
      if (!attendance[dateStr]) attendance[dateStr] = [];
      attendance[dateStr].push({ code: row.code, timeIn: row.timeIn as string | null, timeOut: row.timeOut as string | null });
    }

    const actions: Record<string, { employeeCode: string; action: string }[]> = {};
    for (const act of dbActions) {
      if (!actions[act.date]) actions[act.date] = [];
      actions[act.date].push({ employeeCode: act.employeeCode, action: act.action });
    }

    return NextResponse.json({ employees, attendance, actions });
  } catch (err) {
    console.error('[GET /api/export/monthly]', err);
    return NextResponse.json(
      { error: 'Σφάλμα σύνδεσης με τη βάση δεδομένων ERP' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the file was created correctly**

```bash
cat app/api/export/monthly/route.ts | head -20
```

Expected: sees the JSDoc comment and imports.

- [ ] **Step 3: Commit**

```bash
git add app/api/export/monthly/route.ts
git commit -m "feat: add /api/export/monthly endpoint for calendar export"
```

---

### Task 2: Add monthly export handler and button in `page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the `handleMonthlyExport` function**

In `app/page.tsx`, add the following function after the existing `handleExport` function (around line 452):

```ts
async function handleMonthlyExport() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const today = toLocalDateString(now);

  try {
    const res = await fetch(`/api/export/monthly?month=${monthStr}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Σφάλμα εξαγωγής');

    const XLSX = await import('xlsx');

    const daysInMonth = new Date(year, month, 0).getDate();
    const dates: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const STATUS_CODE: Record<string, string> = {
      PRESENT:  '1',
      LEAVE:    'A',
      SICK:     'ΑΓ',
      DAYOFF:   'R',
      REMOTE:   'ΤΗΛ',
      ABSENT:   '0',
      REJECTED: 'ΑΑ',
    };

    type EmpRow = { code: string; surname: string; name: string; department: string | null };
    type ActEntry = { employeeCode: string; action: string };
    type AttEntry = { code: string };

    const rows = (data.employees as EmpRow[]).map((emp) => {
      const row: Record<string, string> = {
        'Κωδικός': emp.code,
        'Επώνυμο': emp.surname,
        'Όνομα':   emp.name,
        'Τμήμα':   emp.department ?? '',
      };

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
          row[colHeader] = dayAtt.some((a) => a.code === emp.code) ? '1' : '';
        }
      }

      return row;
    });

    const GREEK_MONTHS = [
      'Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος',
      'Μάιος','Ιούνιος','Ιούλιος','Αύγουστος',
      'Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος',
    ];

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Παρουσιολόγιο');

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Παρουσιολόγιο_${GREEK_MONTHS[month - 1]}_${year}.xlsx`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast({
      title: 'Σφάλμα εξαγωγής',
      description: err instanceof Error ? err.message : 'Δεν ήταν δυνατή η λήψη του αρχείου',
      variant: 'destructive',
    });
  }
}
```

- [ ] **Step 2: Add the "Εξαγωγή Μηνός" button**

In `app/page.tsx`, find the existing export button (around line 538):

```tsx
          <Button
            variant="outline"
            className="ml-auto"
            onClick={handleExport}
            disabled={loading || filteredRows.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Εξαγωγή σε Excel
          </Button>
```

Replace with:

```tsx
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={handleMonthlyExport}
              disabled={loading}
            >
              <Download className="h-4 w-4 mr-2" />
              Εξαγωγή Μηνός
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={loading || filteredRows.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Εξαγωγή σε Excel
            </Button>
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add monthly calendar Excel export"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test the API directly**

Open browser or use curl:
```
http://localhost:3000/api/export/monthly?month=2026-04
```
Expected: JSON with `employees` array, `attendance` object keyed by date, `actions` object keyed by date.

- [ ] **Step 3: Test the button**

Click "Εξαγωγή Μηνός". Verify:
- File downloads as `Παρουσιολόγιο_Απρίλιος_2026.xlsx`
- First 4 columns: Κωδικός, Επώνυμο, Όνομα, Τμήμα
- Remaining columns: `01/04/2026`, `02/04/2026`, ... `30/04/2026`
- Days with card entries show `1`
- Days with manager actions show the correct code (A, ΑΓ, R, ΤΗΛ, ΑΑ, 0)
- Future dates (after today) are blank
- Past dates with no data are blank

- [ ] **Step 4: Test invalid month param**

```
http://localhost:3000/api/export/monthly?month=bad
```
Expected: 400 response with error message.

- [ ] **Step 5: Verify existing single-date export still works**

Click "Εξαγωγή σε Excel" (original button). Verify it still exports the current tab's filtered rows for the selected date.
