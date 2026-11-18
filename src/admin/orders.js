// Orders: filter by status, see the (decrypted) shipping details, move orders along
// (packed → shipped emails the customer), and replay each customer's journey.
import { get, put } from '../lib/api.js';
import { esc, inr, dateTime, flash, emptyRow } from './ui.js';

const LABEL = { paid: 'New (paid)', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded', pending_payment: 'Awaiting payment', payment_failed: 'Payment failed' };
const NEXT = { paid: ['packed', 'cancelled', 'refunded'], packed: ['shipped', 'cancelled', 'refunded'], shipped: ['delivered', 'refunded'], delivered: ['refunded'] };
const FILTERS = [['', 'All'], ['paid', 'New'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['refunded', 'Refunded']];
const EVENT = {
  page_view: 'Opened a page', product_view: 'Looked at', try_on_open: 'Tried on in 3D', color_change: 'Changed colour', size_select: 'Picked a size',
  view_back: 'Turned to the back', add_to_cart: 'Added to bag', buy_now: 'Tapped Buy now', wishlist_add: 'Saved to wishlist', wishlist_remove: 'Removed from wishlist', banner_click: 'Tapped a homepage banner', quick_view: 'Opened quick view', remove_from_cart: 'Removed from bag', signup_prompt: 'Asked to create an account',
  signup_start: 'Started sign-up', signup: 'Signed up', login: 'Logged in', checkout_start: 'Started checkout', payment_open: 'Opened payment', payment_failed: 'Payment failed',
  purchase: 'Paid', reminder_set: 'Set a restock reminder', out_of_stock_view: 'Saw a sold-out size', audio_play: 'Heard the track', audio_mute: 'Muted the track',
  audio_unmute: 'Turned the track on', video_play: 'Played a video', media_view: 'Opened a photo', rack_turn: 'Turned the rack', scroll_depth: 'Scrolled', consent: 'Accepted analytics',
  sort: 'Sorted the shop', filter: 'Filtered the shop', lookbook_open: 'Opened the lookbook', logout: 'Logged out', search: 'Searched', share: 'Shared',
};

function shipHTML(o) {
  const s = o.shipping;
  if (!s) return '<p class="adm-muted">No shipping details.</p>';
  return `<address class="ship">
    <b>${esc(s.fullName)}</b><br>${esc(s.line1)}${s.line2 ? `, ${esc(s.line2)}` : ''}<br>
    ${s.landmark ? `Landmark: ${esc(s.landmark)}<br>` : ''}${esc(s.city)}, ${esc(s.state)} ${esc(s.pin)}<br>
    📞 <a href="tel:+91${esc(s.phone)}">${esc(s.phone)}</a> · ✉ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>
    ${s.age || s.gender ? `<br><span class="adm-muted">${[s.age ? `Age ${esc(s.age)}` : '', s.gender ? esc(s.gender) : ''].filter(Boolean).join(' · ')}</span>` : ''}
  </address>`;
}

function journeyHTML(j) {
  if (!j.events.length) return '<p class="adm-muted">No activity recorded (the customer didn’t accept analytics).</p>';
  const sessions = new Set(j.events.map((e) => e.session_id)).size;
  const first = j.events[0];
  const src = first.utm_source || (first.referrer ? new URL(first.referrer).hostname : 'direct');
  const mins = Math.max(1, Math.round((new Date(j.events.at(-1).at) - new Date(first.at)) / 60000));
  let lastSession = null;
  return `<p class="journey-sum">${j.events.length} actions over ${sessions} visit${sessions === 1 ? '' : 's'} (${mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`}). First came from <b>${esc(src)}</b>${first.utm_campaign ? ` (campaign ${esc(first.utm_campaign)})` : ''} on ${esc(first.device_type || '')} ${esc(first.os || '')}.</p>
    <ol class="journey">${j.events.filter((e) => e.name !== 'scroll_depth' && e.name !== 'rack_turn').map((e) => {
      const visit = e.session_id !== lastSession ? `<li class="journey-visit">Visit · ${esc(dateTime(e.at))}</li>` : '';
      lastSession = e.session_id;
      const p = e.props || {};
      const extra = [e.product, p.color, p.size, p.value ? `₹${p.value}` : ''].filter(Boolean).map(esc).join(' · ');
      return `${visit}<li><time>${new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(EVENT[e.name] || e.name)}${extra ? ` <span class="adm-muted">${extra}</span>` : e.name === 'page_view' ? ` <span class="adm-muted">${esc(e.path || '')}</span>` : ''}</li>`;
    }).join('')}</ol>`;
}

export async function render(outer, { query }) {
  const host = document.createElement('div');
  outer.replaceChildren(host);
  const status = FILTERS.some(([v]) => v === query.status) ? query.status : '';
  const { orders } = await get(`/api/admin/orders${status ? `?status=${status}` : ''}`);
  host.innerHTML = `
    <div class="adm-bar"><h1 class="adm-title">Orders</h1>
      <div class="adm-seg" role="group" aria-label="Status">${FILTERS.map(([v, l]) => `<a href="/admin/orders${v ? `?status=${v}` : ''}" aria-current="${v === status ? 'page' : 'false'}">${l}</a>`).join('')}</div></div>
    <p class="adm-hint">Marking an order Shipped emails the customer. Cancelling or refunding before it ships puts the pieces back in stock. “Refunded” only records it — send the money back from your Razorpay dashboard.</p>
    <div class="adm-table-wrap"><table class="adm-table orders-table">
      <thead><tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Customer</th><th scope="col">Items</th><th scope="col" class="r">Total</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead>
      <tbody>${orders.length ? orders.map((o) => `<tr data-id="${o.id}">
        <th scope="row">${esc(o.number)}<br><small class="adm-muted">${esc(o.device_type || '')} ${esc(o.os || '')}</small></th>
        <td>${esc(dateTime(o.paid_at || o.created_at))}</td>
        <td>${esc(o.shipping?.fullName || '—')}<br><small class="adm-muted">${esc(o.shipping?.city || '')}${o.ship_state ? `, ${esc(o.ship_state)}` : ''}</small></td>
        <td>${(o.items || []).map((i) => `${esc(i.product)} <small class="adm-muted">${esc(i.color)} · ${esc(i.size)} ×${i.qty}</small>`).join('<br>')}</td>
        <td class="r">${inr(o.total_paise)}</td>
        <td>${NEXT[o.status] ? `<select data-status aria-label="Status of ${esc(o.number)}"><option value="${o.status}" selected>${LABEL[o.status]}</option>${NEXT[o.status].map((n) => `<option value="${n}">→ ${LABEL[n]}</option>`).join('')}</select>` : `<span class="pill pill-${esc(o.status)}">${esc(LABEL[o.status] || o.status)}</span>`}</td>
        <td><button type="button" class="adm-link" data-more aria-expanded="false">Details</button></td>
      </tr><tr class="order-more" hidden><td colspan="7"><div class="order-more-grid"><div><h3>Ship to</h3>${shipHTML(o)}</div><div><h3>Journey to purchase</h3><div data-journey><p class="adm-muted">Loading…</p></div></div></div></td></tr>`).join('') : emptyRow(7, 'No orders here yet.')}</tbody>
    </table></div>`;

  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-more]');
    if (!b) return;
    const tr = b.closest('tr');
    const more = tr.nextElementSibling;
    const open = more.hidden;
    more.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? 'Hide' : 'Details';
    const jh = more.querySelector('[data-journey]');
    if (open && !jh.dataset.loaded) {
      jh.dataset.loaded = '1';
      try {
        jh.innerHTML = journeyHTML(await get(`/api/admin/orders/${tr.dataset.id}/journey`));
      } catch (err) {
        jh.innerHTML = `<p class="adm-muted">${esc(err.message)}</p>`;
      }
    }
  });
  host.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    const tr = sel.closest('tr');
    const o = orders.find((x) => x.id === tr.dataset.id);
    const to = sel.value;
    if (to === o.status) return;
    if ((to === 'cancelled' || to === 'refunded') && !confirm(`Mark ${o.number} as ${LABEL[to].toLowerCase()}? This can’t be undone.`)) {
      sel.value = o.status;
      return;
    }
    sel.disabled = true;
    try {
      await put(`/api/admin/orders/${o.id}/status`, { status: to });
      await render(outer, { query });
      flash(outer.firstElementChild, `${o.number} → ${LABEL[to]}${to === 'shipped' ? '. The customer has been emailed.' : '.'}`);
    } catch (err) {
      sel.disabled = false;
      sel.value = o.status;
      flash(host, err.message, 'error');
    }
  });
}
