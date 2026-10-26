import nodemailer from "nodemailer";

let transporter = null;

export function mailConfigured() {
  return Boolean(Netlify.env.get("GMAIL_USER") && Netlify.env.get("GMAIL_APP_PASSWORD"));
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: Netlify.env.get("GMAIL_USER"), pass: Netlify.env.get("GMAIL_APP_PASSWORD") },
    });
  }
  return transporter;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function button(href, label, color = "#1f4d3a") {
  return `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;margin:4px 6px 4px 0">${esc(label)}</a>`;
}

export function layout(title, inner, baseUrl) {
  return `<!doctype html><html><body style="margin:0;background:#f4efe4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2420">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#b4532a;font-weight:700">Liguita de tenis</div>
<h1 style="font-size:22px;line-height:1.25;margin:8px 0 16px">${esc(title)}</h1>
<div style="background:#fffdf8;border:1px solid #e3dccb;border-radius:14px;padding:18px;font-size:15px;line-height:1.5">${inner}</div>
${baseUrl ? `<p style="font-size:13px;color:#6b6f66;margin-top:16px">Clasificación en directo: <a href="${esc(baseUrl)}" style="color:#1f4d3a">${esc(baseUrl.replace(/^https?:\/\//, ""))}</a></p>` : ""}
</div></body></html>`;
}

// Envía y nunca rompe el flujo principal si el correo falla.
export async function send(to, subject, html) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return { skipped: "sin destinatarios" };
  if (!mailConfigured()) {
    console.log("[mail no configurado]", subject, "->", list.join(", "));
    return { skipped: "mail no configurado" };
  }
  try {
    const from = `"Liguita de tenis" <${Netlify.env.get("GMAIL_USER")}>`;
    // A varios: se envía en copia oculta para no exponer correos
    if (list.length === 1) await getTransporter().sendMail({ from, to: list[0], subject, html });
    else await getTransporter().sendMail({ from, to: Netlify.env.get("GMAIL_USER"), bcc: list, subject, html });
    return { ok: true };
  } catch (e) {
    console.error("Error enviando mail:", e?.message);
    return { error: e?.message };
  }
}
