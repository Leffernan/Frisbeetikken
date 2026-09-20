// Supabase Database Webhook -> denne Edge Function -> e-post via Resend.
// Secrets: RESEND_API_KEY, ORDER_EMAIL, EMAIL_FROM og WEBHOOK_SECRET.

type Order = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_method: string;
  customer_note?: string | null;
  reserved_until: string;
};

const deliveryLabels: Record<string, string> = {
  pickup: "Hentes etter avtale",
  posten: "Sendes med Posten",
  postnord: "Sendes med PostNord",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!expectedSecret || request.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await request.json();
  const order = payload.record as Order | undefined;
  if (payload.type !== "INSERT" || !order?.id) return new Response("Ignored", { status: 202 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const itemsResponse = await fetch(
    `${supabaseUrl}/rest/v1/order_items?order_id=eq.${encodeURIComponent(order.id)}&select=price,products(id,manufacturer,model)`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!itemsResponse.ok) return new Response("Could not load order items", { status: 500 });

  const items = await itemsResponse.json();
  const total = items.reduce((sum: number, item: { price: number }) => sum + Number(item.price), 0);
  const itemRows = items.map((item: { price: number; products: { id: string; manufacturer: string; model: string } }) =>
    `<li><strong>${escapeHtml(item.products.manufacturer)} ${escapeHtml(item.products.model)}</strong> ` +
    `(vare ${escapeHtml(item.products.id)}) – ${formatNok(item.price)}</li>`
  ).join("");

  const html = `
    <h1>Ny reservasjon ${escapeHtml(order.order_number)}</h1>
    <p><strong>Kunde:</strong> ${escapeHtml(order.customer_name)}<br>
    <strong>E-post:</strong> <a href="mailto:${escapeHtml(order.customer_email)}">${escapeHtml(order.customer_email)}</a><br>
    <strong>Telefon:</strong> ${escapeHtml(order.customer_phone)}<br>
    <strong>Levering:</strong> ${escapeHtml(deliveryLabels[order.delivery_method] || order.delivery_method)}</p>
    <h2>Disker</h2><ul>${itemRows}</ul>
    <p><strong>Totalt: ${formatNok(total)}</strong></p>
    ${order.customer_note ? `<p><strong>Merknad:</strong><br>${escapeHtml(order.customer_note)}</p>` : ""}
    <p>Reservasjonen utløper ${new Date(order.reserved_until).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}.</p>`;

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM"),
      to: [Deno.env.get("ORDER_EMAIL")],
      reply_to: order.customer_email,
      subject: `Ny reservasjon ${order.order_number} – ${order.customer_name}`,
      html,
    }),
  });

  if (!emailResponse.ok) return new Response(await emailResponse.text(), { status: 502 });
  return new Response("Email sent", { status: 200 });
});

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#039;",
  })[character]!);
}

function formatNok(value: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(value);
}
