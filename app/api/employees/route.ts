/**
 * GET /api/employees?date=YYYY-MM-DD
 * Returns employees active on the given date from ERP.
 * ADMIN sees all; USER sees their departments only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isExcludedEmployeeCode } from '@/lib/employees';
import { toLocalDateString } from '@/lib/utils';
import sql from 'mssql';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Μη εξουσιοδοτημένος' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date') ?? toLocalDateString(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || isNaN(new Date(dateParam).getTime())) {
    return NextResponse.json(
      { error: 'Απαιτείται παράμετρος date σε μορφή YYYY-MM-DD' },
      { status: 400 }
    );
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    const [y, m, d] = dateParam.split('-').map(Number);
    request.input('targetDate', sql.Date, new Date(y, m - 1, d));

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
      return NextResponse.json({ employees: [] });
    }

    const result = await request.query(`
      SELECT
        e.[ID_EMP]     AS id_emp,
        e.[SURNAME]    AS surname,
        e.[NAME]       AS name,
        e.[CODE]       AS code,
        t.[DESCR]      AS department,
        e.[COD_YPOKAT] AS subCategory,
        e.[HRDATE]     AS hrDate,
        e.[FRDATE]     AS frDate
      FROM [PYLON].[dbo].[vSEM_EMPS] e
      LEFT JOIN [PYLON].[dbo].[TMIMATA_apasx] t ON e.[TMHMA] = t.[TMHMA]
      WHERE e.[ISACTIVE] = 1
        AND e.[HRDATE] <= @targetDate
        AND (e.[FRDATE] IS NULL OR e.[FRDATE] >= @targetDate)
        ${deptFilter}
      ORDER BY e.[SURNAME], e.[NAME]
    `);

    return NextResponse.json({
      employees: result.recordset.filter((employee: { code: string }) => !isExcludedEmployeeCode(employee.code)),
    });
  } catch (err) {
    console.error('[GET /api/employees]', err);
    return NextResponse.json(
      { error: 'Σφάλμα σύνδεσης με τη βάση δεδομένων ERP' },
      { status: 500 }
    );
  }
}
