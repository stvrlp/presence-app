'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TopNav, type NavTab } from '@/components/TopNav';
import { SummaryBar } from '@/components/SummaryBar';
import { ActionDialog } from '@/components/ActionDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatTime, toLocalDateString } from '@/lib/utils';
import type { PresenceRow, ActionType, StatusSummary } from '@/lib/types';
import type { SessionUser } from '@/lib/auth';
import {
  Download,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString(): string {
  return toLocalDateString(new Date());
}

function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

type DisplayStatus = ActionType | 'UNKNOWN';

interface StatusConfig {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
}

const STATUS_MAP: Record<DisplayStatus, StatusConfig> = {
  PRESENT: {
    label: 'Παρών',
    variant: 'default',
    className: 'bg-green-600 hover:bg-green-600 text-white border-transparent',
  },
  REJECTED: {
    label: 'Απόρριψη',
    variant: 'destructive',
    className: 'bg-red-600 hover:bg-red-600 text-white border-transparent',
  },
  LEAVE: {
    label: 'Άδεια',
    variant: 'outline',
    className: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  SICK: {
    label: 'Ασθένεια',
    variant: 'outline',
    className: 'bg-orange-100 text-orange-800 border-orange-300',
  },
  ABSENT: {
    label: 'Απουσία',
    variant: 'destructive',
    className: 'bg-red-100 text-red-800 border-red-300',
  },
  REMOTE: {
    label: 'Τηλεργασία',
    variant: 'outline',
    className: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  DAYOFF: {
    label: 'Ρεπό',
    variant: 'outline',
    className: 'bg-purple-100 text-purple-800 border-purple-300',
  },
  UNKNOWN: {
    label: 'Εκκρεμής',
    variant: 'outline',
    className: 'bg-gray-100 text-gray-600 border-gray-300',
  },
};

function rowClass(status: DisplayStatus): string {
  switch (status) {
    case 'PRESENT':  return 'row-present';
    case 'LEAVE':
    case 'SICK':     return 'row-leave';
    case 'ABSENT':
    case 'REJECTED': return 'row-absent';
    case 'REMOTE':   return 'row-remote';
    case 'DAYOFF':   return 'row-dayoff';
    default:         return 'row-unknown';
  }
}

const GREEK_MONTHS = [
  'Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος',
  'Μάιος','Ιούνιος','Ιούλιος','Αύγουστος',
  'Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος',
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PresencePage() {
  const { toast } = useToast();

  // ── State ────────────────────────────────────────────────────────────────
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('presences');
  const [selectedDate, setSelectedDate] = useState<string>(todayString());
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  // Action dialog
  const [dialogRow, setDialogRow] = useState<PresenceRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Delete loading state per row
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Monthly export in-flight guard
  const [monthlyExporting, setMonthlyExporting] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchData = useCallback(
    async (date: string, silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      try {
        const [empRes, attRes, actRes] = await Promise.all([
          fetch(`/api/employees?date=${date}`),
          fetch(`/api/attendance?date=${date}`),
          fetch(`/api/actions?date=${date}`),
        ]);

        const [empData, attData, actData] = await Promise.all([
          empRes.json(),
          attRes.json(),
          actRes.json(),
        ]);

        if (!empRes.ok) throw new Error(empData.error ?? 'Σφάλμα φόρτωσης εργαζομένων');
        if (!attRes.ok) throw new Error(attData.error ?? 'Σφάλμα φόρτωσης παρουσιών');
        if (!actRes.ok) throw new Error(actData.error ?? 'Σφάλμα φόρτωσης ενεργειών');

        type AttEntry = {
          code: string;
          surname: string;
          name: string;
          department: string | null;
          timeIn: string | null;
          timeOut: string | null;
        };
        const cardMap = new Map<string, AttEntry>();
        for (const entry of attData.entries as AttEntry[]) {
          cardMap.set(entry.code, entry);
        }

        type ActRecord = {
          id: string;
          employeeCode: string;
          action: ActionType;
          note: string | null;
          managerId: string;
        };
        const actionMap = new Map<string, ActRecord>();
        for (const act of actData.actions as ActRecord[]) {
          actionMap.set(act.employeeCode, act);
        }

        type EmpRecord = {
          code: string;
          surname: string;
          name: string;
          department: string | null;
        };

        // Deduplicate employees by code
        const empMap = new Map<string, EmpRecord>();
        for (const emp of empData.employees as EmpRecord[]) {
          if (!empMap.has(emp.code)) empMap.set(emp.code, emp);
        }

        const merged: PresenceRow[] = Array.from(empMap.values()).map((emp) => {
          const card = cardMap.get(emp.code);
          const act  = actionMap.get(emp.code);

          let status: PresenceRow['status'];
          if (act) {
            status = act.action;
          } else if (card) {
            status = 'PRESENT';
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
            actionId:  act?.id ?? null,
            action:    act?.action ?? null,
            actionNote: act?.note ?? null,
            managerId:  act?.managerId ?? null,
            status,
          };
        });

        // Add card entries for employees not in the active list (ex-employees)
        for (const [code, card] of Array.from(cardMap.entries())) {
          if (!merged.find((r) => r.code === code)) {
            const act = actionMap.get(code);
            merged.push({
              code,
              surname: card.surname,
              name: card.name,
              department: card.department,
              hasCardEntry: true,
              timeIn:  formatTime(card.timeIn),
              timeOut: formatTime(card.timeOut),
              date,
              actionId:  act?.id ?? null,
              action:    act?.action ?? null,
              actionNote: act?.note ?? null,
              managerId:  act?.managerId ?? null,
              status: act ? act.action : 'PRESENT',
            });
          }
        }

        merged.sort((a, b) =>
          a.surname.localeCompare(b.surname, 'el') ||
          a.name.localeCompare(b.name, 'el')
        );

        setRows(merged);
      } catch (err) {
        toast({
          title: 'Σφάλμα',
          description: err instanceof Error ? err.message : 'Άγνωστο σφάλμα',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast]
  );

  // Fetch session user on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setSessionUser(data.user as SessionUser);
          // Pre-filter to first dept for USER role
          if (data.user.role === 'USER' && data.user.departments?.length > 0) {
            setDeptFilter(data.user.departments[0]);
          }
        }
      });
  }, []);

  useEffect(() => {
    fetchData(selectedDate);
  }, [selectedDate, fetchData]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.department) set.add(r.department);
    }
    const all = Array.from(set).sort((a, b) => a.localeCompare(b, 'el'));
    // USER role: restrict to their assigned departments only
    if (sessionUser?.role === 'USER' && sessionUser.departments.length > 0) {
      // departments in our list are descr strings; we can only show what's in rows
      return all;
    }
    return all;
  }, [rows, sessionUser]);

  // Search + dept filter applied to all rows
  const baseFiltered = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return rows.filter((r) => {
      const matchDept = deptFilter === 'ALL' || r.department === deptFilter;
      const matchSearch =
        !search ||
        r.surname.toLowerCase().includes(search) ||
        r.name.toLowerCase().includes(search) ||
        r.code.toLowerCase().includes(search);
      return matchDept && matchSearch;
    });
  }, [rows, searchText, deptFilter]);

  // Split by tab
  const presenceRows = useMemo(
    () => baseFiltered.filter((r) => r.hasCardEntry),
    [baseFiltered]
  );
  const absenceRows = useMemo(
    () => baseFiltered.filter((r) => !r.hasCardEntry),
    [baseFiltered]
  );

  const filteredRows = activeTab === 'presences' ? presenceRows : absenceRows;

  const summary = useMemo<StatusSummary>(() => {
    let present = 0, leave = 0, sick = 0, absent = 0, remote = 0, dayoff = 0, unknown = 0;
    for (const r of filteredRows) {
      switch (r.status) {
        case 'PRESENT':  present++; break;
        case 'REJECTED': absent++;  break;
        case 'LEAVE':    leave++;   break;
        case 'SICK':     sick++;    break;
        case 'ABSENT':   absent++;  break;
        case 'REMOTE':   remote++;  break;
        case 'DAYOFF':   dayoff++;  break;
        default:         unknown++; break;
      }
    }
    return { present, leave, sick, absent, remote, dayoff, unknown };
  }, [filteredRows]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function openDialog(row: PresenceRow) {
    setDialogRow(row);
    setDialogOpen(true);
  }

  function handleActionSaved(row: PresenceRow, action: ActionType, note: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.code === row.code && r.date === row.date
          ? { ...r, action, actionNote: note, status: action }
          : r
      )
    );
    toast({
      title: 'Αποθηκεύτηκε',
      description: `${row.surname} ${row.name} → ${STATUS_MAP[action].label}`,
    });
    fetchData(row.date, true);
  }

  async function handleDeleteAction(row: PresenceRow) {
    if (!row.actionId) return;
    setDeletingId(row.actionId);
    try {
      const res = await fetch(`/api/actions/${row.actionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Σφάλμα διαγραφής');
      }
      setRows((prev) =>
        prev.map((r) =>
          r.code === row.code && r.date === row.date
            ? {
                ...r,
                actionId: null,
                action: null,
                actionNote: null,
                managerId: null,
                status: r.hasCardEntry ? 'PRESENT' : 'UNKNOWN',
              }
            : r
        )
      );
      toast({ title: 'Η ενέργεια αναιρέθηκε' });
    } catch (err) {
      toast({
        title: 'Σφάλμα',
        description: err instanceof Error ? err.message : 'Άγνωστο σφάλμα',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  }

  // ── Excel export ─────────────────────────────────────────────────────────

  async function handleExport() {
    try {
      const XLSX = await import('xlsx');
      const sheetName = activeTab === 'presences' ? 'Παρουσίες' : 'Απουσίες';
      const fileName = `${sheetName}_${formatDisplayDate(selectedDate).replace(/\//g, '-')}.xlsx`;

      const data = filteredRows.map((r) => ({
        'Κωδικός': r.code,
        'Επώνυμο': r.surname,
        'Όνομα': r.name,
        'Τμήμα': r.department ?? '',
        ...(activeTab === 'presences'
          ? { 'Ώρα εισόδου': r.timeIn ?? '—', 'Ώρα εξόδου': r.timeOut ?? '—' }
          : {}),
        'Κατάσταση': STATUS_MAP[r.status].label,
        'Σημείωση': r.actionNote ?? '',
        'Καταχωρήθηκε από': r.managerId ?? '',
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: 'Σφάλμα εξαγωγής',
        description: err instanceof Error ? err.message : 'Δεν ήταν δυνατή η λήψη του Excel αρχείου',
        variant: 'destructive',
      });
    }
  }

  async function handleMonthlyExport() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const today = toLocalDateString(now);

    setMonthlyExporting(true);
    try {
      const res = await fetch(`/api/export/monthly?month=${monthStr}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Σφάλμα εξαγωγής');
      }
      const data = await res.json();

      const XLSX = await import('xlsx');

      const daysInMonth = new Date(year, month, 0).getDate();
      const dates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }

      const STATUS_CODE: Record<ActionType, string> = {
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
            row[colHeader] = dayAtt.some((a) => a.code === emp.code) ? STATUS_CODE.PRESENT : '';
          }
        }

        return row;
      });

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
    } finally {
      setMonthlyExporting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  // Raw counts (unfiltered by search/dept, for tab badges)
  const rawPresenceCount = useMemo(() => rows.filter((r) => r.hasCardEntry).length, [rows]);
  const rawAbsenceCount  = useMemo(() => rows.filter((r) => !r.hasCardEntry).length, [rows]);

  const isPresenceTab = activeTab === 'presences';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        presenceCount={loading ? undefined : rawPresenceCount}
        absenceCount={loading ? undefined : rawAbsenceCount}
        user={sessionUser}
      />

      <main className="flex-1 px-4 sm:px-6 py-6 space-y-5 max-w-screen-2xl mx-auto w-full">

        {/* ── Page title + date picker ─────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {isPresenceTab ? 'Παρουσίες' : 'Απουσίες'}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isPresenceTab
                ? 'Εργαζόμενοι με δεδομένα κινήσεων εισόδου και εξόδου.'
                : 'Εργαζόμενοι χωρίς δεδομένα κινήσεων εισόδου και εξόδου.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Ημερομηνία:
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              max={todayString()}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm text-card-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fetchData(selectedDate, true)}
              disabled={refreshing || loading}
              title="Ανανέωση"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Αναζήτηση ονόματος ή κωδικού..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Όλα τα τμήματα</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={handleMonthlyExport}
              disabled={loading || monthlyExporting}
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
        </div>

        {/* ── Summary bar ─────────────────────────────────────────────── */}
        {!loading && rows.length > 0 && (
          <SummaryBar summary={summary} />
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-24">Κωδικός</TableHead>
                <TableHead>Επώνυμο</TableHead>
                <TableHead>Όνομα</TableHead>
                <TableHead className="hidden md:table-cell">Τμήμα</TableHead>
                {isPresenceTab && (
                  <>
                    <TableHead className="w-28 text-center">Είσοδος</TableHead>
                    <TableHead className="w-28 text-center">Έξοδος</TableHead>
                  </>
                )}
                <TableHead className="w-32 text-center">Κατάσταση</TableHead>
                <TableHead className="w-32 text-right">Ενέργειες</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: isPresenceTab ? 8 : 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isPresenceTab ? 8 : 6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    {rows.length === 0
                      ? 'Δεν βρέθηκαν δεδομένα για την επιλεγμένη ημερομηνία'
                      : 'Δεν βρέθηκαν αποτελέσματα για τα επιλεγμένα φίλτρα'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => {
                  const sc = STATUS_MAP[row.status];
                  return (
                    <TableRow
                      key={`${row.code}-${row.date}`}
                      className={`${rowClass(row.status)} hover:brightness-95 transition-all`}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.code}
                      </TableCell>
                      <TableCell className="font-medium">{row.surname}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {row.department ?? '—'}
                      </TableCell>
                      {isPresenceTab && (
                        <>
                          <TableCell className="text-center font-mono text-sm">
                            {row.timeIn ?? '—'}
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm">
                            {row.timeOut ?? '—'}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="text-center">
                        <Badge className={sc.className}>{sc.label}</Badge>
                        {row.actionNote && (
                          <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px] truncate">
                            {row.actionNote}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDialog(row)}
                            className="h-8 px-2 text-xs"
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Ενέργεια
                          </Button>
                          {row.actionId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteAction(row)}
                              disabled={deletingId === row.actionId}
                              title="Αναίρεση ενέργειας"
                            >
                              {deletingId === row.actionId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && filteredRows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            Εμφανίζονται {filteredRows.length}{' '}
            {isPresenceTab ? 'παρουσίες' : 'απουσίες'}
            {' · '}Ημερομηνία: {formatDisplayDate(selectedDate)}
          </p>
        )}
      </main>

      <ActionDialog
        row={dialogRow}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={(r, a, n) => handleActionSaved(r, a, n)}
      />
    </div>
  );
}
