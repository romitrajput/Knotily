// Privacy policy and terms. A starting point written for India's DPDP Act 2023 —
// fill in the business details below and have a lawyer review both pages before launch.
import { config } from '../config.js';
import { esc } from '../lib/util.js';

const BUSINESS = {
  legalName: '[Registered business name]',
  address: '[Registered business address]',
  grievanceOfficer: '[Name of grievance officer]',
  grievanceEmail: config.supportEmail,
  updated: '12 November 2026',
};

const wrap = (title, body) => `<section class="page-narrow legal"><h1 class="page-title">${title}</h1><p class="muted">Last updated ${BUSINESS.updated}</p>${body}</section>`;

export async function privacy() {
  return {
    name: 'legal',
    title: 'Privacy policy',
    html: wrap('Privacy policy', `
      <p>${esc(BUSINESS.legalName)} (“Knot’ily”, “we”) runs this shop. This policy explains what personal data we collect, why, and the choices you have.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email (your user ID), name and a password. Passwords are hashed by our authentication provider; we never see them.</li>
        <li><b>Orders:</b> mobile number, shipping address, landmark and what you bought.</li>
        <li><b>Optional:</b> age and gender, only if you choose to tell us at checkout.</li>
        <li><b>Payments:</b> handled by Razorpay. We receive a payment reference, never your card or UPI details.</li>
        <li><b>Usage (only with your consent):</b> pages and products viewed, colours and sizes picked, bag and checkout steps, device type (phone, tablet, desktop), operating system, and where you came from (e.g. an Instagram link).</li>
      </ul>
      <h2>Why we use it</h2>
      <ul>
        <li>To run your account, deliver orders and send receipts, shipping updates and the restock emails you ask for.</li>
        <li>With your consent, to understand what shoppers like so we can plan designs, colours, sizes and stock.</li>
        <li>To prevent fraud and keep the shop secure.</li>
      </ul>
      <h2>How we protect it</h2>
      <p>Your name, email, phone, address, age and gender are encrypted (AES-256) before they are stored, with keys kept separately from the database. Only the store owner can view decrypted data, after re-entering their password, and every export is logged. All traffic uses HTTPS.</p>
      <h2>Who processes it for us</h2>
      <p>Supabase (database and login), Vercel (hosting), Razorpay (payments) and Resend (email). They process data only on our instructions. Some of them may store data outside India.</p>
      <h2>How long we keep it</h2>
      <p>Account data while your account is open. Order and invoice records for as long as tax law requires (usually 8 years). Usage analytics for up to 24 months.</p>
      <h2>Your rights</h2>
      <p>You can see and correct your details in <a href="/account">your account</a>, withdraw analytics consent at any time (Account → Privacy, or the cookie settings link in the footer), and ask us to erase your account and data. You can also ask us for a summary of the data we hold about you.</p>
      <h2>Children</h2>
      <p>The shop is for people aged 18 and over. If you are under 18, please shop with a parent or guardian.</p>
      <h2>Cookies</h2>
      <p>We use essential cookies to keep you logged in and protect your account. Analytics only run if you accept them.</p>
      <h2>Contact and grievances</h2>
      <p>Grievance officer: ${esc(BUSINESS.grievanceOfficer)}, <a href="mailto:${esc(BUSINESS.grievanceEmail)}" data-external>${esc(BUSINESS.grievanceEmail)}</a>, ${esc(BUSINESS.address)}. We reply within 30 days. You may also complain to the Data Protection Board of India.</p>`),
  };
}

export async function terms() {
  return {
    name: 'legal',
    title: 'Terms',
    html: wrap('Terms of sale and use', `
      <p>These terms apply when you use this site or buy from ${esc(BUSINESS.legalName)}.</p>
      <h2>Accounts</h2>
      <p>You need an account to buy. Keep your password private; you are responsible for orders placed from your account. You must be 18 or over, or shop with a parent's or guardian's permission.</p>
      <h2>Prices and stock</h2>
      <p>Prices are in Indian rupees and include taxes. Shipping is shown before you pay. Pieces are made in short runs; stock is held for you for 15 minutes once you start paying. If an item sells out while you are paying, we refund you in full automatically.</p>
      <h2>Payment</h2>
      <p>Payments are processed by Razorpay. An order is confirmed only when the payment is verified.</p>
      <h2>Shipping</h2>
      <p>We ship across India, usually dispatching within 2–3 working days. Delivery times depend on the courier and your PIN code.</p>
      <h2>Returns</h2>
      <p>Return unworn pieces with tags within 7 days of delivery for a refund to the original payment method. Write to <a href="mailto:${esc(config.supportEmail)}" data-external>${esc(config.supportEmail)}</a> with your order number.</p>
      <h2>Restock reminders</h2>
      <p>A reminder is a free email when a size returns. It is not a reservation.</p>
      <h2>Content</h2>
      <p>Designs, photos, music and text on this site belong to Knot’ily or its licensors.</p>
      <h2>Contact</h2>
      <p>${esc(BUSINESS.legalName)}, ${esc(BUSINESS.address)}. Email <a href="mailto:${esc(config.supportEmail)}" data-external>${esc(config.supportEmail)}</a>.</p>`),
  };
}
