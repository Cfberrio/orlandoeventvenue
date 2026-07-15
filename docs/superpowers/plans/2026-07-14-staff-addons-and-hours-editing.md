# Staff Addons Visibility (#7) + Staff Hours Editing (#1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assigned staff can see the client's ordered add-ons + their own hours (#7); admins can edit staff hours from a booking, both globally (event hours) and per-person (override), with staff seeing the result on next load (#1).

**Architecture:** Pure logic lives in small tested helpers (`src/lib/bookingAddons.ts`, `src/lib/assignmentHours.ts`). UI is thin: a new staff-side panel and two admin dialogs, each backed by a react-query mutation hook that mirrors existing hooks in `useAdminData.ts`. No new backend/migration — the DB columns (`scheduled_start_time`, `scheduled_end_time`) and RLS (`"Admin and staff can manage assignments" FOR ALL`) already exist.

**Tech Stack:** Vite + React 18 + TypeScript + shadcn/ui + Supabase JS + TanStack Query v5 + Vitest 4 + @testing-library/react (jsdom).

## Global Constraints

- Branch: `feat/staff-addons-hours` (already created; commit here, not `main`).
- Test runner: `npx vitest run <path>` (config auto-discovered; alias `@` → `src`; env jsdom; globals on).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Time values: DB `TIME` columns hold `"HH:MM:SS"`; `<Input type="time">` uses `"HH:MM"`. Prefill inputs with `value.slice(0, 5)`; save the raw `"HH:MM"` string (Postgres coerces). Display with `.slice(0, 5)`.
- No prices/money shown to staff (#7). Panel renders nothing when there are no add-ons.
- Package "none" sentinel: a booking has no AV package when `package` is falsy OR `=== "none"`.
- Production-hours rule (mirror existing): package hours apply only when `assignment_role === "Production"` AND `package` present/not-"none" AND both package times set.
- Follow existing hook pattern: `useMutation` → `supabase.from("booking_staff_assignments")...` → `onSuccess` invalidates `["booking-staff-assignments", bookingId]` and calls `syncToGHL(bookingId)`.

---

### Task 1: `getVisibleAddons` pure helper (#7 logic)

**Files:**
- Create: `src/lib/bookingAddons.ts`
- Test: `src/lib/bookingAddons.test.ts`

**Interfaces:**
- Produces: `getVisibleAddons(booking: AddonSource): AddonItem[]` where
  `AddonItem = { key: string; label: string; detail?: string }` and
  `AddonSource` is the subset of `bookings` fields used below.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bookingAddons.test.ts
import { describe, it, expect } from "vitest";
import { getVisibleAddons } from "./bookingAddons";

const empty = {
  tablecloths: false,
  tablecloth_quantity: 0,
  setup_breakdown: false,
  package: "none",
  package_start_time: null,
  package_end_time: null,
  bar_package: "",
  bar_package_label: null,
  addons_detail: [],
};

describe("getVisibleAddons", () => {
  it("returns [] when the client ordered nothing", () => {
    expect(getVisibleAddons(empty)).toEqual([]);
  });

  it("lists tablecloths with quantity when present", () => {
    const items = getVisibleAddons({ ...empty, tablecloths: true, tablecloth_quantity: 10 });
    expect(items).toEqual([{ key: "tablecloths", label: "Manteles", detail: "10" }]);
  });

  it("lists setup & breakdown when true", () => {
    const items = getVisibleAddons({ ...empty, setup_breakdown: true });
    expect(items).toEqual([{ key: "setup_breakdown", label: "Montaje y desmontaje" }]);
  });

  it("lists the AV package with its hours when set", () => {
    const items = getVisibleAddons({
      ...empty,
      package: "gold",
      package_start_time: "14:00:00",
      package_end_time: "18:00:00",
    });
    expect(items).toEqual([{ key: "package", label: "Paquete AV", detail: "gold (14:00 - 18:00)" }]);
  });

  it("lists the bar package using its label when present", () => {
    const items = getVisibleAddons({ ...empty, bar_package: "premium", bar_package_label: "Premium Bar" });
    expect(items).toEqual([{ key: "bar_package", label: "Bar", detail: "Premium Bar" }]);
  });

  it("includes addons_detail extras not already covered, without amounts", () => {
    const items = getVisibleAddons({
      ...empty,
      addons_detail: [
        { type: "tablecloth", quantity: 10, amount: 50 }, // covered -> skipped
        { type: "photobooth", quantity: 1, amount: 200 }, // extra -> included, no amount
      ],
    });
    expect(items).toEqual([{ key: "addon-photobooth", label: "photobooth", detail: "1" }]);
  });

  it("never exposes a price field", () => {
    const items = getVisibleAddons({ ...empty, tablecloths: true, tablecloth_quantity: 3 });
    expect(JSON.stringify(items)).not.toMatch(/amount|price|\$/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookingAddons.test.ts`
Expected: FAIL — "Failed to resolve import './bookingAddons'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/bookingAddons.ts
export interface AddonItem {
  key: string;
  label: string;
  detail?: string;
}

interface AddonDetailEntry {
  type?: string;
  quantity?: number;
  amount?: number;
}

export interface AddonSource {
  tablecloths?: boolean | null;
  tablecloth_quantity?: number | null;
  setup_breakdown?: boolean | null;
  package?: string | null;
  package_start_time?: string | null;
  package_end_time?: string | null;
  bar_package?: string | null;
  bar_package_label?: string | null;
  addons_detail?: AddonDetailEntry[] | null;
}

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");
const hasPackage = (p?: string | null) => !!p && p !== "none";

// Extras from addons_detail whose type is already represented by a typed column.
const COVERED = ["tablecloth", "setup", "package", "bar"];

export function getVisibleAddons(booking: AddonSource): AddonItem[] {
  const items: AddonItem[] = [];

  if (booking.tablecloths || (booking.tablecloth_quantity ?? 0) > 0) {
    items.push({ key: "tablecloths", label: "Manteles", detail: String(booking.tablecloth_quantity ?? 0) });
  }

  if (booking.setup_breakdown) {
    items.push({ key: "setup_breakdown", label: "Montaje y desmontaje" });
  }

  if (hasPackage(booking.package)) {
    const hours =
      booking.package_start_time && booking.package_end_time
        ? ` (${hhmm(booking.package_start_time)} - ${hhmm(booking.package_end_time)})`
        : "";
    items.push({ key: "package", label: "Paquete AV", detail: `${booking.package}${hours}` });
  }

  if (booking.bar_package && booking.bar_package !== "none" && booking.bar_package.trim() !== "") {
    items.push({ key: "bar_package", label: "Bar", detail: booking.bar_package_label ?? booking.bar_package });
  }

  for (const extra of booking.addons_detail ?? []) {
    const type = (extra.type ?? "").trim();
    if (!type) continue;
    if (COVERED.some((c) => type.toLowerCase().includes(c))) continue;
    items.push({ key: `addon-${type}`, label: type, detail: extra.quantity != null ? String(extra.quantity) : undefined });
  }

  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookingAddons.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingAddons.ts src/lib/bookingAddons.test.ts
git commit -m "feat: getVisibleAddons helper for staff-visible add-ons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `StaffAddonsPanel` + render in staff booking detail (#7 UI)

**Files:**
- Create: `src/components/staff/StaffAddonsPanel.tsx`
- Create: `src/components/staff/StaffAddonsPanel.test.tsx`
- Modify: `src/pages/staff/StaffBookingDetail.tsx` (insert after the Event Information card, which closes at `:207`)

**Interfaces:**
- Consumes: `getVisibleAddons` (Task 1).
- Produces: `<StaffAddonsPanel booking={booking} />` — renders `null` when `getVisibleAddons(booking).length === 0`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/staff/StaffAddonsPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StaffAddonsPanel from "./StaffAddonsPanel";

const base = {
  tablecloths: false, tablecloth_quantity: 0, setup_breakdown: false,
  package: "none", package_start_time: null, package_end_time: null,
  bar_package: "", bar_package_label: null, addons_detail: [],
};

describe("StaffAddonsPanel", () => {
  it("renders nothing when there are no add-ons", () => {
    const { container } = render(<StaffAddonsPanel booking={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows tablecloth quantity and no dollar amount", () => {
    render(<StaffAddonsPanel booking={{ ...base, tablecloths: true, tablecloth_quantity: 10 }} />);
    expect(screen.getByText("Manteles")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/staff/StaffAddonsPanel.test.tsx`
Expected: FAIL — cannot resolve `./StaffAddonsPanel`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/staff/StaffAddonsPanel.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { getVisibleAddons, type AddonSource } from "@/lib/bookingAddons";

export default function StaffAddonsPanel({ booking }: { booking: AddonSource }) {
  const items = getVisibleAddons(booking);
  if (items.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Package className="h-5 w-5" />
          <span>Add-ons del cliente</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{item.label}</span>
              {item.detail && <Badge variant="secondary">{item.detail}</Badge>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the new component test — expect PASS**

Run: `npx vitest run src/components/staff/StaffAddonsPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the panel into the staff booking detail page**

In `src/pages/staff/StaffBookingDetail.tsx`, add the import near the other imports:

```tsx
import StaffAddonsPanel from "@/components/staff/StaffAddonsPanel";
```

Then insert the panel immediately after the Event Information `</Card>` at line 207 (before the Production Hours card comment at line 209):

```tsx
      </Card>

      <StaffAddonsPanel booking={booking} />

      {/* Production Hours Card - Only show for Production staff with package */}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/components/staff/StaffAddonsPanel.test.tsx src/lib/bookingAddons.test.ts`
Expected: no TS errors; PASS. If `booking` has a narrower type that lacks `addons_detail`, cast at the call site: `booking={booking as any}` (the runtime object from `select("*")` carries the fields).

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, log in at `/staff/login`, open a booking that has tablecloths/setup/package. Confirm the "Add-ons del cliente" panel appears with quantities and NO prices. Open a booking with no add-ons → panel absent.

- [ ] **Step 8: Commit**

```bash
git add src/components/staff/StaffAddonsPanel.tsx src/components/staff/StaffAddonsPanel.test.tsx src/pages/staff/StaffBookingDetail.tsx
git commit -m "feat: show client add-ons to assigned staff (#7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `getAssignmentHours` + `isValidTimeRange` (#1 logic)

**Files:**
- Create: `src/lib/assignmentHours.ts`
- Test: `src/lib/assignmentHours.test.ts`

**Interfaces:**
- Produces:
  - `getAssignmentHours(input: AssignmentHoursInput): AssignmentHours`
    where `AssignmentHours = { start: string | null; end: string | null; source: "override" | "package" | "booking" }`.
  - `isValidTimeRange(start: string, end: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assignmentHours.test.ts
import { describe, it, expect } from "vitest";
import { getAssignmentHours, isValidTimeRange } from "./assignmentHours";

const baseInput = {
  scheduledStartTime: null as string | null,
  scheduledEndTime: null as string | null,
  assignmentRole: "Assistant",
  packageName: "none" as string | null,
  packageStartTime: null as string | null,
  packageEndTime: null as string | null,
  bookingStartTime: "17:00:00" as string | null,
  bookingEndTime: "22:00:00" as string | null,
};

describe("getAssignmentHours", () => {
  it("prefers a per-person override when both scheduled times are set", () => {
    expect(getAssignmentHours({ ...baseInput, scheduledStartTime: "14:00:00", scheduledEndTime: "20:00:00" }))
      .toEqual({ start: "14:00:00", end: "20:00:00", source: "override" });
  });

  it("uses package hours for Production with a real package when no override", () => {
    expect(getAssignmentHours({
      ...baseInput, assignmentRole: "Production", packageName: "gold",
      packageStartTime: "15:00:00", packageEndTime: "19:00:00",
    })).toEqual({ start: "15:00:00", end: "19:00:00", source: "package" });
  });

  it("falls back to booking event hours otherwise", () => {
    expect(getAssignmentHours(baseInput)).toEqual({ start: "17:00:00", end: "22:00:00", source: "booking" });
  });

  it("ignores a half-set override (only start) and falls through", () => {
    expect(getAssignmentHours({ ...baseInput, scheduledStartTime: "14:00:00" }).source).toBe("booking");
  });
});

describe("isValidTimeRange", () => {
  it("is true when end is after start", () => {
    expect(isValidTimeRange("14:00", "18:00")).toBe(true);
  });
  it("is false when end equals or precedes start", () => {
    expect(isValidTimeRange("18:00", "18:00")).toBe(false);
    expect(isValidTimeRange("19:00", "18:00")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assignmentHours.test.ts`
Expected: FAIL — cannot resolve `./assignmentHours`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/assignmentHours.ts
export type HoursSource = "override" | "package" | "booking";

export interface AssignmentHours {
  start: string | null;
  end: string | null;
  source: HoursSource;
}

export interface AssignmentHoursInput {
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignmentRole: string;
  packageName: string | null;
  packageStartTime: string | null;
  packageEndTime: string | null;
  bookingStartTime: string | null;
  bookingEndTime: string | null;
}

export function getAssignmentHours(input: AssignmentHoursInput): AssignmentHours {
  if (input.scheduledStartTime && input.scheduledEndTime) {
    return { start: input.scheduledStartTime, end: input.scheduledEndTime, source: "override" };
  }
  const hasPackage = !!input.packageName && input.packageName !== "none";
  if (input.assignmentRole === "Production" && hasPackage && input.packageStartTime && input.packageEndTime) {
    return { start: input.packageStartTime, end: input.packageEndTime, source: "package" };
  }
  return { start: input.bookingStartTime, end: input.bookingEndTime, source: "booking" };
}

// Compares "HH:MM" or "HH:MM:SS" lexicographically (zero-padded 24h → safe).
export function isValidTimeRange(start: string, end: string): boolean {
  if (!start || !end) return false;
  return end > start;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assignmentHours.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assignmentHours.ts src/lib/assignmentHours.test.ts
git commit -m "feat: getAssignmentHours + isValidTimeRange helpers (#1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Global event-hours editor (#1 Part A)

**Files:**
- Modify: `src/hooks/useAdminData.ts` (add `useUpdateBookingTimes`; place after `useDeleteStaffAssignment` at `:1013`)
- Create: `src/components/admin/EventHoursEditDialog.tsx`
- Create: `src/components/admin/EventHoursEditDialog.test.tsx`
- Modify: `src/pages/admin/BookingDetail.tsx` (render the dialog near the Staff Assignments header at `:1408`)

**Interfaces:**
- Consumes: `isValidTimeRange` (Task 3).
- Produces:
  - `useUpdateBookingTimes(): UseMutationResult` — variables `{ bookingId: string; startTime: string; endTime: string }`, updates `bookings.start_time`/`end_time`.
  - `<EventHoursEditDialog bookingId startTime endTime open onOpenChange />`.

- [ ] **Step 1: Add the mutation hook (mirror `useDeleteStaffAssignment`)**

In `src/hooks/useAdminData.ts`, after the closing `}` of `useDeleteStaffAssignment` (line 1013), add:

```ts
export function useUpdateBookingTimes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, startTime, endTime }: { bookingId: string; startTime: string; endTime: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ start_time: startTime, end_time: endTime })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: (_, { bookingId }) => {
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", bookingId] });
      syncToGHL(bookingId);
    },
  });
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// src/components/admin/EventHoursEditDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useAdminData", () => ({ useUpdateBookingTimes: () => ({ mutateAsync, isPending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import EventHoursEditDialog from "./EventHoursEditDialog";

describe("EventHoursEditDialog", () => {
  beforeEach(() => mutateAsync.mockClear());

  it("saves the edited event hours", async () => {
    render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open onOpenChange={() => {}} />);
    const end = screen.getByLabelText(/fin/i);
    await userEvent.clear(end);
    await userEvent.type(end, "23:00");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ bookingId: "b1", startTime: "17:00", endTime: "23:00" }),
    );
  });

  it("blocks saving when end is not after start", async () => {
    render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open onOpenChange={() => {}} />);
    const end = screen.getByLabelText(/fin/i);
    await userEvent.clear(end);
    await userEvent.type(end, "16:00");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/admin/EventHoursEditDialog.test.tsx`
Expected: FAIL — cannot resolve `./EventHoursEditDialog`.

- [ ] **Step 4: Implement the dialog**

```tsx
// src/components/admin/EventHoursEditDialog.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBookingTimes } from "@/hooks/useAdminData";
import { isValidTimeRange } from "@/lib/assignmentHours";

interface Props {
  bookingId: string;
  startTime: string | null;
  endTime: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toInput = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function EventHoursEditDialog({ bookingId, startTime, endTime, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateBookingTimes();
  const [start, setStart] = useState(toInput(startTime));
  const [end, setEnd] = useState(toInput(endTime));

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Horario inválido", description: "La hora de fin debe ser después del inicio.", variant: "destructive" });
      return;
    }
    await mutateAsync({ bookingId, startTime: start, endTime: end });
    toast({ title: "Horario del evento actualizado" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar horario del evento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="event-start">Inicio</Label>
            <Input id="event-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end">Fin</Label>
            <Input id="event-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/admin/EventHoursEditDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire into `BookingDetail.tsx`**

Add imports near the top with the other admin imports:

```tsx
import EventHoursEditDialog from "@/components/admin/EventHoursEditDialog";
```

Add state near the other `useState` hooks in the component body:

```tsx
const [eventHoursOpen, setEventHoursOpen] = useState(false);
```

At the Staff Assignments header (`:1408`, the `👥 Staff Assignments` title row), add an edit button that opens the dialog, e.g. right after the title element:

```tsx
<Button variant="outline" size="sm" onClick={() => setEventHoursOpen(true)}>
  Editar horario del evento
</Button>
```

Render the dialog once inside the returned JSX (near the other dialogs, e.g. after the production dialog around `:2380`):

```tsx
<EventHoursEditDialog
  bookingId={booking.id}
  startTime={booking.start_time}
  endTime={booking.end_time}
  open={eventHoursOpen}
  onOpenChange={setEventHoursOpen}
/>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (`Button`, `useState` are already imported in `BookingDetail.tsx`.)

- [ ] **Step 8: Manual verification**

`npm run dev` → `/admin` → open a booking → Staff Assignments → "Editar horario del evento". Change end time, Guardar. Confirm the "Working Hours" of non-production assignments now reflect the new event hours (after Task 5/6 they use the shared helper; for now the existing derived display already reads `booking.start_time/end_time`). Confirm invalid range (end ≤ start) is blocked with a toast.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAdminData.ts src/components/admin/EventHoursEditDialog.tsx src/components/admin/EventHoursEditDialog.test.tsx src/pages/admin/BookingDetail.tsx
git commit -m "feat: edit event hours from booking (#1 global)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Per-person hours override (#1 Part B)

**Files:**
- Modify: `src/hooks/useAdminData.ts` (add `useUpdateStaffAssignment` after `useUpdateBookingTimes`; extend the `StaffAssignment` type if it lacks `scheduled_start_time`/`scheduled_end_time`)
- Create: `src/components/admin/StaffHoursEditDialog.tsx`
- Create: `src/components/admin/StaffHoursEditDialog.test.tsx`
- Modify: `src/pages/admin/BookingDetail.tsx` (Working Hours cell `:1448-1458` → show `getAssignmentHours` result + edit button; render the dialog + state)

**Interfaces:**
- Consumes: `getAssignmentHours`, `isValidTimeRange` (Task 3).
- Produces:
  - `useUpdateStaffAssignment(): UseMutationResult` — variables
    `{ id: string; bookingId: string; scheduledStartTime: string | null; scheduledEndTime: string | null }`.
  - `<StaffHoursEditDialog assignment bookingId open onOpenChange />`.

- [ ] **Step 1: Add the mutation hook (mirror `useDeleteStaffAssignment`)**

In `src/hooks/useAdminData.ts`, after `useUpdateBookingTimes`, add:

```ts
export function useUpdateStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledStartTime, scheduledEndTime }: {
      id: string; bookingId: string; scheduledStartTime: string | null; scheduledEndTime: string | null;
    }) => {
      const { error } = await supabase
        .from("booking_staff_assignments")
        .update({ scheduled_start_time: scheduledStartTime, scheduled_end_time: scheduledEndTime })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { bookingId }) => {
      queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", bookingId] });
      syncToGHL(bookingId);
    },
  });
}
```

Also ensure the `StaffAssignment` interface in this file includes (add if missing):

```ts
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
```

- [ ] **Step 2: Write the failing component test**

```tsx
// src/components/admin/StaffHoursEditDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useAdminData", () => ({ useUpdateStaffAssignment: () => ({ mutateAsync, isPending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import StaffHoursEditDialog from "./StaffHoursEditDialog";

const assignment = {
  id: "a1", assignment_role: "Assistant",
  scheduled_start_time: null, scheduled_end_time: null,
  booking: { package: "none", package_start_time: null, package_end_time: null, start_time: "17:00:00", end_time: "22:00:00" },
} as any;

describe("StaffHoursEditDialog", () => {
  beforeEach(() => mutateAsync.mockClear());

  it("saves a per-person override", async () => {
    render(<StaffHoursEditDialog assignment={assignment} bookingId="b1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText(/inicio/i), "14:00");
    await userEvent.type(screen.getByLabelText(/fin/i), "20:00");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ id: "a1", bookingId: "b1", scheduledStartTime: "14:00", scheduledEndTime: "20:00" }),
    );
  });

  it("resets to event hours (nulls both fields)", async () => {
    render(<StaffHoursEditDialog assignment={{ ...assignment, scheduled_start_time: "14:00:00", scheduled_end_time: "20:00:00" }} bookingId="b1" open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /restablecer|reset/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ id: "a1", bookingId: "b1", scheduledStartTime: null, scheduledEndTime: null }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/admin/StaffHoursEditDialog.test.tsx`
Expected: FAIL — cannot resolve `./StaffHoursEditDialog`.

- [ ] **Step 4: Implement the dialog**

```tsx
// src/components/admin/StaffHoursEditDialog.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateStaffAssignment } from "@/hooks/useAdminData";
import { getAssignmentHours, isValidTimeRange } from "@/lib/assignmentHours";

interface Props {
  assignment: any;
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toInput = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function StaffHoursEditDialog({ assignment, bookingId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateStaffAssignment();
  const [start, setStart] = useState(toInput(assignment.scheduled_start_time));
  const [end, setEnd] = useState(toInput(assignment.scheduled_end_time));

  const inherited = getAssignmentHours({
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignmentRole: assignment.assignment_role,
    packageName: assignment.booking?.package ?? null,
    packageStartTime: assignment.booking?.package_start_time ?? null,
    packageEndTime: assignment.booking?.package_end_time ?? null,
    bookingStartTime: assignment.booking?.start_time ?? null,
    bookingEndTime: assignment.booking?.end_time ?? null,
  });

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Horario inválido", description: "La hora de fin debe ser después del inicio.", variant: "destructive" });
      return;
    }
    await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: start, scheduledEndTime: end });
    toast({ title: "Horas del staff actualizadas" });
    onOpenChange(false);
  };

  const reset = async () => {
    await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: null, scheduledEndTime: null });
    toast({ title: "Horas restablecidas al horario del evento" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar horas del staff</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Horario heredado del evento: {inherited.start?.slice(0, 5)} – {inherited.end?.slice(0, 5)}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="staff-start">Inicio</Label>
            <Input id="staff-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-end">Fin</Label>
            <Input id="staff-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={reset} disabled={isPending}>Restablecer</Button>
          <Button onClick={save} disabled={isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/admin/StaffHoursEditDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Use the shared helper + add an edit button in the Working Hours cell**

In `src/pages/admin/BookingDetail.tsx`, add imports:

```tsx
import StaffHoursEditDialog from "@/components/admin/StaffHoursEditDialog";
import { getAssignmentHours } from "@/lib/assignmentHours";
```

Add state near the other `useState` hooks:

```tsx
const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
```

Replace the Working Hours `<TableCell>` body (`:1448-1458`) with a version driven by `getAssignmentHours`, keeping the production badge style when `source === "package"` and adding an edit trigger:

```tsx
<TableCell>
  {(() => {
    const h = getAssignmentHours({
      scheduledStartTime: assignment.scheduled_start_time ?? null,
      scheduledEndTime: assignment.scheduled_end_time ?? null,
      assignmentRole: assignment.assignment_role,
      packageName: assignment.booking?.package ?? null,
      packageStartTime: assignment.booking?.package_start_time ?? null,
      packageEndTime: assignment.booking?.package_end_time ?? null,
      bookingStartTime: assignment.booking?.start_time ?? null,
      bookingEndTime: assignment.booking?.end_time ?? null,
    });
    return (
      <div className="flex items-center gap-2">
        {h.source === "package" ? (
          <Badge className="bg-purple-600 text-white flex items-center gap-1 w-fit">
            <span>🎬</span>
            <span>{h.start?.slice(0, 5)} - {h.end?.slice(0, 5)}</span>
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">
            {h.start?.slice(0, 5)} - {h.end?.slice(0, 5)}
          </span>
        )}
        {h.source === "override" && <Badge variant="outline" className="text-xs">custom</Badge>}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingAssignment(assignment)} title="Editar horas">
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  })()}
</TableCell>
```

Ensure `Pencil` is imported from `lucide-react` (add to the existing lucide import if absent). Render the dialog once, after the `EventHoursEditDialog` you added in Task 4:

```tsx
{editingAssignment && (
  <StaffHoursEditDialog
    assignment={editingAssignment}
    bookingId={booking.id}
    open={!!editingAssignment}
    onOpenChange={(o) => !o && setEditingAssignment(null)}
  />
)}
```

- [ ] **Step 7: Typecheck + run the two admin dialog tests**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/components/admin/EventHoursEditDialog.test.tsx src/components/admin/StaffHoursEditDialog.test.tsx`
Expected: no TS errors; PASS (4 tests).

- [ ] **Step 8: Manual verification**

`/admin` → booking → Staff Assignments. For an Assistant row, click the pencil → set 14:00–20:00 → Guardar. Cell shows `14:00 - 20:00` + `custom`. Reopen → Restablecer → cell reverts to event hours, `custom` gone.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAdminData.ts src/components/admin/StaffHoursEditDialog.tsx src/components/admin/StaffHoursEditDialog.test.tsx src/pages/admin/BookingDetail.tsx
git commit -m "feat: per-person staff hours override on booking (#1 override)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Staff sees their effective hours (#1 staff side)

**Files:**
- Modify: `src/hooks/useStaffData.ts` (`useStaffBookingDetail` assignment `select` at ~`:144` — add `scheduled_start_time, scheduled_end_time`)
- Modify: `src/pages/staff/StaffBookingDetail.tsx` (Production Hours card `:210-231` and Assistant Working Hours block `:246-253` → derive via `getAssignmentHours`)

**Interfaces:**
- Consumes: `getAssignmentHours` (Task 3). Relies on the flattened `booking` object exposing `scheduled_start_time`, `scheduled_end_time`, `assignment_role`, `package`, `package_start_time`, `package_end_time`, `start_time`, `end_time`.

- [ ] **Step 1: Add the override columns to the staff select**

In `src/hooks/useStaffData.ts`, find the assignment `select` inside `useStaffBookingDetail` (~`:144`) and add `scheduled_start_time, scheduled_end_time` to the selected assignment columns (alongside `assignment_role, assignment_type, tasks, status`). Confirm they surface on the returned flattened `booking` object (mirror how `assignment_role` is exposed).

- [ ] **Step 2: Derive effective hours in the staff view**

At the top of the render in `StaffBookingDetail.tsx` (after `booking` is available), compute:

```tsx
const effectiveHours = getAssignmentHours({
  scheduledStartTime: (booking as any).scheduled_start_time ?? null,
  scheduledEndTime: (booking as any).scheduled_end_time ?? null,
  assignmentRole: booking.assignment_role,
  packageName: booking.package ?? null,
  packageStartTime: booking.package_start_time ?? null,
  packageEndTime: booking.package_end_time ?? null,
  bookingStartTime: booking.start_time ?? null,
  bookingEndTime: booking.end_time ?? null,
});
```

Add the import: `import { getAssignmentHours } from "@/lib/assignmentHours";`

Replace the hard-coded time strings:
- Production Hours badge (`:224`): `{effectiveHours.start?.slice(0, 5)} - {effectiveHours.end?.slice(0, 5)}`
- Assistant Working Hours (`:250`): `{effectiveHours.start?.slice(0, 5)} – {effectiveHours.end?.slice(0, 5)}`

Keep the existing card-visibility conditions as-is (they decide WHICH card shows); only the displayed times change to the effective hours.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (end-to-end of #1)**

1. Admin: set an Assistant override to 14:00–20:00 (Task 5).
2. Staff: log in as that staff, open the booking → Working Hours shows `14:00 – 20:00`.
3. Admin: Restablecer → Staff (reload/refocus tab) → reverts to event hours.
4. Admin: change event hours (Task 4) → Staff (reload/refocus) → non-override staff reflect the new event hours.

- [ ] **Step 5: Full test + lint gate**

Run: `npx vitest run && npm run lint`
Expected: all tests PASS; lint clean (fix any new warnings in touched files).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useStaffData.ts src/pages/staff/StaffBookingDetail.tsx
git commit -m "feat: staff sees effective (override-aware) hours (#1 staff)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (done before hand-off)

- **Spec coverage:** #7 → Tasks 1–2 (panel, no prices, hidden when empty, all assigned staff). #1 global → Task 4. #1 override → Task 5. #1 staff display + "near real-time" via query invalidation → Task 6. #4/#2 explicitly out of scope. ✅
- **Placeholders:** none — every code/test step is complete. ✅
- **Type consistency:** `getAssignmentHours` input shape identical across Tasks 5 & 6; hook variable names (`scheduledStartTime`/`scheduledEndTime`, `startTime`/`endTime`) consistent between hook defs and dialog call sites; `getVisibleAddons`/`AddonSource` consistent between Tasks 1 & 2. ✅
- **Integration risks (from spec):** `syncToGHL(bookingId)` fires on both new hooks (keeps GHL calendar in sync on hour changes) — matches existing `useDeleteStaffAssignment`. Changing `bookings.start_time/end_time` only updates those columns; verify during Task 4 manual step that no downstream lifecycle assumption breaks. ✅
