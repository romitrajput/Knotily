-- Knot'ily store schema
-- Money is stored as integer paise (₹1 = 100 paise). Personal data is stored as
-- AES-256-GCM ciphertext produced by the API server (columns prefixed enc_);
-- the database never sees the encryption keys.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- people
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'owner')),
  email_bidx text,                     -- HMAC blind index of the email, for lookups without decrypting
  enc_email text,                      -- encrypted copy of the login email
  enc_full_name text,
  enc_phone text,
  enc_age text,                        -- optional, given at checkout
  enc_gender text,                     -- optional, given at checkout
  consent_analytics boolean not null default false,
  consent_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_bidx on public.profiles (email_bidx);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  enc_payload text not null,           -- encrypted JSON: name, email, phone, line1, line2, landmark, city, state, pin
  ship_state text,                     -- state kept in clear for regional analytics
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create index addresses_user on public.addresses (user_id);

-- ---------------------------------------------------------------- catalogue
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null default '',
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  category_id uuid references public.categories (id) on delete set null,
  description text not null default '',
  details text[] not null default '{}',
  price_paise int not null check (price_paise > 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct <= 90),
  garment_type text not null default 'oversized'
    check (garment_type in ('oversized', 'tee', 'tank', 'halter', 'longsleeve', 'hoodie', 'jacket', 'pants', 'skirt')),
  print_spec jsonb not null default '{}'::jsonb,   -- text prints for the 3D model (front/back lines)
  print_front_url text,                            -- uploaded design artwork, printed on the 3D model
  print_back_url text,
  audio_url text,                                  -- music played when the product is opened
  audio_title text,
  status text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  is_new boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_status on public.products (status, sort);

create table public.product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  ink_hex text check (ink_hex is null or ink_hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort int not null default 0,
  unique (product_id, name)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color_id uuid not null references public.product_colors (id) on delete cascade,
  size text not null,
  sku text not null unique,
  stock int not null default 0 check (stock >= 0),
  reserved int not null default 0 check (reserved >= 0),
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  low_stock_alerted boolean not null default false,
  sort int not null default 0,
  unique (product_id, color_id, size)
);
create index variants_product on public.product_variants (product_id);

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color_id uuid references public.product_colors (id) on delete set null,
  kind text not null check (kind in ('image', 'video')),
  url text not null,
  poster_url text,
  alt text not null default '',
  sort int not null default 0
);
create index media_product on public.product_media (product_id, sort);

create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  author_name text not null,
  rating int not null check (rating between 1 and 5),
  title text not null default '',
  body text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index reviews_product on public.product_reviews (product_id);

-- ---------------------------------------------------------------- shopping
create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  qty int not null check (qty between 1 and 10),
  added_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded', 'payment_failed', 'expired')),
  subtotal_paise int not null,          -- after product discounts
  mrp_paise int not null,               -- before discounts
  shipping_paise int not null default 0,
  total_paise int not null,
  currency text not null default 'INR',
  enc_shipping text not null,           -- encrypted JSON of the shipping details
  ship_state text,
  payment_provider text not null,
  provider_order_id text unique,
  provider_payment_id text,
  reserved_until timestamptz,
  session_id text,
  device_type text, os text, browser text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index orders_user on public.orders (user_id, created_at desc);
create index orders_status on public.orders (status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  color_name text not null,
  size text not null,
  unit_price_paise int not null,
  unit_mrp_paise int not null,
  qty int not null check (qty > 0)
);
create index order_items_order on public.order_items (order_id);

create table public.restock_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index reminders_active_unique on public.restock_reminders (user_id, variant_id) where notified_at is null;
create index reminders_product_active on public.restock_reminders (product_id) where notified_at is null;

-- ---------------------------------------------------------------- owner
create table public.owner_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('low_stock', 'out_of_stock', 'reminder_threshold', 'order_paid', 'restock_sent', 'account_deletion')),
  product_id uuid references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  emailed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index owner_alerts_recent on public.owner_alerts (created_at desc);

-- the "more than N reminders" alert fires once per product until it is restocked
create table public.reminder_alert_state (
  product_id uuid primary key references public.products (id) on delete cascade,
  alerted_at timestamptz not null
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- analytics
-- No personal data here: events carry ids, product refs, device class and page info only.
create table public.events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  session_id text not null,
  anon_id text,
  user_id uuid,
  name text not null,
  path text,
  product_id uuid,
  variant_id uuid,
  props jsonb not null default '{}'::jsonb,
  device_type text, os text, browser text,
  referrer text, utm_source text, utm_medium text, utm_campaign text,
  country text
);
create index events_time on public.events (occurred_at desc);
create index events_name_time on public.events (name, occurred_at desc);
create index events_session on public.events (session_id);
create index events_user on public.events (user_id) where user_id is not null;
create index events_anon on public.events (anon_id) where anon_id is not null;

-- links an anonymous browser id to an account once the shopper signs in
create table public.identity_links (
  anon_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (anon_id, user_id)
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

-- ---------------------------------------------------------------- housekeeping
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger t_orders_touch before update on public.orders for each row execute function public.touch_updated_at();

insert into public.settings (key, value) values
  ('low_stock_default', '5'),
  ('reminder_alert_threshold', '10'),
  ('owner_alert_email', '""'),
  ('notify_owner_on_order', 'true'),
  ('audio_volume', '0.2'),
  ('shipping', '{"free_over_paise": 199900, "fee_paise": 9900}'),
  ('reservation_minutes', '15')
on conflict (key) do nothing;
