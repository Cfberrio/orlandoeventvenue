import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { totalCheckableItems } from "@/lib/planningKitContent";

const STORAGE_KEY = "oev_planning_kit_v1";
const SAVE_DEBOUNCE_MS = 400;

export type KitState = {
  /** `${checklistId}:${index}` -> checked */
  checks: Record<string, boolean>;
  /** `${worksheetId}:${row}:${column}` -> typed value */
  fields: Record<string, string>;
  /** Host details typed at the top of the kit */
  meta: { eventName: string; eventDate: string; guestCount: string };
};

const EMPTY: KitState = {
  checks: {},
  fields: {},
  meta: { eventName: "", eventDate: "", guestCount: "" },
};

function load(): KitState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      checks: parsed?.checks && typeof parsed.checks === "object" ? parsed.checks : {},
      fields: parsed?.fields && typeof parsed.fields === "object" ? parsed.fields : {},
      meta: { ...EMPTY.meta, ...(parsed?.meta ?? {}) },
    };
  } catch {
    // Corrupt or unavailable storage must not take the page down.
    return EMPTY;
  }
}

export function usePlanningKitState() {
  const [state, setState] = useState<KitState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    setState(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSavedAt(Date.now());
      } catch {
        // Private mode or a full quota: the kit still works, it just will not persist.
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [state, hydrated]);

  const toggleCheck = useCallback((id: string, index: number) => {
    const key = `${id}:${index}`;
    setState((prev) => ({ ...prev, checks: { ...prev.checks, [key]: !prev.checks[key] } }));
  }, []);

  const setField = useCallback((id: string, row: number, column: number, value: string) => {
    const key = `${id}:${row}:${column}`;
    setState((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  }, []);

  const setMeta = useCallback((key: keyof KitState["meta"], value: string) => {
    setState((prev) => ({ ...prev, meta: { ...prev.meta, [key]: value } }));
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const progress = useMemo(() => {
    const total = totalCheckableItems();
    const done = Object.values(state.checks).filter(Boolean).length;
    const filled = Object.values(state.fields).filter((v) => v.trim() !== "").length;
    return { done, total, filled, hasAnything: done > 0 || filled > 0 };
  }, [state]);

  return { state, hydrated, savedAt, progress, toggleCheck, setField, setMeta, reset };
}
