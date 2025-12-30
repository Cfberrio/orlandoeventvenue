import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("Stripe_Secret_Key") || "", {
  apiVersion: "2023-10-16",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Helper to sync booking to GHL after payment events.
 */
async function syncToGHL(bookingId: string): Promise<void> {
  const ghlWebhookUrl = Deno.env.get("GHL_BOOKING_WEBHOOK_URL");
  if (!ghlWebhookUrl) {
    console.log("GHL_BOOKING_WEBHOOK_URL not configured, skipping sync");
    return;
  }

  try {
    // Call the sync-to-ghl edge function internally
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-to-ghl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    if (!response.ok) {
      console.error("Failed to sync to GHL:", await response.text());
    } else {
      console.log("Successfully synced booking to GHL:", bookingId);
    }
  } catch (error) {
    console.error("Error syncing to GHL:", error);
    // Don't throw - we don't want to fail the webhook because of GHL sync issues
  }
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature) {
    console.error("No Stripe signature found");
    return new Response("No signature", { status: 400 });
  }

  if (!webhookSecret) {
    console.error("No webhook secret configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  try {
    const body = await req.text();
    
    // Verify webhook signature
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    console.log("Received Stripe event:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;
      const paymentType = session.metadata?.payment_type || "deposit";

      if (!bookingId) {
        console.error("No booking_id in session metadata");
        return new Response("No booking_id", { status: 400 });
      }

      console.log(`Processing ${paymentType} payment for booking:`, bookingId);

      // Create Supabase client with service role key
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      if (paymentType === "balance") {
        // Handle balance payment
        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "fully_paid",
            balance_paid_at: new Date().toISOString(),
          })
          .eq("id", bookingId)
          .select()
          .single();

        if (error) {
          console.error("Error updating booking for balance payment:", error);
          return new Response("Database error", { status: 500 });
        }

        console.log("Booking fully paid:", data);

        // Cancel any pending balance retry jobs since payment is complete
        const { data: cancelledJobs, error: cancelError } = await supabase
          .from("scheduled_jobs")
          .update({
            status: "cancelled",
            last_error: "payment_completed_before_job_run",
            updated_at: new Date().toISOString(),
          })
          .eq("booking_id", bookingId)
          .in("job_type", ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"])
          .eq("status", "pending")
          .select("id, job_type");

        if (cancelError) {
          console.error("Error cancelling pending balance jobs:", cancelError);
        } else if (cancelledJobs && cancelledJobs.length > 0) {
          console.log(`Cancelled ${cancelledJobs.length} pending balance retry jobs:`, cancelledJobs.map(j => j.job_type));
        }

        // Log the balance payment event
        await supabase.from("booking_events").insert({
          booking_id: bookingId,
          event_type: "balance_paid",
          channel: "stripe",
          metadata: {
            session_id: session.id,
            payment_intent: session.payment_intent,
            amount: data.balance_amount,
            cancelled_jobs: cancelledJobs?.map(j => j.job_type) || [],
          },
        });

        // TODO: Send balance payment confirmation email if needed

        // Sync to GHL after balance payment
        await syncToGHL(bookingId);

      } else {
        // Handle deposit payment (existing logic)
        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "deposit_paid",
            deposit_paid_at: new Date().toISOString(),
            stripe_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent,
          })
          .eq("id", bookingId)
          .select()
          .single();

        if (error) {
          console.error("Error updating booking:", error);
          return new Response("Database error", { status: 500 });
        }

        console.log("Booking updated successfully:", data);

        // Send confirmation email
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              email: data.email,
              full_name: data.full_name,
              reservation_number: data.reservation_number,
              event_date: data.event_date,
              event_type: data.event_type,
              number_of_guests: data.number_of_guests,
              booking_type: data.booking_type,
              start_time: data.start_time,
              end_time: data.end_time,
              base_rental: data.base_rental,
              cleaning_fee: data.cleaning_fee,
              package: data.package,
              package_cost: data.package_cost,
              package_start_time: data.package_start_time,
              package_end_time: data.package_end_time,
              setup_breakdown: data.setup_breakdown,
              tablecloths: data.tablecloths,
              tablecloth_quantity: data.tablecloth_quantity,
              optional_services: data.optional_services,
              taxes_fees: data.taxes_fees,
              total_amount: data.total_amount,
              deposit_amount: data.deposit_amount,
              balance_amount: data.balance_amount,
            }),
          });

          if (!emailResponse.ok) {
            console.error("Failed to send confirmation email:", await emailResponse.text());
          } else {
            console.log("Confirmation email sent successfully");
          }
        } catch (emailError) {
          console.error("Error sending confirmation email:", emailError);
          // Don't fail the webhook because of email issues
        }

        // Sync to GHL after successful payment update
        await syncToGHL(bookingId);

        // Schedule balance payment jobs immediately after deposit is paid
        try {
          console.log("Triggering balance payment scheduling for booking:", bookingId);
          const scheduleResponse = await fetch(
            `${supabaseUrl}/functions/v1/schedule-balance-payment`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ booking_id: bookingId }),
            }
          );
          if (!scheduleResponse.ok) {
            console.error("Balance scheduling failed:", await scheduleResponse.text());
          } else {
            const scheduleResult = await scheduleResponse.json();
            console.log("Balance scheduling result:", JSON.stringify(scheduleResult));
          }
        } catch (scheduleError) {
          console.error("Error scheduling balance payment:", scheduleError);
          // Don't fail the webhook - balance can be scheduled later
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    console.error("Webhook error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(`Webhook Error: ${errorMessage}`, { status: 400 });
  }
});
