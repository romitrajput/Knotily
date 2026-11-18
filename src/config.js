// Central runtime config. Build-time values come from Vite env vars; values that the
// owner can change (shipping rules, audio volume) and the environment name come from
// the API at start-up (see loadRuntimeConfig in src/main.js).
const env = (import.meta && import.meta.env) || {};

export const config = {
  brand: 'Knot’ily',
  currency: 'INR',
  locale: 'en-IN',
  currentDrop: 'Drop 04',
  apiBaseUrl: env.VITE_API_BASE_URL || '',
  siteUrl: env.VITE_SITE_URL || 'https://knotily.in',
  supportEmail: env.VITE_SUPPORT_EMAIL || 'hello@knotily.in',
  instagram: 'https://www.instagram.com/',

  // filled from the API (defaults are only used until it answers)
  env: 'production',
  paymentProvider: 'razorpay',
  razorpayKeyId: '',
  freeShippingThreshold: 1999,
  shippingFee: 99,
  audioVolume: 0.2,
};

export function applyRuntimeConfig(r = {}) {
  if (r.env) config.env = r.env;
  if (r.paymentProvider) config.paymentProvider = r.paymentProvider;
  if (r.razorpayKeyId !== undefined) config.razorpayKeyId = r.razorpayKeyId || '';
}

export function applyStoreSettings(s = {}) {
  if (s.shipping) {
    if (Number.isFinite(s.shipping.free_over_paise)) config.freeShippingThreshold = s.shipping.free_over_paise / 100;
    if (Number.isFinite(s.shipping.fee_paise)) config.shippingFee = s.shipping.fee_paise / 100;
  }
  const vol = Number(s.audio_volume);
  if (Number.isFinite(vol) && vol >= 0 && vol <= 1) config.audioVolume = vol;
}
