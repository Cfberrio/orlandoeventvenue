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

interface InvoiceLineItem {
  label: string;
  amount: number;
}

function buildInvoiceEmailHTML(
  customerName: string,
  invoiceNumber: string,
  title: string,
  description: string | null,
  lineItems: InvoiceLineItem[],
  totalAmount: string,
  paymentUrl: string
): string {
  const firstName = customerName ? customerName.split(" ")[0] : "Customer";
  const descBlock = description
    ? `<p style="margin:15px 0 0;font-size:14px;color:#666;line-height:1.6;">${description}</p>`
    : "";

  const itemRows = lineItems
    .map(
      (item) =>
        `<tr>
<td style="padding:8px 0;color:#374151;font-size:14px;">${item.label}</td>
<td style="padding:8px 0;text-align:right;font-size:14px;"><strong>$${Number(item.amount).toFixed(2)}</strong></td>
</tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<div style="background:#111827;padding:40px 30px;text-align:center;color:white;">
  <h1 style="margin:0;font-size:28px;letter-spacing:1px;">INVOICE</h1>
  <p style="margin:12px 0 0;font-size:16px;color:#d4d4d8;">Orlando Event Venue</p>
  <p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">Reference: ${invoiceNumber}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;color:#374151;">
You have a new invoice from Orlando Event Venue. Please review the details below and complete your payment at your earliest convenience.
</p>

<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;margin:25px 0;">
  <h2 style="margin:0 0 4px;font-size:20px;color:#111827;">${title}</h2>
  ${descBlock}

  <table width="100%" style="margin:16px 0 0;border-collapse:collapse;">
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 0;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Service</td>
      <td style="padding:8px 0;text-align:right;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Amount</td>
    </tr>
    ${itemRows}
    <tr style="border-top:2px solid #111827;">
      <td style="padding:12px 0;font-weight:bold;font-size:16px;color:#111827;">Total Due</td>
      <td style="padding:12px 0;text-align:right;font-weight:bold;font-size:22px;color:#111827;">${totalAmount}</td>
    </tr>
  </table>
</div>

<div style="text-align:center;margin:30px 0;">
  <a href="${paymentUrl}" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Pay Now</a>
</div>

<p style="font-size:12px;color:#999;text-align:center;line-height:1.5;">
If the button doesn't work, copy and paste this link:<br/>
<a href="${paymentUrl}" style="color:#d97706;word-break:break-all;">${paymentUrl}</a>
</p>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;color:#374151;">
If you have any questions about this invoice, simply reply to this email and we'll be happy to help.
</p>

<p style="margin:10px 0 0;"><strong>Orlando Event Venue</strong></p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email. Please keep it for your records.</p>
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

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");
    const invoiceAmountCents = Math.round(Number(invoice.amount) * 100);

    // Build Stripe line items from line_items JSON or fall back to single item
    const rawLineItems: InvoiceLineItem[] | null = invoice.line_items;
    let stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (rawLineItems && Array.isArray(rawLineItems) && rawLineItems.length > 0) {
      stripeLineItems = rawLineItems.map((item: InvoiceLineItem) => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.label },
          unit_amount: Math.round(Number(item.amount) * 100),
        },
        quantity: 1,
      }));
    } else {
      stripeLineItems = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: invoice.title,
              description: invoice.description || undefined,
            },
            unit_amount: invoiceAmountCents,
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: "payment",
      success_url: `${origin}/invoice-paid?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice.id}`,
      cancel_url: `${origin}/invoice-cancelled?invoice_id=${invoice.id}`,
      metadata: {
        invoice_id: invoice.id,
        payment_type: "standalone_invoice",
        invoice_number: invoice.invoice_number,
      },
      ...(connectedAccountId ? {
        payment_intent_data: {
          transfer_data: {
            destination: connectedAccountId,
            amount: Math.round(invoiceAmountCents * 0.20),
          },
        },
      } : {}),
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

        // Build email line items for the breakdown
        const emailLineItems: InvoiceLineItem[] =
          rawLineItems && Array.isArray(rawLineItems) && rawLineItems.length > 0
            ? rawLineItems
            : [{ label: invoice.title, amount: Number(invoice.amount) }];

        const emailHTML = buildInvoiceEmailHTML(
          customer_name || invoice.customer_name || "Customer",
          invoice.invoice_number,
          invoice.title,
          invoice.description,
          emailLineItems,
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
