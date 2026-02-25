import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CreateInvoiceRequest {
  invoice_id: string;
  customer_email: string;
  customer_name?: string;
}

function buildInvoiceEmailHTML(
  customerName: string,
  invoiceNumber: string,
  title: string,
  description: string | null,
  amount: string,
  paymentUrl: string
): string {
  const firstName = customerName ? customerName.split(" ")[0] : "Customer";
  const descBlock = description
    ? `<p style="margin:15px 0;font-size:14px;color:#666;line-height:1.6;">${description}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:30px;color:white;">
<h1 style="margin:0;font-size:24px;">Invoice</h1>
<p style="margin:10px 0 0;font-size:14px;color:#d4d4d8;">Reference: ${invoiceNumber}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
You have a new invoice from Orlando Event Venue. Please review the details below and complete your payment.
</p>

<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0;">
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">${title}</h2>
${descBlock}
<div style="border-top:2px solid #111827;margin-top:15px;padding-top:15px;display:flex;justify-content:space-between;">
<span style="font-size:14px;color:#666;">Amount Due</span>
<span style="font-size:22px;font-weight:bold;color:#111827;">${amount}</span>
</div>
</div>

<div style="text-align:center;margin:30px 0;">
<a href="${paymentUrl}" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Pay Now</a>
</div>

<p style="font-size:12px;color:#999;text-align:center;line-height:1.5;">
If the button doesn't work, copy and paste this link:<br/>
<a href="${paymentUrl}" style="color:#d97706;word-break:break-all;">${paymentUrl}</a>
</p>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;">
If you have any questions about this invoice, just reply to this email and we'll be happy to help.
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
    const { invoice_id, customer_email, customer_name }: CreateInvoiceRequest =
      await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing standalone invoice:", invoice_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
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

    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name || undefined,
      });
      customerId = newCustomer.id;
    }

    const origin = Deno.env.get("FRONTEND_URL") || "https://vsvsgesgqjtwutadcshi.lovable.app";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: invoice.title,
              description: invoice.description || undefined,
            },
            unit_amount: Math.round(Number(invoice.amount) * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/invoice-paid?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice.id}`,
      cancel_url: `${origin}/invoice-cancelled?invoice_id=${invoice.id}`,
      metadata: {
        invoice_id: invoice.id,
        payment_type: "standalone_invoice",
        invoice_number: invoice.invoice_number,
      },
    });

    console.log("Stripe checkout session created:", session.id, "URL:", session.url);

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        payment_url: session.url,
        stripe_session_id: session.id,
      })
      .eq("id", invoice.id);

    if (updateError) {
      console.error("Error updating invoice with payment URL:", updateError);
    }

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

        const amountFormatted = `$${Number(invoice.amount).toFixed(2)}`;
        const emailHTML = buildInvoiceEmailHTML(
          customer_name || invoice.customer_name || "Customer",
          invoice.invoice_number,
          invoice.title,
          invoice.description,
          amountFormatted,
          session.url
        );

        await client.send({
          from: gmailUser,
          to: customer_email,
          subject: `Invoice ${invoice.invoice_number} – ${amountFormatted} | Orlando Event Venue`,
          content: `You have a new invoice of ${amountFormatted} from Orlando Event Venue. Pay here: ${session.url}`,
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

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: session.url,
        session_id: session.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in create-invoice:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
