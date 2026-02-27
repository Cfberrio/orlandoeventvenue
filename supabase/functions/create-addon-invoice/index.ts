import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PACKAGE_LABELS: Record<string, string> = {
  none: "Services Only",
  basic: "Basic Package",
  led: "LED Package",
  workshop: "Workshop Package",
};

interface AddonInvoiceRequest {
  invoice_id: string;
  customer_email: string;
  customer_name: string;
  event_date: string;
  reservation_number: string;
}

function buildInvoiceEmailHTML(
  customerName: string,
  reservationNumber: string,
  eventDate: string,
  lineItems: { label: string; amount: string }[],
  totalAmount: string,
  paymentUrl: string
): string {
  const firstName = customerName.split(" ")[0];
  const formattedDate = new Date(eventDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const itemRows = lineItems
    .map(
      (item) =>
        `<tr>
<td style="padding:8px 0;color:#666;">${item.label}</td>
<td style="padding:8px 0;text-align:right;"><strong>${item.amount}</strong></td>
</tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:30px;color:white;">
<h1 style="margin:0;font-size:24px;">Additional Services</h1>
<p style="margin:10px 0 0;">We've added new services to your upcoming event.</p>
<p style="margin:10px 0 0;font-size:12px;">Reservation ${reservationNumber}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
Great news! Additional services have been added to your event on <strong>${formattedDate}</strong>. Here's a quick breakdown of what's been included:
</p>

<table width="100%" style="margin:20px 0;border-collapse:collapse;">
<tr style="border-bottom:1px solid #ddd;">
<td style="padding:8px 0;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Service</td>
<td style="padding:8px 0;text-align:right;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Amount</td>
</tr>
${itemRows}
<tr style="border-top:2px solid #111827;">
<td style="padding:12px 0;font-weight:bold;font-size:16px;">Total Due</td>
<td style="padding:12px 0;text-align:right;font-weight:bold;font-size:16px;">${totalAmount}</td>
</tr>
</table>

<p style="margin:20px 0;font-size:15px;line-height:1.6;">
To confirm these add-ons, please complete payment using the button below. Once paid, everything will be set for your event day!
</p>

<div style="text-align:center;margin:30px 0;">
<a href="${paymentUrl}" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Complete Payment</a>
</div>

<p style="font-size:12px;color:#999;text-align:center;line-height:1.5;">
If the button doesn't work, copy and paste this link:<br/>
<a href="${paymentUrl}" style="color:#d97706;word-break:break-all;">${paymentUrl}</a>
</p>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;">
If you have any questions about these services, just reply to this email and we'll be happy to help.
</p>

<p style="margin:10px 0 0;"><strong>Orlando Event Venue Team</strong></p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email - please keep it for your records.</p>
</div>

</div>
</body>
</html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { invoice_id, customer_email, customer_name, event_date, reservation_number }: AddonInvoiceRequest =
      await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing addon invoice:", invoice_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: invoice, error: invoiceError } = await supabase
      .from("booking_addon_invoices")
      .select("*")
      .eq("id", invoice_id)
      .single();

    if (invoiceError || !invoice) {
      console.error("Invoice not found:", invoiceError);
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key");
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const emailLineItems: { label: string; amount: string }[] = [];

    if (invoice.package !== "none" && Number(invoice.package_cost) > 0) {
      const packageLabel = PACKAGE_LABELS[invoice.package] || invoice.package;
      let hours = 0;
      if (invoice.package_start_time && invoice.package_end_time) {
        const start = new Date(`2000-01-01T${invoice.package_start_time}`);
        const end = new Date(`2000-01-01T${invoice.package_end_time}`);
        hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      const description = hours > 0 ? `${packageLabel} (${hours}h)` : packageLabel;

      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: description,
            description: `Production package for event on ${event_date}`,
          },
          unit_amount: Math.round(Number(invoice.package_cost) * 100),
        },
        quantity: 1,
      });
      emailLineItems.push({ label: description, amount: `$${Number(invoice.package_cost).toFixed(2)}` });
    }

    if (invoice.setup_breakdown) {
      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Setup & Breakdown of Chairs/Tables" },
          unit_amount: 10000,
        },
        quantity: 1,
      });
      emailLineItems.push({ label: "Setup & Breakdown", amount: "$100.00" });
    }

    if (invoice.tablecloths && Number(invoice.tablecloth_quantity) > 0) {
      const tableclothTotal = Number(invoice.tablecloth_quantity) * 5 + 25;
      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `Tablecloth Rental (${invoice.tablecloth_quantity} tablecloths)`,
            description: `${invoice.tablecloth_quantity} x $5 + $25 cleaning fee`,
          },
          unit_amount: Math.round(tableclothTotal * 100),
        },
        quantity: 1,
      });
      emailLineItems.push({
        label: `Tablecloths (${invoice.tablecloth_quantity} x $5 + $25 cleaning)`,
        amount: `$${tableclothTotal.toFixed(2)}`,
      });
    }

    if (stripeLineItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items to charge" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name,
        metadata: { booking_id: invoice.booking_id },
      });
      customerId = newCustomer.id;
    }

    const origin = Deno.env.get("FRONTEND_URL") || "https://vsvsgesgqjtwutadcshi.lovable.app";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: "payment",
      success_url: `${origin}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}&booking_id=${invoice.booking_id}&type=addon`,
      cancel_url: `${origin}/booking-confirmation?cancelled=true&booking_id=${invoice.booking_id}&type=addon`,
      metadata: {
        booking_id: invoice.booking_id,
        invoice_id: invoice.id,
        payment_type: "addon_invoice",
        reservation_number: reservation_number || "",
      },
    });

    console.log("Stripe checkout session created:", session.id, "URL:", session.url);

    const { error: updateError } = await supabase
      .from("booking_addon_invoices")
      .update({
        payment_url: session.url,
        stripe_session_id: session.id,
      })
      .eq("id", invoice.id);

    if (updateError) {
      console.error("Error updating invoice with payment URL:", updateError);
    }

    // Send email with payment link
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

    if (gmailUser && gmailPassword && session.url) {
      try {
        const client = new SMTPClient({
          connection: {
            hostname: "smtp.gmail.com",
            port: 465,
            tls: true,
            auth: { username: gmailUser, password: gmailPassword },
          },
        });

        const totalFormatted = `$${Number(invoice.total_amount).toFixed(2)}`;
        const emailHTML = buildInvoiceEmailHTML(
          customer_name,
          reservation_number,
          event_date,
          emailLineItems,
          totalFormatted,
          session.url
        );

        await client.send({
          from: gmailUser,
          to: customer_email,
          subject: `Additional Services Invoice – ${reservation_number} | Orlando Event Venue`,
          content: `You have a new invoice of ${totalFormatted} for additional services. Pay here: ${session.url}`,
          html: emailHTML,
        });

        await client.close();
        console.log("Invoice email sent to:", customer_email);
      } catch (emailError) {
        console.error("Error sending invoice email:", emailError);
      }
    } else {
      console.warn("Gmail credentials not configured, skipping invoice email");
    }

    // Log the event
    await supabase.from("booking_events").insert({
      booking_id: invoice.booking_id,
      event_type: "addon_invoice_created",
      channel: "admin",
      metadata: {
        invoice_id: invoice.id,
        total_amount: invoice.total_amount,
        stripe_session_id: session.id,
        payment_url: session.url,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: session.url,
        session_id: session.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in create-addon-invoice:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
