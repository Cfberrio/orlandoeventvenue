import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type State = "working" | "done" | "not_found" | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CM2-12 (ClickUp 86e40ach2): one-click opt-out from the Event Planning Kit
 * emails. The link carries an opaque per-lead token; unsubscribe_lead is
 * idempotent and the only writer of popup_leads.unsubscribed_at.
 */
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const [state, setState] = useState<State>("working");

  useEffect(() => {
    if (!UUID_RE.test(token)) {
      setState("not_found");
      return;
    }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("unsubscribe_lead", { p_token: token });
      if (cancelled) return;
      if (error) setState("error");
      else setState(data?.ok ? "done" : "not_found");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copy: Record<State, { title: string; body: string }> = {
    working: { title: "One moment…", body: "Updating your email preferences." },
    done: {
      title: "You're unsubscribed",
      body: "You won't get more Event Planning Kit emails from Orlando Event Venue. Booking emails for a reservation you make still arrive.",
    },
    not_found: {
      title: "Link not recognized",
      body: "This unsubscribe link is incomplete or expired. Reply to any of our emails and we'll remove you by hand.",
    },
    error: {
      title: "Something went wrong",
      body: "We couldn't update your preferences right now. Please try the link again in a few minutes.",
    },
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">{copy[state].title}</h1>
        <p className="mt-3 text-muted-foreground">{copy[state].body}</p>
        <Link to="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to orlandoeventvenue.org
        </Link>
      </div>
    </main>
  );
}
