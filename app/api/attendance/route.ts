/**
 * GET /api/attendance?date=YYYY-MM-DD
 * Returns card-reader attendance entries for the given date (read-only from ERP).
 * ADMIN sees all; USER sees their departments only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isExcludedEmployeeCode } from '@/lib/employees';
import sql from 'mssql';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Μη εξουσιοδοτημένος' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date');

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { error: 'Απαιτείται παράμετρος date σε μορφή YYYY-MM-DD' },
      { status: 400 }
    );
  }

  try {
    const pool = await getPool();
    const [y, m, d] = dateParam.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0);
    const dayEnd   = new Date(y, m - 1, d + 1, 0, 0, 0);
    const request = pool.request()
      .input('dayStart', sql.DateTime, dayStart)
      .input('dayEnd',   sql.DateTime, dayEnd);

    let deptFilter = '';
    if (session.role === 'USER' && session.departments.length > 0) {
      const placeholders = session.departments
        .map((_, i) => `@dept${i}`)
        .join(', ');
      session.departments.forEach((code, i) => {
        request.input(`dept${i}`, sql.NVarChar, code);
      });
      deptFilter = `AND e.[TMHMA] IN (${placeholders})`;
    } else if (session.role === 'USER' && session.departments.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    const result = await request.query(`
      SELECT
        e.[CODE]                        AS code,
        e.[SURNAME]                     AS surname,
        e.[NAME]                        AS name,
        t.[DESCR]                       AS department,
        x.[Ημερομηνία]                  AS entryDate,
        x.[Ώρα εισόδου]                 AS timeIn,
        x.[Ώρα εξόδου]                  AS timeOut
      FROM (
        SELECT
          i.[Expr2]                     AS [CARD_CODE],
          CAST(i.[Expr3] AS DATE)       AS [Ημερομηνία],
          MIN(CASE WHEN i.[Expr4] = 1 THEN CAST(i.[Expr3] AS TIME) END) AS [Ώρα εισόδου],
          MAX(CASE WHEN i.[Expr4] = 2 THEN CAST(i.[Expr3] AS TIME) END) AS [Ώρα εξόδου]
        FROM [PYLON].[dbo].[io_10days] i
        WHERE i.[Expr3] >= @dayStart AND i.[Expr3] < @dayEnd
          AND i.[Expr4] IN (1, 2)
        GROUP BY i.[Expr2], CAST(i.[Expr3] AS DATE)
      ) x
      INNER JOIN [PYLON].[dbo].[CARD_CODES] cc ON cc.[CARD_CODE] = x.[CARD_CODE]
        AND cc.[FROM_DATE] <= @dayEnd
        AND (cc.[TO_DATE] IS NULL OR cc.[TO_DATE] >= @dayStart)
      INNER JOIN [PYLON].[dbo].[vSEM_EMPS] e ON e.[ID_EMP] = cc.[ID_EMP]
      LEFT JOIN [PYLON].[dbo].[TMIMATA_apasx] t ON e.[TMHMA] = t.[TMHMA]
      WHERE 1=1 ${deptFilter}
      ORDER BY e.[SURNAME], e.[NAME]
    `);

    return NextResponse.json({
      entries: result.recordset.filter((entry: { code: string }) => !isExcludedEmployeeCode(entry.code)),
    });
  } catch (err) {
    console.error('[GET /api/attendance]', err);
    return NextResponse.json(
      { error: 'Σφάλμα σύνδεσης με τη βάση δεδομένων ERP' },
      { status: 500 }
    );
  }
}
