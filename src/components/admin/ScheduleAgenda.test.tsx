import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ScheduleAgenda } from "./ScheduleAgenda";
import { agendaDays, type ScheduleEvent } from "@/lib/scheduleAgenda";

const booking = (over: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  type: "booking",
  id: "b1",
  title: "Keshie Zoar",
  subtitle: "Birthday Party • 40 guests",
  time: "14:00",
  color: "bg-green-500",
  linkTo: "/admin/bookings/b1",
  bookingOrigin: "website",
  ...over,
});

const d = (s: string) => new Date(`${s}T00:00:00`);

describe("agendaDays (UI2-4)", () => {
  const days = [d("2026-10-31"), d("2026-11-01"), d("2026-11-02"), d("2026-11-03")];
  const eventsFor = (day: Date) => (day.getDate() === 2 || day.getDate() === 31 ? [booking()] : []);

  it("month view lists only days of that month that have events", () => {
    const out = agendaDays(days, eventsFor, "month", d("2026-11-15"));
    expect(out.map((g) => g.day.getDate())).toEqual([2]);
  });

  it("week view lists every day, empty ones included", () => {
    const out = agendaDays(days, eventsFor, "week", d("2026-11-01"));
    expect(out).toHaveLength(4);
    expect(out.filter((g) => g.events.length).length).toBe(2);
  });
});

describe("ScheduleAgenda (UI2-4)", () => {
  it("shows name, time and origin, and links to the booking", () => {
    render(
      <MemoryRouter>
        <ScheduleAgenda
          groups={[{ day: d("2026-11-20"), events: [booking(), booking({ id: "x", type: "block", title: "Blackout", time: "Block", linkTo: "#", bookingOrigin: undefined })] }]}
          emptyLabel="Nothing"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Keshie Zoar")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByText("WEB")).toBeInTheDocument();
    expect(screen.getByText("Keshie Zoar").closest("a")).toHaveAttribute("href", "/admin/bookings/b1");
    // A block with no booking is shown but is not a dead link.
    expect(screen.getByText("Blackout").closest("a")).toBeNull();
    expect(screen.getByText("BLOCK")).toBeInTheDocument();
  });

  it("says so when nothing is scheduled", () => {
    render(
      <MemoryRouter>
        <ScheduleAgenda groups={[]} emptyLabel="Nothing scheduled this month." />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nothing scheduled this month.")).toBeInTheDocument();
  });
});
