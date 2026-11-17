// E-9 (86e40ach2): flag unpaid add-on invoices that bill the same booking the
// same amount more than once (CNZQVC had 3 x $596). All but the newest are
// marked, so the office voids the older copies.

export interface AddonLike {
  id: string;
  booking_id: string;
  total_amount: number | string | null;
  created_at: string;
}

export function duplicateAddonIds(rows: AddonLike[]): Set<string> {
  const groups = new Map<string, AddonLike[]>();
  for (const r of rows) {
    const key = `${r.booking_id}|${Number(r.total_amount ?? 0).toFixed(2)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const r of sorted.slice(1)) out.add(r.id);
  }
  return out;
}
