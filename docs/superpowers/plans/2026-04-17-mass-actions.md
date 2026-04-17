# Mass Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow managers to select multiple employees via checkboxes and apply one action to all of them at once for the displayed date.

**Architecture:** All changes are in `app/page.tsx`. Two new state variables (`selectedCodes`, `massActioning`), a `handleMassAction` function that fires parallel POSTs to the existing `/api/actions` endpoint, a checkbox column in the table, and a mass action bar that appears between the filters row and the table when any rows are selected.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, shadcn/ui Checkbox (`@/components/ui/checkbox`), existing `POST /api/actions` endpoint

---

## File Map

| File | Change |
|---|---|
| `app/page.tsx` | Modify — add state, effect, handler, checkbox column, action bar, code font fix |

---

### Task 1: Add state, clear-on-change effect, and `handleMassAction`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `Checkbox` import and two new state variables**

Open `app/page.tsx`. Find the import block at the top. Add `Checkbox` to the component imports. It is not currently imported:

```tsx
import { Checkbox } from '@/components/ui/checkbox';
```

Then find the state block (around line 125). After the existing `monthlyExporting` state declaration (line 145), add:

```ts
// Mass actions
const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
const [massActioning, setMassActioning] = useState(false);
```

- [ ] **Step 2: Add a `useEffect` to clear selection on date or tab change**

In `app/page.tsx`, find the `useEffect` calls in the data-fetching section. Add this effect after them:

```ts
useEffect(() => {
  setSelectedCodes(new Set());
}, [selectedDate, activeTab]);
```

- [ ] **Step 3: Add `handleMassAction` function**

In `app/page.tsx`, find `handleDeleteAction` (ends around line 414). Add the following function directly after it, before the `// ── Excel export` comment:

```ts
async function handleMassAction(action: ActionType) {
  setMassActioning(true);
  const codes = Array.from(selectedCodes);

  const results = await Promise.allSettled(
    codes.map((employeeCode) =>
      fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeCode, date: selectedDate, action }),
      }).then((r) => {
        if (!r.ok) throw new Error();
      })
    )
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed    = results.filter((r) => r.status === 'rejected').length;

  if (failed === 0) {
    toast({ title: `Ενέργεια εφαρμόστηκε σε ${succeeded} εργαζόμενους` });
  } else {
    toast({
      title: `${succeeded} επιτυχίες, ${failed} αποτυχίες`,
      variant: 'destructive',
    });
  }

  setSelectedCodes(new Set());
  setMassActioning(false);
  fetchData(selectedDate, true);
}
```

- [ ] **Step 4: Verify the file compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to these additions).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add mass action state and handler"
```

---

### Task 2: Add checkbox column, mass action bar, and fix code column font

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add two derived values for checkbox header state**

In `app/page.tsx`, find the derived values block (around line 340, where `filteredRows`, `summary`, etc. are computed). Add these two derived booleans directly after `const filteredRows = ...`:

```ts
const allVisibleSelected =
  filteredRows.length > 0 && filteredRows.every((r) => selectedCodes.has(r.code));
const someSelected = filteredRows.some((r) => selectedCodes.has(r.code));
```

- [ ] **Step 2: Add checkbox `<TableHead>` as the first column**

In `app/page.tsx`, find the `<TableHeader>` block (around line 672):

```tsx
<TableRow className="bg-muted/50">
  <TableHead className="w-24">Κωδικός</TableHead>
```

Replace with:

```tsx
<TableRow className="bg-muted/50">
  <TableHead className="w-10">
    <Checkbox
      checked={allVisibleSelected ? true : someSelected ? 'indeterminate' : false}
      onCheckedChange={(checked) => {
        if (checked) {
          setSelectedCodes(new Set(filteredRows.map((r) => r.code)));
        } else {
          setSelectedCodes(new Set());
        }
      }}
    />
  </TableHead>
  <TableHead className="w-24">Κωδικός</TableHead>
```

- [ ] **Step 3: Update skeleton row and empty-state colSpan counts**

Adding a checkbox column increases the column count by 1.

Find the skeleton row (around line 693):
```tsx
{Array.from({ length: isPresenceTab ? 8 : 6 }).map((_, j) => (
```
Change to:
```tsx
{Array.from({ length: isPresenceTab ? 9 : 7 }).map((_, j) => (
```

Find the empty-state row (around line 703):
```tsx
colSpan={isPresenceTab ? 8 : 6}
```
Change to:
```tsx
colSpan={isPresenceTab ? 9 : 7}
```

- [ ] **Step 4: Add checkbox `<TableCell>` as the first cell in each data row**

In `app/page.tsx`, find the data row rendering (around line 715):

```tsx
<TableRow
  key={`${row.code}-${row.date}`}
  className={`${rowClass(row.status)} hover:brightness-95 transition-all`}
>
  <TableCell className="font-mono text-xs text-muted-foreground">
    {row.code}
  </TableCell>
```

Replace with:

```tsx
<TableRow
  key={`${row.code}-${row.date}`}
  className={`${rowClass(row.status)} hover:brightness-95 transition-all`}
>
  <TableCell>
    <Checkbox
      checked={selectedCodes.has(row.code)}
      onCheckedChange={(checked) => {
        setSelectedCodes((prev) => {
          const next = new Set(prev);
          if (checked) next.add(row.code);
          else next.delete(row.code);
          return next;
        });
      }}
    />
  </TableCell>
  <TableCell className="text-sm text-muted-foreground">
    {row.code}
  </TableCell>
```

Note: the code cell className changes from `font-mono text-xs text-muted-foreground` to `text-sm text-muted-foreground` — this removes the monospace font and matches the visual weight of the name columns.

- [ ] **Step 5: Add the mass action bar between the filters row and the summary bar**

In `app/page.tsx`, find the comment `{/* ── Summary bar */}` (around line 664). Insert the mass action bar directly before it:

```tsx
{/* ── Mass action bar ──────────────────────────────────────── */}
{selectedCodes.size > 0 && (
  <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
    <span className="text-sm font-medium text-muted-foreground">
      {selectedCodes.size} επιλεγμένοι
    </span>
    <div className="ml-auto flex flex-wrap gap-2">
      {(
        [
          ['PRESENT',  'Παρών'],
          ['LEAVE',    'Άδεια'],
          ['SICK',     'Ασθένεια'],
          ['DAYOFF',   'Ρεπό'],
          ['REMOTE',   'Τηλεργασία'],
          ['ABSENT',   'Απουσία'],
          ['REJECTED', 'Απόρριψη'],
        ] as [ActionType, string][]
      ).map(([actionType, label]) => (
        <Button
          key={actionType}
          variant="outline"
          size="sm"
          disabled={massActioning}
          onClick={() => handleMassAction(actionType)}
        >
          {label}
        </Button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 6: Verify the file compiles**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add mass action checkbox column, action bar, and fix code column font"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app" && npm run dev
```

- [ ] **Step 2: Verify checkboxes appear**

Open the app. Confirm:
- A checkbox column appears as the first column in the table (both Presences and Absences tabs).
- The header checkbox is unchecked when no rows are selected.

- [ ] **Step 3: Verify select-all**

Click the header checkbox. Confirm:
- All visible rows become checked.
- The mass action bar appears above the table showing "X επιλεγμένοι" and 7 action buttons.
- Click the header checkbox again — all rows deselect and the bar disappears.

- [ ] **Step 4: Verify department-based bulk action**

Filter by a specific department. Click the header checkbox (selects only the visible filtered rows). Click an action button (e.g. "Άδεια"). Confirm:
- A toast appears with "Ενέργεια εφαρμόστηκε σε X εργαζόμενους".
- Selection clears.
- Table refreshes showing the new action status for the affected employees.

- [ ] **Step 5: Verify overwrite behaviour**

Select an employee who already has an action. Apply a different action via mass action. Confirm the action is updated (not skipped).

- [ ] **Step 6: Verify selection clears on date change**

Select some rows. Change the date. Confirm all checkboxes are cleared.

- [ ] **Step 7: Verify selection clears on tab switch**

Select some rows on the Presences tab. Switch to Absences. Confirm checkboxes are cleared.

- [ ] **Step 8: Verify code column font**

Confirm the employee code column now uses the same font as the name columns (no monospace).

- [ ] **Step 9: Verify existing features unaffected**

- Single action dialog (Pencil button) still works.
- Delete action (Trash button) still works.
- Daily and monthly Excel export still work.
