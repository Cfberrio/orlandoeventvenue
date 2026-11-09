import { CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BookingReadiness } from "@/hooks/useAdminData";
import { describeReadiness } from "@/lib/bookingReadiness";

const BADGE_CLASS: Record<string, string> = {
  ready: "bg-green-100 text-green-800 border-green-300",
  not_ready: "bg-yellow-100 text-yellow-800 border-yellow-300",
  past: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

interface Props {
  lifecycleStatus: string;
  readiness: BookingReadiness | null | undefined;
  onMarkChecklistComplete: () => void;
  marking?: boolean;
}

/**
 * Pre-event status as the lifecycle sees it (ClickUp 86e3zjfq6): shows the
 * unmet requirements instead of an unconditional "Ready for Event".
 */
export default function PreEventReadinessCard({
  lifecycleStatus,
  readiness,
  onMarkChecklistComplete,
  marking,
}: Props) {
  const view = describeReadiness(lifecycleStatus, readiness);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          Pre-Event Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={`${BADGE_CLASS[view.badge]} text-base px-4 py-1`}
            data-testid="pre-event-badge"
          >
            {view.label}
          </Badge>
        </div>

        {view.badge !== "past" && view.badge !== "unknown" && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p data-testid="checklist-status">{view.checklistLabel}</p>
            {view.staffLabel && <p data-testid="staff-status">{view.staffLabel}</p>}
          </div>
        )}

        {view.unmet.length > 0 && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:bg-yellow-950/20">
            <p className="text-sm font-medium">Still needed before Pre-Event Ready:</p>
            <ul className="mt-1 list-disc pl-5 text-sm" data-testid="unmet-list">
              {view.unmet.map((u) => (
                <li key={u.code}>{u.message}</li>
              ))}
            </ul>
            {view.waitingOnStaff && (
              <p className="mt-2 text-xs text-muted-foreground">
                Updates automatically as soon as staff respond.
              </p>
            )}
          </div>
        )}

        {view.waitingOnGhl && (
          <p className="text-sm text-muted-foreground" data-testid="waiting-ghl">
            All requirements met. The booking moves to Pre-Event Ready automatically in a few
            seconds; this card refreshes on its own.
          </p>
        )}

        {view.showMarkChecklist && (
          <Button onClick={onMarkChecklistComplete} size="lg" className="mt-2" disabled={marking}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark checklist complete
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
