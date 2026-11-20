import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStaffResponseEvents, STAFF_RESPONSE_WINDOW_DAYS } from "@/hooks/useStaffResponseEvents";

/** ST2-16: staff accept/decline answers from the last week, newest first. */
export default function StaffResponsesCard() {
  const { data, error } = useStaffResponseEvents();

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-sm text-destructive">
          Could not load staff answers: {error instanceof Error ? error.message : String(error)}
        </CardContent>
      </Card>
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Staff answers (last {STAFF_RESPONSE_WINDOW_DAYS} days)</CardTitle>
        <p className="text-sm text-muted-foreground">A decline means the booking needs someone else.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((e) => (
          <Link
            key={e.id}
            to={`/admin/bookings/${e.booking_id}`}
            className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50"
          >
            {e.response === "accepted" ? (
              <Badge className="bg-green-100 text-green-800 border-green-300">Accepted</Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800 border-red-300">Declined</Badge>
            )}
            <span className="font-medium">{e.staff_name}</span>
            {e.role && <span className="text-muted-foreground">({e.role})</span>}
            <span className="text-muted-foreground">
              {e.reservation_number ?? "Booking"}
              {e.event_date ? ` · event ${format(new Date(e.event_date + "T00:00:00"), "MM/dd/yyyy")}` : ""}
            </span>
            {e.recorded_by_office && <Badge variant="outline">recorded by the office</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">{format(new Date(e.created_at), "MM/dd h:mm a")}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
