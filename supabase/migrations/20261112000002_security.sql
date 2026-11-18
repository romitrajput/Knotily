-- Lock-down: the browser never talks to tables directly.
-- Every read and write goes through the Knot'ily API server, which holds the
-- service-role key and calls the functions below. Row Level Security is switched
-- on for every table with NO policies for anon/authenticated, so the public
-- (anon) key Supabase exposes can read and write nothing.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'addresses', 'categories', 'products', 'product_colors', 'product_variants',
    'product_media', 'product_reviews', 'cart_items', 'orders', 'order_items', 'restock_reminders',
    'owner_alerts', 'reminder_alert_state', 'settings', 'audit_log', 'events', 'identity_links', 'rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant usage on all sequences in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
