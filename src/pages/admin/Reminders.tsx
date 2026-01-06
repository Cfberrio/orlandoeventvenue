import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bell, CheckCircle, XCircle, Star } from "lucide-react";
import { useUpcomingBookingsForReminders, usePastBookingsForReviews, useCreateBookingEvent } from "@/hooks/useAdminData";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "react-router-dom";

export default function Reminders() {
  const { toast } = useToast();
  const { data: upcomingData, isLoading: loadingUpcoming } = useUpcomingBookingsForReminders(7);
  const { data: pastData, isLoading: loadingPast } = usePastBookingsForReviews(30);
  const createEvent = useCreateBookingEvent();

  const handleLogEvent = async (bookingId: string, eventType: string) => {
    try {
      await createEvent.mutateAsync({
        booking_id: bookingId,
        event_type: eventType,
        channel: "system",
        metadata: { logged_at: new Date().toISOString() },
      });
      toast({ title: `${eventType.replace(/_/g, " ")} logged` });
    } catch {
      toast({ title: "Failed to log event", variant: "destructive" });
    }
  };

  const hasEvent = (bookingId: string, eventType: string) => {
    return upcomingData?.events.some((e) => e.booking_id === bookingId && e.event_type === eventType) || false;
  };

  const hasReviewRequest = (bookingId: string) => {
    return pastData?.events.some((e) => e.booking_id === bookingId && e.event_type === "review_request_sent") || false;
  };

  const hasReview = (bookingId: string) => {
    return pastData?.reviews.some((r) => r.booking_id === bookingId) || false;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Reminders & Automations</h1>

      {/* Upcoming Events Requiring Messages */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Upcoming Events (Next 7 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUpcoming ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : upcomingData?.bookings.length === 0 ? (
            <p className="text-muted-foreground">No upcoming bookings in the next 7 days</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Confirmation</TableHead>
                    <TableHead>72h</TableHead>
                    <TableHead>24h</TableHead>
                    <TableHead>3h</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingData?.bookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                          {format(new Date(booking.event_date + 'T00:00:00'), "MMM d")}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                          {booking.full_name}
                        </Link>
                      </TableCell>
                      <TableCell>{booking.event_type}</TableCell>
                      <TableCell>${Number(booking.total_amount).toLocaleString()}</TableCell>
                      <TableCell>
                        {hasEvent(booking.id, "confirmation_sent") ? (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        {hasEvent(booking.id, "reminder_72h") ? (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        {hasEvent(booking.id, "reminder_24h") ? (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        {hasEvent(booking.id, "reminder_3h") ? (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {!hasEvent(booking.id, "confirmation_sent") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLogEvent(booking.id, "confirmation_sent")}
                            >
                              Log Confirm
                            </Button>
                          )}
                          {!hasEvent(booking.id, "reminder_72h") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLogEvent(booking.id, "reminder_72h")}
                            >
                              Log 72h
                            </Button>
                          )}
                          {!hasEvent(booking.id, "reminder_24h") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLogEvent(booking.id, "reminder_24h")}
                            >
                              Log 24h
                            </Button>
                          )}
                          {!hasEvent(booking.id, "reminder_3h") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLogEvent(booking.id, "reminder_3h")}
                            >
                              Log 3h
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" />
            Review Requests (Past 30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingPast ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : pastData?.bookings.length === 0 ? (
            <p className="text-muted-foreground">No past bookings in the last 30 days</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Review Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pastData?.bookings.map((booking) => {
                    const review = pastData.reviews.find((r) => r.booking_id === booking.id);
                    return (
                      <TableRow key={booking.id}>
                        <TableCell>
                          <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                            {format(new Date(booking.event_date + 'T00:00:00'), "MMM d")}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                            {booking.full_name}
                          </Link>
                        </TableCell>
                        <TableCell>{booking.event_type}</TableCell>
                        <TableCell>
                          {review ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="default">Reviewed</Badge>
                              <span className="text-sm">
                                {review.rating}/5 - {review.source}
                              </span>
                            </div>
                          ) : hasReviewRequest(booking.id) ? (
                            <Badge variant="secondary">Request Sent</Badge>
                          ) : (
                            <Badge variant="outline">No Review</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!hasReview(booking.id) && !hasReviewRequest(booking.id) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLogEvent(booking.id, "review_request_sent")}
                            >
                              Log Review Request
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
