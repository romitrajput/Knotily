// Server configuration. Every secret comes from environment variables
// (Vercel → Project → Settings → Environment Variables), never from the code.
const e = process.env;

export const env = {
  appEnv: e.APP_ENV || 'development', // development | testing | production
  siteUrl: (e.SITE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  allowedOrigins: (e.ALLOWED_ORIGINS || e.SITE_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),

  supabaseUrl: (e.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseAnonKey: e.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
  storageBucket: e.STORAGE_BUCKET || 'product-media',

  // {"v1":"<base64 32 bytes>","v2":"..."}; DATA_ENCRYPTION_KEY_ID picks the key for new data
  encryptionKeys: e.DATA_ENCRYPTION_KEYS || '',
  encryptionKeyId: e.DATA_ENCRYPTION_KEY_ID || 'v1',
  blindIndexKey: e.BLIND_INDEX_KEY || '',
  tokenSecret: e.SERVER_TOKEN_SECRET || '', // signs short-lived owner export tokens

  paymentProvider: e.PAYMENT_PROVIDER || 'razorpay', // razorpay | mock
  razorpayKeyId: e.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: e.RAZORPAY_KEY_SECRET || '',
  razorpayWebhookSecret: e.RAZORPAY_WEBHOOK_SECRET || '',
  razorpayApiBase: (e.RAZORPAY_API_BASE || 'https://api.razorpay.com').replace(/\/$/, ''),

  resendApiKey: e.RESEND_API_KEY || '',
  resendApiBase: (e.RESEND_API_BASE || 'https://api.resend.com').replace(/\/$/, ''),
  mailFrom: e.MAIL_FROM || "Knot'ily <orders@knotily.in>",
  ownerAlertEmail: e.OWNER_ALERT_EMAIL || '',
  outboxDir: e.MAIL_OUTBOX_DIR || '', // local dev/tests: write emails to files instead of sending

  cronSecret: e.CRON_SECRET || '',
  cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : (e.SITE_URL || '').startsWith('https://'),
};

export const isProd = env.appEnv === 'production';

// Fail fast on a misconfigured production deploy rather than run insecurely.
export function assertConfig() {
  const missing = [];
  const need = ['supabaseUrl', 'supabaseServiceKey', 'encryptionKeys', 'blindIndexKey', 'tokenSecret'];
  if (isProd) need.push('razorpayKeyId', 'razorpayKeySecret', 'razorpayWebhookSecret', 'resendApiKey', 'cronSecret');
  for (const k of need) if (!env[k]) missing.push(k);
  if (isProd && env.paymentProvider !== 'razorpay') missing.push('PAYMENT_PROVIDER=razorpay');
  if (isProd && env.outboxDir) missing.push('MAIL_OUTBOX_DIR must be empty in production');
  if (isProd && !env.siteUrl.startsWith('https://')) missing.push('SITE_URL (https)');
  if (missing.length) throw new Error(`Server misconfigured, missing: ${missing.join(', ')}`);
}
