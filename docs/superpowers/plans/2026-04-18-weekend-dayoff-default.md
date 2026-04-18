# Weekend Dayoff Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Saturdays and Sundays, employees with no card entry and no manager action default to `DAYOFF` status instead of `UNKNOWN`; Sunday DAYOFF defaults are hidden from the absences tab.

**Architecture:** Two targeted changes to `app/page.tsx` — add a `dayOfWeek` variable inside `fetchData` before the merge loop, update the status else-branch, and update the `absenceRows` useMemo filter to exclude Sunday defaults.

**Tech Stack:** Next.js, React, TypeScript

---

## File Map

| File | Action | What changes |
|---|---|---|
| `app/page.tsx` | **Modify** | Status computation (~line 230) + absenceRows filter (~line 356) |

---

### Task 1: Add `dayOfWeek` and update status computation in `fetchData`

**Files:**
- Modify: `app/page.tsx` ~lines 228–237

- [ ] **Step 1: Add `dayOfWeek` computation before the status block**

Inside `fetchData`, locate the line just before the status computation block (~line 228). The current code looks like:

```typescript
      let status: PresenceRow['status'];
      if (act) {
        status = act.action;
      } else if (card) {
        status = 'PRESENT';
      } else {
        status = 'UNKNOWN';
      }
```

Replace with:

```typescript
      const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 6 = Saturday
      let status: PresenceRow['status'];
      if (act) {
        status = act.action;
      } else if (card) {
        status = 'PRESENT';
      } else if (dayOfWeek === 0 || dayOfWeek === 6) {
        status = 'DAYOFF';
      } else {
        status = 'UNKNOWN';
      }
```

Note: `date` is the parameter of `fetchData(date: string)` — use it, not `selectedDate`, so the computation is consistent with the data being fetched.

- [ ] **Step 2: Verify TypeScript is clean**

```bash
cd "/Users/stavroulap./Downloads/vs code projects/presence-app"
npx tsc --noEmit
```

Expected: only the 2 pre-existing errors in `app/api/actions/route.ts`. No new errors.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: default weekend employees to DAYOFF when no hit"
```

---

### Task 2: Update `absenceRows` filter to hide Sunday DAYOFF defaults

**Files:**
- Modify: `app/page.tsx` ~lines 356–359

- [ ] **Step 1: Update the `absenceRows` useMemo**

Locate the current `absenceRows` definition (~lines 356–359):

```typescript
const absenceRows = useMemo(
  () => baseFiltered.filter((r) => !r.hasCardEntry),
  [baseFiltered]
);
```

Replace with:

```typescript
const absenceRows = useMemo(() => {
  const dow = new Date(selectedDate).getDay();
  return baseFiltered.filter(
    (r) =>
      !r.hasCardEntry &&
      !(dow === 0 && !r.actionId && !r.hasCardEntry)
  );
}, [baseFiltered, selectedDate]);
```

This hides rows that are simultaneously: Sunday (`dow === 0`), have no card entry, and have no manager action. Saturday rows with no hit remain visible.

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: only the 2 pre-existing errors in `app/api/actions/route.ts`. No new errors.

- [ ] **Step 3: Verify visually with the dev server**

```bash
npm run dev
```

Open http://localhost:3000 and check:

**Navigate to a Sunday date:**
- Absences tab should show NO rows for employees with no card entry and no manager action (they are hidden)
- If any employee has a manager-set DAYOFF, they still appear
- Presences tab is unaffected

**Navigate to a Saturday date:**
- Absences tab should show employees with no card entry and no manager action, each with status `DAYOFF` (Ρεπό)
- Their row colour should match the existing DAYOFF styling (`faf5ff` purple tint)

**Navigate to a weekday date:**
- Behaviour is unchanged — employees without a hit show `UNKNOWN` status

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: hide Sunday DAYOFF defaults from absences tab"
```
