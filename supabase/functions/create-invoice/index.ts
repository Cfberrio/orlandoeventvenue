import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getFrontendUrl } from "../_shared/config.ts";
import {
  BRAND,
  detailTable,
  displayTitle,
  emailShell,
  escapeHtml,
  gap,
  heroModule,
  para,
  primaryButton,
  referenceModule,
  sanitizeForSmtp,
  textModule,
} from "../_shared/email-layout.ts";

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
  const firstName = escapeHtml(customerName ? customerName.split(" ")[0] : "Customer");
  const safeTitle = escapeHtml(title);

  // Copy restored verbatim from the pre-redesign template. Only the layout
  // changed — do not reword, add or remove a visible phrase.
  const detailRows: Array<[string, string]> = [
    ["Service", "Amount"],
    ...lineItems.map(
      (item) => [escapeHtml(item.label), `$${Number(item.amount).toFixed(2)}`] as [string, string],
    ),
    ["Total Due", totalAmount],
  ];

  const body =
    heroModule({
      display: displayTitle("Invoice", { size: 42 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
      para(
        `You have a new invoice from Orlando Event Venue. Please review the details below and complete your payment at your earliest convenience.`,
      ) +
      `<p style="margin:22px 0 0;font-size:20px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">${safeTitle}</p>` +
      (description ? para(escapeHtml(description)) : "") +
      `<div style="margin:16px 0 0;">${detailTable(detailRows)}</div>` +
      primaryButton("Pay Now", paymentUrl) +
      `<p style="margin:14px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND.muted};text-align:center;font-family:Arial,Helvetica,sans-serif;">If the button doesn't work, copy and paste this link:<br><a href="${paymentUrl}" style="word-break:break-all;color:${BRAND.accent};text-decoration:none;">${paymentUrl}</a></p>` +
      para(
        `If you have any questions about this invoice, simply reply to this email and we'll be happy to help.`,
      ) +
      para(`<strong>Orlando Event Venue</strong>`),
    ) +
    gap() +
    referenceModule([["Reference", escapeHtml(invoiceNumber)]]);

  return emailShell({
    title: `Invoice ${invoiceNumber}`,
    preview: "You have a new invoice from Orlando Event Venue.",
    body,
  });
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

    const origin = getFrontendUrl();

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");

    const { data: feeRow, error: feeError } = await supabase
      .from("venue_pricing")
      .select("price")
      .eq("item_key", "processing_fee")
      .eq("is_active", true)
      .single();

    if (feeError) console.error("Failed to fetch processing fee from venue_pricing:", feeError);
    const FEE_PCT = Number(feeRow?.price ?? 3.5);
    const PROCESSING_FEE_RATE = FEE_PCT / 100;
    const FEE_LABEL = `Processing Fee (${FEE_PCT}%)`;

    const invoiceAmountCents = Math.round(Number(invoice.amount) * 100);
    const feeCents = Math.round(invoiceAmountCents * PROCESSING_FEE_RATE);
    const totalWithFeeCents = invoiceAmountCents + feeCents;

    console.log(`Invoice fee: base=${invoiceAmountCents}c, fee=${feeCents}c (${FEE_PCT}%), total=${totalWithFeeCents}c`);

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

    // Add processing fee as separate line item
    stripeLineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: FEE_LABEL },
        unit_amount: feeCents,
      },
      quantity: 1,
    });

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
            amount: Math.round(totalWithFeeCents * 0.20),
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
        processing_fee_pct: FEE_PCT,
        processing_fee: feeCents / 100,
        total_charged: totalWithFeeCents / 100,
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

        const totalWithFeeFormatted = `$${(totalWithFeeCents / 100).toFixed(2)}`;

        // Build email line items for the breakdown (include processing fee)
        const emailLineItems: InvoiceLineItem[] =
          rawLineItems && Array.isArray(rawLineItems) && rawLineItems.length > 0
            ? [...rawLineItems, { label: FEE_LABEL, amount: feeCents / 100 }]
            : [{ label: invoice.title, amount: Number(invoice.amount) }, { label: FEE_LABEL, amount: feeCents / 100 }];

        const emailHTML = sanitizeForSmtp(buildInvoiceEmailHTML(
          customer_name || invoice.customer_name || "Customer",
          invoice.invoice_number,
          invoice.title,
          invoice.description,
          emailLineItems,
          totalWithFeeFormatted,
          session.url
        ));

        await client.send({
          from: gmailUser,
          to: customer_email,
          subject: `Invoice ${invoice.invoice_number}: ${totalWithFeeFormatted} | Orlando Event Venue`,
          content: `You have a new invoice of ${totalWithFeeFormatted} from Orlando Event Venue. Pay here: ${session.url}`,
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
