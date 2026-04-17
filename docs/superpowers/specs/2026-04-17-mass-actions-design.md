# Mass Actions Design

**Date:** 2026-04-17
**Topic:** Bulk action application to multiple employees

---

## Goal

Allow managers to select multiple employees in the presence table and apply the same action to all of them at once for the displayed date. Selection can be done row-by-row or by filtering to a department and using select-all.

---

## Status Codes

Same seven action types as single actions:

| ActionType | Display label |
|---|---|
| PRESENT | Παρών |
| LEAVE | Άδεια |
| SICK | Ασθένεια |
| DAYOFF | Ρεπό |
| REMOTE | Τηλεργασία |
| ABSENT | Απουσία |
| REJECTED | Απόρριψη |

---

## Architecture

### No new API endpoint

`POST /api/actions` already upserts one action per employee per day. Mass actions reuse it directly: one parallel request per selected employee. No batch endpoint needed.

### Only one file changes

`app/page.tsx` — new state, new checkbox column, new action bar, new handler, code column style fix.

---

## State

```ts
const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
```

- Cleared when `selectedDate` changes.
- Cleared when `activeTab` changes.
- Cleared after a successful mass action.

---

## Checkbox Column

- First column in both `<TableHeader>` and each `<TableRow>`.
- Uses the existing `Checkbox` component (`@/components/ui/checkbox`).
- **Header checkbox behaviour:**
  - All visible rows selected → checked
  - Some visible rows selected → indeterminate (`checked="indeterminate"` on the Radix checkbox)
  - None selected → unchecked
  - Click when all selected → deselect all
  - Click when some or none selected → select all visible rows (by `code`)
- **Row checkbox behaviour:**
  - Toggles the employee's `code` in/out of `selectedCodes`.
- "Visible rows" means `filteredRows` — the rows currently rendered after tab, search, and department filters are applied.

---

## Mass Action Bar

Rendered between the filters row and the `<Table>` when `selectedCodes.size > 0`.

```
[ 3 επιλεγμένοι ]  [ Παρών ] [ Άδεια ] [ Ασθένεια ] [ Ρεπό ] [ Τηλεργασία ] [ Απουσία ] [ Απόρριψη ]
```

- All 7 action buttons rendered as `<Button variant="outline" size="sm">`.
- Buttons are disabled while `massActioning` is true (in-flight guard).
- The bar disappears when selection drops to zero.

---

## `handleMassAction(action: ActionType)`

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
      }).then((r) => { if (!r.ok) throw new Error(); })
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

- `massActioning: boolean` state guards against double-submission.
- Overwrites any existing action in the local DB (upsert behaviour of the existing endpoint).
- Never touches PYLON — all writes go to the local Prisma DB only.
- No note field — mass actions are note-free.

---

## Code Column Styling

The employee code (`Κωδικός`) column currently renders with monospace/code font styling. Change it to match the name columns — same font family, same weight, no special styling.

---

## What Does Not Change

- Single-action dialog — untouched.
- Delete action — untouched.
- All API routes — untouched.
- Monthly and daily export — untouched.
- Department filter, search, tab navigation — untouched (they continue to control which rows are visible, which indirectly controls what "select all" selects).
