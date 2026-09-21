/**
 * Supabase Database Webhook -> Google Apps Script -> Gmail.
 *
 * Script Properties:
 *   ORDER_EMAIL     leffernan@gmail.com
 *   WEBHOOK_SECRET  en lang, tilfeldig verdi
 */
function doPost(e) {
  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = properties.getProperty("WEBHOOK_SECRET");
  const suppliedSecret = e && e.parameter ? e.parameter.token : "";

  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return jsonResponse({ ok: false, error: "Unauthorized" });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const order = payload.record;
    if (payload.type !== "INSERT" || !order || !order.id) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const recipient = properties.getProperty("ORDER_EMAIL") || "leffernan@gmail.com";
    const items = Array.isArray(order.items) ? order.items : [];
    const subject = `Ny reservasjon ${order.order_number} - ${order.customer_name}`;
    const itemText = items.map((item) =>
      `- ${item.manufacturer} ${item.model} (vare ${item.id}) - ${formatNok(item.price)}`
    ).join("\n");
    const text = [
      `Ny reservasjon ${order.order_number}`,
      "",
      `Kunde: ${order.customer_name}`,
      `E-post: ${order.customer_email}`,
      `Telefon: ${order.customer_phone}`,
      "Levering: Hentes etter avtale",
      "",
      "Disker:",
      itemText || "Ingen varer registrert",
      "",
      `Totalt: ${formatNok(order.total)}`,
      order.customer_note ? `Merknad: ${order.customer_note}` : "",
      `Reservasjonen utløper: ${formatDate(order.reserved_until)}`,
    ].filter(Boolean).join("\n");

    const itemHtml = items.map((item) =>
      `<li><strong>${escapeHtml(item.manufacturer)} ${escapeHtml(item.model)}</strong> ` +
      `(vare ${escapeHtml(item.id)}) - ${escapeHtml(formatNok(item.price))}</li>`
    ).join("");
    const html = `
      <h1>Ny reservasjon ${escapeHtml(order.order_number)}</h1>
      <p><strong>Kunde:</strong> ${escapeHtml(order.customer_name)}<br>
      <strong>E-post:</strong> <a href="mailto:${escapeHtml(order.customer_email)}">${escapeHtml(order.customer_email)}</a><br>
      <strong>Telefon:</strong> ${escapeHtml(order.customer_phone)}<br>
      <strong>Levering:</strong> Hentes etter avtale</p>
      <h2>Disker</h2>
      <ul>${itemHtml || "<li>Ingen varer registrert</li>"}</ul>
      <p><strong>Totalt: ${escapeHtml(formatNok(order.total))}</strong></p>
      ${order.customer_note ? `<p><strong>Merknad:</strong><br>${escapeHtml(order.customer_note)}</p>` : ""}
      <p>Reservasjonen utløper ${escapeHtml(formatDate(order.reserved_until))}.</p>`;

    MailApp.sendEmail({
      to: recipient,
      subject,
      body: text,
      htmlBody: html,
      name: "Frisbeetikken",
      replyTo: order.customer_email,
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatNok(value) {
  return `${Number(value || 0).toLocaleString("nb-NO", { maximumFractionDigits: 0 })} kr`;
}

function formatDate(value) {
  return Utilities.formatDate(new Date(value), "Europe/Oslo", "dd.MM.yyyy 'kl.' HH:mm");
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}
