// Emails that follow store events: owner alerts, restock notices, order emails.
import { env } from './env.js';
import { rpc } from './lib/supabase.js';
import { decrypt, tryDecrypt } from './lib/crypto.js';
import { sendEmails, templates } from './lib/email.js';

const dashboardUrl = () => `${env.siteUrl}/admin`;

// Alert recipients: the address set in Settings, else OWNER_ALERT_EMAIL, else the owner accounts.
async function ownerRecipients() {
  const settings = await rpc('settings_get', {});
  const configured = String(settings.owner_alert_email || '').trim() || env.ownerAlertEmail;
  if (configured) return configured.split(',').map((s) => s.trim()).filter(Boolean);
  const owners = await rpc('owner_emails', {});
  return owners.map((o) => tryDecrypt(o.enc_email, `profile:${o.id}:email`)).filter(Boolean);
}

export async function dispatchAlerts(alerts) {
  const list = (alerts || []).filter(Boolean);
  if (!list.length) return;
  const to = await ownerRecipients();
  const msg = templates.ownerAlert({ alerts: list, dashboardUrl: dashboardUrl() });
  await sendEmails(to.map((addr) => ({ to: addr, ...msg })));
  await rpc('alerts_mark_emailed', { ids: list.map((a) => a.id) });
}

async function emailsFor(userIds) {
  if (!userIds.length) return {};
  const enc = await rpc('users_enc_emails', { ids: [...new Set(userIds)] });
  const out = {};
  for (const [id, token] of Object.entries(enc)) out[id] = tryDecrypt(token, `profile:${id}:email`);
  return out;
}

// After an owner restock: tell every shopper who asked to be reminded.
export async function notifyRestock(notify) {
  if (!notify?.length) return { sent: 0 };
  const emails = await emailsFor(notify.map((n) => n.user_id));
  const msgs = notify.map((n) => ({
    to: emails[n.user_id],
    ...templates.restockAvailable({ product: n.product, color: n.color, size: n.size, url: `${env.siteUrl}/product/${n.slug}?color=${encodeURIComponent(n.color)}` }),
  }));
  return sendEmails(msgs);
}

// After a confirmed payment: receipt to the shopper, alerts to the owner.
export async function afterPaid(result) {
  if (!result || result.already || result.status !== 'paid') return;
  const tasks = [];
  if (result.user_id) {
    tasks.push(
      (async () => {
        const profile = await rpc('profile_get', { id: result.user_id });
        const to = tryDecrypt(profile?.enc_email, `profile:${result.user_id}:email`);
        const name = tryDecrypt(profile?.enc_full_name, `profile:${result.user_id}:name`);
        await sendEmails([{ to, ...templates.orderConfirmation({ name, number: result.number, items: result.items || [], totalPaise: result.total_paise, orderUrl: `${env.siteUrl}/order/${result.order_id}` }) }]);
      })()
    );
  }
  tasks.push(dispatchAlerts(result.alerts));
  await Promise.allSettled(tasks);
}

export async function notifyShipped(order) {
  if (!order?.user_id) return;
  const profile = await rpc('profile_get', { id: order.user_id });
  const to = tryDecrypt(profile?.enc_email, `profile:${order.user_id}:email`);
  const name = tryDecrypt(profile?.enc_full_name, `profile:${order.user_id}:name`);
  await sendEmails([{ to, ...templates.orderShipped({ name, number: order.number, accountUrl: `${env.siteUrl}/account` }) }]);
}

export { decrypt };
