import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  subDays,
  format,
} from "date-fns";

import PayrollDateRangePicker from "./PayrollDateRangePicker";

// Freeze the system clock to a known date so preset assertions are deterministic.
const FROZEN_NOW = new Date(2026, 5, 2, 12, 0, 0); // 2026-06-02 12:00 (Tue)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

describe("PayrollDateRangePicker — presets", () => {
  it('preset "Esta semana" emits Mon..Sun of current week', async () => {
    const onChange = vi.fn();
    render(
      <PayrollDateRangePicker
        startDate={startOfMonth(FROZEN_NOW)}
        endDate={endOfMonth(FROZEN_NOW)}
        onChange={onChange}
      />,
    );

    // Two preset buttons render (sidebar + chip row). Click the chip in the visible bottom row.
    const buttons = screen.getAllByRole("button", { name: "Esta semana" });
    await userEvent.setup().click(buttons[0]);

    expect(onChange).toHaveBeenCalledTimes(1);
    const { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe(
      fmt(startOfWeek(FROZEN_NOW, { weekStartsOn: 1 })),
    );
    expect(fmt(endDate)).toBe(fmt(endOfWeek(FROZEN_NOW, { weekStartsOn: 1 })));
  });

  it('preset "Semana pasada" emits last Mon..Sun', async () => {
    const onChange = vi.fn();
    render(
      <PayrollDateRangePicker
        startDate={startOfMonth(FROZEN_NOW)}
        endDate={endOfMonth(FROZEN_NOW)}
        onChange={onChange}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Semana pasada" });
    await userEvent.setup().click(buttons[0]);

    const lw = subWeeks(FROZEN_NOW, 1);
    const { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe(fmt(startOfWeek(lw, { weekStartsOn: 1 })));
    expect(fmt(endDate)).toBe(fmt(endOfWeek(lw, { weekStartsOn: 1 })));
  });

  it('preset "Este mes" emits 1st..last of current month', async () => {
    const onChange = vi.fn();
    render(
      <PayrollDateRangePicker
        startDate={subDays(FROZEN_NOW, 5)}
        endDate={FROZEN_NOW}
        onChange={onChange}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Este mes" });
    await userEvent.setup().click(buttons[0]);

    const { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe(fmt(startOfMonth(FROZEN_NOW)));
    expect(fmt(endDate)).toBe(fmt(endOfMonth(FROZEN_NOW)));
  });

  it('preset "Mes pasado" emits 1st..last of last month', async () => {
    const onChange = vi.fn();
    render(
      <PayrollDateRangePicker
        startDate={FROZEN_NOW}
        endDate={FROZEN_NOW}
        onChange={onChange}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Mes pasado" });
    await userEvent.setup().click(buttons[0]);

    const lm = subMonths(FROZEN_NOW, 1);
    const { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe(fmt(startOfMonth(lm)));
    expect(fmt(endDate)).toBe(fmt(endOfMonth(lm)));
  });

  it('preset "Últimos 30 días" emits today-29..today', async () => {
    const onChange = vi.fn();
    render(
      <PayrollDateRangePicker
        startDate={FROZEN_NOW}
        endDate={FROZEN_NOW}
        onChange={onChange}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Últimos 30 días" });
    await userEvent.setup().click(buttons[0]);

    const { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe(fmt(subDays(FROZEN_NOW, 29)));
    expect(fmt(endDate)).toBe(fmt(FROZEN_NOW));
  });

  it("prev/next chevrons shift range by its size", async () => {
    const onChange = vi.fn();
    const start = new Date(2026, 5, 2); // 2026-06-02
    const end = new Date(2026, 5, 8); // 2026-06-08 — 7 day range

    render(
      <PayrollDateRangePicker
        startDate={start}
        endDate={end}
        onChange={onChange}
      />,
    );

    const prev = screen.getByTitle("Período anterior");
    const next = screen.getByTitle("Período siguiente");

    const user = userEvent.setup();
    await user.click(next);
    let { startDate, endDate } = onChange.mock.calls[0][0];
    expect(fmt(startDate)).toBe("2026-06-09");
    expect(fmt(endDate)).toBe("2026-06-15");

    onChange.mockClear();
    await user.click(prev);
    ({ startDate, endDate } = onChange.mock.calls[0][0]);
    expect(fmt(startDate)).toBe("2026-05-26");
    expect(fmt(endDate)).toBe("2026-06-01");
  });
});
