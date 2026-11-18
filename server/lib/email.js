// Transactional email through Resend's HTTP API. Login emails (verify address,
// reset password) are sent by Supabase Auth itself using the templates in
// supabase/templates/. In local development and automated tests emails are
// written to MAIL_OUTBOX_DIR instead of being sent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env, isProd } from '../env.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const prefix = () => (env.appEnv === 'production' ? '' : `[${env.appEnv.toUpperCase()}] `);

function layout(title, bodyHtml, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Poppins,Arial,sans-serif;color:#0a1150">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
    <tr><td style="background:#14219e;padding:22px 28px;color:#ee6522;font-size:24px;font-weight:600;letter-spacing:.5px">Knot’ily</td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${esc(title)}</h1>
      ${bodyHtml}
      ${cta ? `<p style="margin:26px 0 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#ee6522;color:#0a1150;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${esc(cta.label)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f7f2ea;font-size:12px;color:#5a5f86">Knot’ily, India. You’re getting this because of activity on your Knot’ily account.</td></tr>
  </table></td></tr></table></body></html>`;
}

export const templates = {
  orderConfirmation({ name, number, items, totalPaise, orderUrl }) {
    const rows = items
      .map((i) => `<tr><td style="padding:6px 0">${esc(i.product)} <span style="color:#5a5f86">(${esc(i.color)}, ${esc(i.size)}) × ${i.qty}</span></td><td align="right">${inr(i.unit_price_paise * i.qty)}</td></tr>`)
      .join('');
    return {
      subject: `${prefix()}Order ${number} confirmed`,
      html: layout(`Thanks${name ? ', ' + name.split(' ')[0] : ''}. Your order is confirmed.`,
        `<p style="margin:0 0 16px">Order <b>${esc(number)}</b> is paid. We'll email you again when it ships, usually within 2–3 working days.</p>
         <table width="100%" style="font-size:14px;border-top:1px solid #e3e1dc;border-bottom:1px solid #e3e1dc">${rows}
         <tr><td style="padding:10px 0;font-weight:600">Total paid</td><td align="right" style="font-weight:600">${inr(totalPaise)}</td></tr></table>`,
        { label: 'View your order', url: orderUrl }),
    };
  },
  orderShipped({ name, number, accountUrl }) {
    return {
      subject: `${prefix()}Order ${number} has shipped`,
      html: layout(`On its way${name ? ', ' + name.split(' ')[0] : ''}.`, `<p style="margin:0">Order <b>${esc(number)}</b> has left our studio.</p>`, { label: 'View your orders', url: accountUrl }),
    };
  },
  restockAvailable({ product, color, size, url }) {
    return {
      subject: `${prefix()}${product} is back in stock`,
      html: layout(`${product} is back.`,
        `<p style="margin:0">The ${esc(color)} ${esc(product)} in size <b>${esc(size)}</b> is back in stock. Drops sell out fast, so grab it while it lasts.</p>`,
        { label: 'Shop it now', url }),
    };
  },
  ownerAlert({ alerts, dashboardUrl }) {
    const items = alerts.map((a) => `<li style="margin:0 0 8px">${esc(a.message)}</li>`).join('');
    const kinds = [...new Set(alerts.map((a) => a.kind))];
    const subject = kinds.length === 1 && kinds[0] === 'order_paid'
      ? alerts[0].message
      : kinds.includes('reminder_threshold') ? 'Shoppers are waiting for a restock'
      : kinds.some((k) => k.endsWith('stock')) ? 'Stock is running low'
      : 'Store update';
    return {
      subject: `${prefix()}${subject}`,
      html: layout(subject, `<ul style="padding-left:18px;margin:0">${items}</ul>`, { label: 'Open the dashboard', url: dashboardUrl }),
    };
  },
  accountDeletion({ dashboardUrl }) {
    return {
      subject: `${prefix()}Account deletion request`,
      html: layout('A shopper asked to delete their data', '<p style="margin:0">Process it from the owner dashboard within 30 days.</p>', { label: 'Open the dashboard', url: dashboardUrl }),
    };
  },
};

function toOutbox(messages) {
  mkdirSync(env.outboxDir, { recursive: true });
  for (const m of messages) writeFileSync(join(env.outboxDir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`), JSON.stringify(m, null, 2));
  return { sent: messages.length, outbox: true };
}

// messages: [{ to, subject, html }]. Up to 100 per batch call.
export async function sendEmails(messages) {
  const list = messages.filter((m) => m.to);
  if (!list.length) return { sent: 0 };
  if (env.outboxDir) return toOutbox(list);
  if (!env.resendApiKey) {
    if (isProd) console.error('[email] RESEND_API_KEY missing; emails not sent');
    else console.log(`[email] (not sent, no RESEND_API_KEY) ${list.map((m) => m.subject).join(' | ')}`);
    return { sent: 0 };
  }
  let sent = 0;
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map((m) => ({ from: env.mailFrom, to: [m.to], subject: m.subject, html: m.html }));
    const res = await fetch(`${env.resendApiBase}/emails/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
    else console.error('[email] send failed', res.status, (await res.text()).slice(0, 200));
  }
  return { sent };
}
