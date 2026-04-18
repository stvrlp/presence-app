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
import { resolveLeaveType } from '@/lib/leaveTypes';

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

  if (month < 1 || month > 12) {
    return NextResponse.json({ error: 'Μη έγκυρος μήνας' }, { status: 400 });
  }

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

    // ── Queries 1, 2, 3, 4 in parallel ──────────────────────────────────────
    const attRequest = pool.request();
    attRequest.input('monthStart', sql.DateTime, monthStart);
    attRequest.input('monthEnd',   sql.DateTime, monthEnd);

    const leaveRequest = pool.request();
    leaveRequest.input('monthStart', sql.Date, monthStart);
    leaveRequest.input('monthEndDate', sql.Date, new Date(year, month, 0));

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
        LEFT JOIN [PYLON].[dbo].[vSEM_EMPS] e ON a.[ID_EMP] = e.[ID_EMP]
        LEFT JOIN [PYLON].[dbo].[ADEIES_TYPE] t ON a.[ID_TYPE] = t.[ID]
        WHERE a.[START_DATE] <= @monthEndDate
          AND a.[END_DATE]   >= @monthStart
          AND e.[CODE] IS NOT NULL
      `),
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

    const employeeCodes = new Set(employees.map((e) => e.code));

    const parseDateLocal = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    type LeaveRow = { employeeCode: string; description: string; startDate: Date | string; endDate: Date | string };
    const leaves: Record<string, { employeeCode: string; excelCode: string }[]> = {};

    for (const row of leaveResult.recordset as LeaveRow[]) {
      if (!employeeCodes.has(row.employeeCode)) continue;
      const start = typeof row.startDate === 'string' ? row.startDate.slice(0, 10) : toLocalDateString(row.startDate);
      const end   = typeof row.endDate   === 'string' ? row.endDate.slice(0, 10)   : toLocalDateString(row.endDate);
      const { excelCode } = resolveLeaveType(row.description);

      // Clamp to the queried month so cross-month leaves don't emit out-of-month dates
      const clampedStart = start < monthStartStr ? monthStartStr : start;
      const clampedEnd   = end   > monthEndStr   ? monthEndStr   : end;

      let cur = parseDateLocal(clampedStart);
      const endDate = parseDateLocal(clampedEnd);
      while (cur <= endDate) {
        const dateStr = toLocalDateString(cur);
        if (!leaves[dateStr]) leaves[dateStr] = [];
        leaves[dateStr].push({ employeeCode: row.employeeCode, excelCode });
        cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      }
    }

    return NextResponse.json({ employees, attendance, actions, leaves });
  } catch (err) {
    console.error('[GET /api/export/monthly]', err);
    return NextResponse.json(
      { error: 'Σφάλμα σύνδεσης με τη βάση δεδομένων ERP' },
      { status: 500 }
    );
  }
}
