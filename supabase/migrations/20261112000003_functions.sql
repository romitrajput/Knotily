-- Knot'ily business logic.
-- Every function takes one jsonb argument `p` and returns jsonb, and is callable
-- only by the service role (the API server). Stock changes lock the variant rows
-- (SELECT ... FOR UPDATE) so two shoppers can never buy the last unit twice.

-- ================================================================ helpers
create or replace function public._setting(k text) returns jsonb language sql stable as $$
  select value from public.settings where key = k
$$;

create or replace function public._sale_price(price int, pct numeric) returns int language sql immutable as $$
  -- discounted price, rounded to the nearest rupee
  select (round(price * (100 - coalesce(pct, 0)) / 100.0 / 100.0) * 100)::int
$$;

create or replace function public._fail(code text, detail jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = code, detail = detail::text;
end $$;

create or replace function public._availability(v public.product_variants) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'available', greatest(v.stock - v.reserved, 0),
    'state', case
      when v.stock - v.reserved <= 0 then 'out'
      when v.stock - v.reserved <= v.low_stock_threshold then 'low'
      else 'in' end)
$$;

create or replace function public._shipping_for(subtotal int) returns int language sql stable as $$
  select case
    when subtotal = 0 then 0
    when subtotal >= coalesce((public._setting('shipping') ->> 'free_over_paise')::int, 199900) then 0
    else coalesce((public._setting('shipping') ->> 'fee_paise')::int, 9900) end
$$;

-- ================================================================ catalogue (public)
create or replace function public._product_json(pr public.products, with_reviews boolean) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', pr.id, 'slug', pr.slug, 'name', pr.name,
    'category', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) from public.categories c where c.id = pr.category_id),
    'description', pr.description, 'details', to_jsonb(pr.details),
    'price_paise', public._sale_price(pr.price_paise, pr.discount_pct),
    'mrp_paise', pr.price_paise,
    'discount_pct', pr.discount_pct,
    'garment_type', pr.garment_type, 'print_spec', pr.print_spec,
    'print_front_url', pr.print_front_url, 'print_back_url', pr.print_back_url,
    'audio_url', pr.audio_url, 'audio_title', pr.audio_title,
    'is_new', pr.is_new, 'status', pr.status,
    'colors', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'ink', c.ink_hex) order by c.sort, c.name)
                        from public.product_colors c where c.product_id = pr.id), '[]'),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'color_id', v.color_id, 'size', v.size, 'sku', v.sku) || public._availability(v) order by v.sort, v.size)
                          from public.product_variants v where v.product_id = pr.id), '[]'),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'poster_url', m.poster_url, 'alt', m.alt, 'color_id', m.color_id) order by m.sort)
                       from public.product_media m where m.product_id = pr.id), '[]'),
    'rating', (select jsonb_build_object('avg', round(avg(r.rating)::numeric, 1), 'count', count(*))
               from public.product_reviews r where r.product_id = pr.id and r.is_published),
    'reviews', case when with_reviews then coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'author', r.author_name, 'rating', r.rating, 'title', r.title, 'body', r.body, 'date', r.created_at) order by r.created_at desc)
        from public.product_reviews r where r.product_id = pr.id and r.is_published), '[]') else null end
  )
$$;

create or replace function public.catalog(p jsonb) returns jsonb language plpgsql stable as $$
declare pr public.products;
begin
  if p ? 'slug' then
    select * into pr from public.products where slug = p ->> 'slug' and status = 'live';
    if not found then perform public._fail('NOT_FOUND'); end if;
    return jsonb_build_object('product', public._product_json(pr, true));
  end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description) order by c.sort, c.name)
                            from public.categories c where c.is_active), '[]'),
    'products', coalesce((select jsonb_agg(public._product_json(x, false) order by x.sort, x.created_at)
                          from public.products x where x.status = 'live'), '[]'),
    'settings', jsonb_build_object('audio_volume', public._setting('audio_volume'), 'shipping', public._setting('shipping'))
  );
end $$;

-- ================================================================ cart
create or replace function public.cart_get(p jsonb) returns jsonb language plpgsql stable as $$
declare uid uuid := (p ->> 'user_id')::uuid; items jsonb; sub int; mrp int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'qty', ci.qty, 'size', v.size, 'sku', v.sku,
           'product', jsonb_build_object('id', pr.id, 'slug', pr.slug, 'name', pr.name, 'garment_type', pr.garment_type, 'status', pr.status),
           'color', jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex),
           'unit_price_paise', public._sale_price(pr.price_paise, pr.discount_pct),
           'unit_mrp_paise', pr.price_paise,
           'line_total_paise', public._sale_price(pr.price_paise, pr.discount_pct) * ci.qty,
           'problem', case when pr.status <> 'live' then 'unavailable'
                           when v.stock - v.reserved <= 0 then 'out_of_stock'
                           when v.stock - v.reserved < ci.qty then 'insufficient_stock' end
         ) || public._availability(v) order by ci.added_at), '[]'),
         coalesce(sum(public._sale_price(pr.price_paise, pr.discount_pct) * ci.qty), 0),
         coalesce(sum(pr.price_paise * ci.qty), 0)
    into items, sub, mrp
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products pr on pr.id = v.product_id
  join public.product_colors c on c.id = v.color_id
  where ci.user_id = uid;
  return jsonb_build_object('items', items, 'subtotal_paise', sub, 'mrp_paise', mrp,
    'shipping_paise', public._shipping_for(sub), 'total_paise', sub + public._shipping_for(sub),
    'count', (select coalesce(sum(qty), 0) from public.cart_items where user_id = uid));
end $$;

create or replace function public.cart_set(p jsonb) returns jsonb language plpgsql as $$
declare
  uid uuid := (p ->> 'user_id')::uuid;
  vid uuid := (p ->> 'variant_id')::uuid;
  q int := coalesce((p ->> 'qty')::int, 1);
  mode text := coalesce(p ->> 'mode', 'set');   -- 'set' or 'add'
  v public.product_variants; st text; cur int; avail int;
begin
  if q < 0 or q > 10 then perform public._fail('BAD_QTY'); end if;
  select * into v from public.product_variants where id = vid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  select status into st from public.products where id = v.product_id;
  if st <> 'live' then perform public._fail('UNAVAILABLE'); end if;
  select qty into cur from public.cart_items where user_id = uid and variant_id = vid;
  if mode = 'add' then q := least(coalesce(cur, 0) + q, 10); end if;
  if q = 0 then
    delete from public.cart_items where user_id = uid and variant_id = vid;
    return public.cart_get(p);
  end if;
  avail := v.stock - v.reserved;
  if avail <= 0 then perform public._fail('OUT_OF_STOCK', jsonb_build_object('variant_id', vid)); end if;
  if avail < q then perform public._fail('INSUFFICIENT_STOCK', jsonb_build_object('variant_id', vid, 'available', avail)); end if;
  insert into public.cart_items (user_id, variant_id, qty) values (uid, vid, q)
    on conflict (user_id, variant_id) do update set qty = excluded.qty;
  return public.cart_get(p);
end $$;

-- ================================================================ orders & stock
create or replace function public.release_expired_reservations(p jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare o record; n int := 0;
begin
  for o in select id from public.orders where status = 'pending_payment' and reserved_until < now() for update skip locked loop
    update public.product_variants v set reserved = greatest(v.reserved - oi.qty, 0)
      from public.order_items oi where oi.order_id = o.id and oi.variant_id = v.id;
    update public.orders set status = 'expired', reserved_until = null where id = o.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('released', n);
end $$;

create or replace function public.order_create(p jsonb) returns jsonb language plpgsql as $$
declare
  uid uuid := (p ->> 'user_id')::uuid;
  lines jsonb;
  ln jsonb;
  v public.product_variants;
  pr public.products;
  c public.product_colors;
  oid uuid := gen_random_uuid();
  onum text;
  sub int := 0; mrp int := 0; ship int; q int;
  minutes int := coalesce((public._setting('reservation_minutes'))::int, 15);
begin
  perform public.release_expired_reservations();
  -- lines: explicit "buy now" items, or the shopper's cart
  if jsonb_typeof(p -> 'items') = 'array' and jsonb_array_length(p -> 'items') > 0 then
    lines := p -> 'items';
  else
    select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', qty) order by variant_id), '[]')
      into lines from public.cart_items where user_id = uid;
  end if;
  if jsonb_array_length(lines) = 0 then perform public._fail('EMPTY'); end if;
  if jsonb_array_length(lines) > 20 then perform public._fail('TOO_MANY_ITEMS'); end if;

  onum := 'KN' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  insert into public.orders (id, number, user_id, subtotal_paise, mrp_paise, shipping_paise, total_paise, enc_shipping, ship_state,
                             payment_provider, reserved_until, session_id, device_type, os, browser)
  values (oid, onum, uid, 0, 0, 0, 0, p ->> 'enc_shipping', p ->> 'ship_state', coalesce(p ->> 'provider', 'razorpay'),
          now() + make_interval(mins => minutes), p ->> 'session_id', p ->> 'device_type', p ->> 'os', p ->> 'browser');

  -- lock variants in a fixed order to avoid deadlocks between concurrent checkouts
  for ln in select value from jsonb_array_elements(lines) order by value ->> 'variant_id' loop
    q := (ln ->> 'qty')::int;
    if q is null or q < 1 or q > 10 then perform public._fail('BAD_QTY'); end if;
    select * into v from public.product_variants where id = (ln ->> 'variant_id')::uuid for update;
    if not found then perform public._fail('NOT_FOUND', jsonb_build_object('variant_id', ln ->> 'variant_id')); end if;
    select * into pr from public.products where id = v.product_id;
    if pr.status <> 'live' then perform public._fail('UNAVAILABLE', jsonb_build_object('variant_id', v.id)); end if;
    if v.stock - v.reserved < q then
      perform public._fail(case when v.stock - v.reserved <= 0 then 'OUT_OF_STOCK' else 'INSUFFICIENT_STOCK' end,
                           jsonb_build_object('variant_id', v.id, 'available', greatest(v.stock - v.reserved, 0), 'product', pr.name, 'size', v.size));
    end if;
    select * into c from public.product_colors where id = v.color_id;
    update public.product_variants set reserved = reserved + q where id = v.id;
    insert into public.order_items (order_id, variant_id, product_id, product_name, color_name, size, unit_price_paise, unit_mrp_paise, qty)
      values (oid, v.id, pr.id, pr.name, c.name, v.size, public._sale_price(pr.price_paise, pr.discount_pct), pr.price_paise, q);
    sub := sub + public._sale_price(pr.price_paise, pr.discount_pct) * q;
    mrp := mrp + pr.price_paise * q;
  end loop;

  ship := public._shipping_for(sub);
  update public.orders set subtotal_paise = sub, mrp_paise = mrp, shipping_paise = ship, total_paise = sub + ship where id = oid;
  return jsonb_build_object('order_id', oid, 'number', onum, 'subtotal_paise', sub, 'mrp_paise', mrp,
    'shipping_paise', ship, 'total_paise', sub + ship, 'reserved_minutes', minutes);
end $$;

create or replace function public.order_set_provider(p jsonb) returns jsonb language plpgsql as $$
begin
  update public.orders set provider_order_id = p ->> 'provider_order_id'
   where id = (p ->> 'order_id')::uuid and status = 'pending_payment';
  if not found then perform public._fail('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- stock alerts for one variant after its availability changed
create or replace function public._check_low_stock(vid uuid) returns jsonb language plpgsql as $$
declare v public.product_variants; pr public.products; c public.product_colors; avail int; a public.owner_alerts;
begin
  select * into v from public.product_variants where id = vid;
  avail := v.stock - v.reserved;
  if avail > v.low_stock_threshold then
    if v.low_stock_alerted then update public.product_variants set low_stock_alerted = false where id = vid; end if;
    return null;
  end if;
  if v.low_stock_alerted then return null; end if;
  select * into pr from public.products where id = v.product_id;
  select * into c from public.product_colors where id = v.color_id;
  insert into public.owner_alerts (kind, product_id, variant_id, message, payload)
  values (case when avail <= 0 then 'out_of_stock' else 'low_stock' end, pr.id, vid,
          case when avail <= 0 then format('%s (%s, %s) is out of stock.', pr.name, c.name, v.size)
               else format('%s (%s, %s) is running low: %s left.', pr.name, c.name, v.size, avail) end,
          jsonb_build_object('product', pr.name, 'color', c.name, 'size', v.size, 'available', avail, 'sku', v.sku, 'threshold', v.low_stock_threshold))
  returning * into a;
  update public.product_variants set low_stock_alerted = true where id = vid;
  return to_jsonb(a);
end $$;

create or replace function public.order_mark_paid(p jsonb) returns jsonb language plpgsql as $$
declare
  o public.orders; it record; alerts jsonb := '[]'; al jsonb; v public.product_variants; ok boolean := true;
begin
  select * into o from public.orders
   where (p ? 'order_id' and id = (p ->> 'order_id')::uuid) or (p ? 'provider_order_id' and provider_order_id = p ->> 'provider_order_id')
   for update;
  if not found then perform public._fail('NOT_FOUND'); end if;
  if o.status in ('paid', 'packed', 'shipped', 'delivered') then
    return jsonb_build_object('order_id', o.id, 'number', o.number, 'status', o.status, 'already', true, 'user_id', o.user_id);
  end if;

  if o.status <> 'pending_payment' then
    -- payment arrived after the reservation lapsed: take stock again if we still can
    for it in select oi.* from public.order_items oi where oi.order_id = o.id order by oi.variant_id loop
      select * into v from public.product_variants where id = it.variant_id for update;
      if v.stock - v.reserved < it.qty then ok := false; end if;
    end loop;
    if not ok then
      update public.orders set status = 'refunded', provider_payment_id = p ->> 'provider_payment_id', updated_at = now() where id = o.id;
      return jsonb_build_object('order_id', o.id, 'number', o.number, 'status', 'needs_refund', 'user_id', o.user_id);
    end if;
    update public.product_variants pv set reserved = pv.reserved + oi.qty from public.order_items oi where oi.order_id = o.id and oi.variant_id = pv.id;
  end if;

  -- convert the reservation into a sale
  for it in select oi.* from public.order_items oi where oi.order_id = o.id order by oi.variant_id loop
    update public.product_variants set stock = stock - it.qty, reserved = greatest(reserved - it.qty, 0) where id = it.variant_id;
    al := public._check_low_stock(it.variant_id);
    if al is not null then alerts := alerts || jsonb_build_array(al); end if;
  end loop;
  update public.orders set status = 'paid', paid_at = now(), reserved_until = null, provider_payment_id = p ->> 'provider_payment_id' where id = o.id;
  delete from public.cart_items ci using public.order_items oi
   where oi.order_id = o.id and ci.variant_id = oi.variant_id and ci.user_id = o.user_id;

  if coalesce((public._setting('notify_owner_on_order'))::boolean, true) then
    insert into public.owner_alerts (kind, message, payload)
    values ('order_paid', format('New order %s: ₹%s', o.number, to_char(o.total_paise / 100.0, 'FM9,99,99,990')),
            jsonb_build_object('order_id', o.id, 'number', o.number, 'total_paise', o.total_paise))
    returning to_jsonb(owner_alerts.*) into al;
    alerts := alerts || jsonb_build_array(al);
  end if;

  return jsonb_build_object('order_id', o.id, 'number', o.number, 'status', 'paid', 'already', false, 'user_id', o.user_id,
    'total_paise', o.total_paise, 'alerts', alerts,
    'items', (select jsonb_agg(jsonb_build_object('product', product_name, 'color', color_name, 'size', size, 'qty', qty, 'unit_price_paise', unit_price_paise))
              from public.order_items where order_id = o.id));
end $$;

create or replace function public.order_fail(p jsonb) returns jsonb language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid for update;
  if not found then perform public._fail('NOT_FOUND'); end if;
  if o.status <> 'pending_payment' then return jsonb_build_object('status', o.status); end if;
  update public.product_variants v set reserved = greatest(v.reserved - oi.qty, 0)
    from public.order_items oi where oi.order_id = o.id and oi.variant_id = v.id;
  update public.orders set status = 'payment_failed', reserved_until = null where id = o.id;
  return jsonb_build_object('status', 'payment_failed');
end $$;

create or replace function public.order_get(p jsonb) returns jsonb language plpgsql stable as $$
declare o public.orders;
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid
    and (not p ? 'user_id' or user_id = (p ->> 'user_id')::uuid);
  if not found then perform public._fail('NOT_FOUND'); end if;
  return to_jsonb(o) || jsonb_build_object('items',
    (select coalesce(jsonb_agg(to_jsonb(oi) order by oi.product_name), '[]') from public.order_items oi where oi.order_id = o.id));
end $$;

create or replace function public.account_orders(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total_paise', o.total_paise,
           'created_at', o.created_at, 'paid_at', o.paid_at,
           'items', (select jsonb_agg(jsonb_build_object('product', product_name, 'color', color_name, 'size', size, 'qty', qty)) from public.order_items where order_id = o.id))
         order by o.created_at desc), '[]')
  from public.orders o where o.user_id = (p ->> 'user_id')::uuid and o.status not in ('expired', 'payment_failed')
$$;

-- ================================================================ restock reminders
create or replace function public.reminder_set(p jsonb) returns jsonb language plpgsql as $$
declare
  uid uuid := (p ->> 'user_id')::uuid; v public.product_variants; pr public.products; c public.product_colors;
  n int; threshold int := coalesce((public._setting('reminder_alert_threshold'))::int, 10); alert jsonb := null;
begin
  select * into v from public.product_variants where id = (p ->> 'variant_id')::uuid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  if v.stock - v.reserved > 0 then perform public._fail('IN_STOCK'); end if;
  insert into public.restock_reminders (user_id, variant_id, product_id) values (uid, v.id, v.product_id) on conflict do nothing;
  select count(distinct user_id) into n from public.restock_reminders where product_id = v.product_id and notified_at is null;
  if n > threshold and not exists (select 1 from public.reminder_alert_state where product_id = v.product_id) then
    select * into pr from public.products where id = v.product_id;
    select * into c from public.product_colors where id = v.color_id;
    insert into public.reminder_alert_state (product_id, alerted_at) values (v.product_id, now());
    insert into public.owner_alerts (kind, product_id, variant_id, message, payload)
    values ('reminder_threshold', v.product_id, v.id,
            format('%s shoppers are waiting for %s to be restocked.', n, pr.name),
            jsonb_build_object('product', pr.name, 'waiting', n, 'threshold', threshold,
              'by_variant', (select jsonb_agg(jsonb_build_object('color', pc.name, 'size', pv.size, 'waiting', x.cnt))
                             from (select variant_id, count(*) cnt from public.restock_reminders where product_id = v.product_id and notified_at is null group by variant_id) x
                             join public.product_variants pv on pv.id = x.variant_id join public.product_colors pc on pc.id = pv.color_id)))
    returning to_jsonb(owner_alerts.*) into alert;
  end if;
  return jsonb_build_object('ok', true, 'waiting', n, 'alert', alert);
end $$;

create or replace function public.reminders_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'variant_id', r.variant_id, 'product', pr.name, 'slug', pr.slug,
           'color', c.name, 'size', v.size, 'created_at', r.created_at) order by r.created_at desc), '[]')
  from public.restock_reminders r join public.product_variants v on v.id = r.variant_id
  join public.products pr on pr.id = r.product_id join public.product_colors c on c.id = v.color_id
  where r.user_id = (p ->> 'user_id')::uuid and r.notified_at is null
$$;

create or replace function public.reminder_cancel(p jsonb) returns jsonb language sql as $$
  delete from public.restock_reminders where user_id = (p ->> 'user_id')::uuid and variant_id = (p ->> 'variant_id')::uuid and notified_at is null;
  select jsonb_build_object('ok', true)
$$;

-- ================================================================ inventory (owner)
-- Sets stock for one variant. If it goes from sold-out to available, returns the
-- shoppers to email and marks their reminders as sent.
create or replace function public._inventory_apply(vid uuid, new_stock int, new_threshold int) returns jsonb language plpgsql as $$
declare v public.product_variants; old_avail int; new_avail int; notify jsonb := '[]'; pr public.products; c public.product_colors;
begin
  select * into v from public.product_variants where id = vid for update;
  if not found then perform public._fail('NOT_FOUND'); end if;
  if new_stock < 0 then perform public._fail('BAD_STOCK'); end if;
  old_avail := v.stock - v.reserved;
  update public.product_variants set stock = new_stock, low_stock_threshold = coalesce(new_threshold, low_stock_threshold) where id = vid
    returning * into v;
  new_avail := v.stock - v.reserved;
  if new_avail > v.low_stock_threshold and v.low_stock_alerted then
    update public.product_variants set low_stock_alerted = false where id = vid;
  end if;
  if old_avail <= 0 and new_avail > 0 then
    select * into pr from public.products where id = v.product_id;
    select * into c from public.product_colors where id = v.color_id;
    with sent as (
      update public.restock_reminders set notified_at = now()
       where variant_id = vid and notified_at is null returning user_id)
    select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'variant_id', vid, 'product', pr.name, 'slug', pr.slug, 'color', c.name, 'size', v.size)), '[]')
      into notify from sent;
    -- a fresh wave of reminders may alert the owner again
    if not exists (select 1 from public.restock_reminders where product_id = v.product_id and notified_at is null) then
      delete from public.reminder_alert_state where product_id = v.product_id;
    end if;
    if jsonb_array_length(notify) > 0 then
      insert into public.owner_alerts (kind, product_id, variant_id, message, payload)
      values ('restock_sent', pr.id, vid, format('Restock emails sent to %s shoppers for %s (%s, %s).', jsonb_array_length(notify), pr.name, c.name, v.size),
              jsonb_build_object('count', jsonb_array_length(notify)));
    end if;
  end if;
  return jsonb_build_object('variant_id', vid, 'stock', v.stock, 'available', new_avail, 'notify', notify);
end $$;

create or replace function public.admin_inventory_set(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public._inventory_apply((p ->> 'variant_id')::uuid, (p ->> 'stock')::int, (p ->> 'low_stock_threshold')::int);
  insert into public.audit_log (actor_id, action, target, details)
    values ((p ->> 'actor_id')::uuid, 'inventory.set', p ->> 'variant_id', jsonb_build_object('stock', p -> 'stock', 'low_stock_threshold', p -> 'low_stock_threshold'));
  return r;
end $$;

create or replace function public.admin_inventory_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', v.id, 'sku', v.sku, 'product_id', pr.id, 'product', pr.name, 'status', pr.status,
      'color', c.name, 'hex', c.hex, 'size', v.size, 'stock', v.stock, 'reserved', v.reserved,
      'available', v.stock - v.reserved, 'low_stock_threshold', v.low_stock_threshold,
      'waiting', (select count(*) from public.restock_reminders r where r.variant_id = v.id and r.notified_at is null),
      'sold_30d', (select coalesce(sum(oi.qty), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                   where oi.variant_id = v.id and o.status in ('paid','packed','shipped','delivered') and o.paid_at > now() - interval '30 days')
    ) order by pr.sort, pr.name, c.sort, v.sort), '[]')
  from public.product_variants v join public.products pr on pr.id = v.product_id join public.product_colors c on c.id = v.color_id
  where pr.status <> 'archived'
$$;

-- ================================================================ products (owner)
create or replace function public.admin_product_save(p jsonb) returns jsonb language plpgsql as $$
declare
  d jsonb := p -> 'product';
  pid uuid := nullif(d ->> 'id', '')::uuid;
  col jsonb; var jsonb; med jsonb; rev jsonb;
  cid uuid; vid uuid; keep_colors uuid[] := '{}'; keep_variants uuid[] := '{}'; keep_reviews uuid[] := '{}';
  notify jsonb := '[]'; r jsonb; i int := 0;
  default_threshold int := coalesce((public._setting('low_stock_default'))::int, 5);
begin
  if coalesce(d ->> 'name', '') = '' then perform public._fail('NAME_REQUIRED'); end if;
  if coalesce((d ->> 'price_paise')::int, 0) <= 0 then perform public._fail('PRICE_REQUIRED'); end if;
  if pid is null then
    insert into public.products (slug, name, category_id, description, details, price_paise, discount_pct, garment_type, print_spec,
                                 print_front_url, print_back_url, audio_url, audio_title, status, is_new, sort)
    values (d ->> 'slug', d ->> 'name', nullif(d ->> 'category_id', '')::uuid, coalesce(d ->> 'description', ''),
            coalesce(array(select jsonb_array_elements_text(d -> 'details')), '{}'),
            (d ->> 'price_paise')::int, coalesce((d ->> 'discount_pct')::numeric, 0), coalesce(d ->> 'garment_type', 'oversized'),
            coalesce(d -> 'print_spec', '{}'), d ->> 'print_front_url', d ->> 'print_back_url', d ->> 'audio_url', d ->> 'audio_title',
            coalesce(d ->> 'status', 'draft'), coalesce((d ->> 'is_new')::boolean, true), coalesce((d ->> 'sort')::int, 0))
    returning id into pid;
  else
    update public.products set
      slug = d ->> 'slug', name = d ->> 'name', category_id = nullif(d ->> 'category_id', '')::uuid,
      description = coalesce(d ->> 'description', ''), details = coalesce(array(select jsonb_array_elements_text(d -> 'details')), '{}'),
      price_paise = (d ->> 'price_paise')::int, discount_pct = coalesce((d ->> 'discount_pct')::numeric, 0),
      garment_type = coalesce(d ->> 'garment_type', garment_type), print_spec = coalesce(d -> 'print_spec', print_spec),
      print_front_url = d ->> 'print_front_url', print_back_url = d ->> 'print_back_url',
      audio_url = d ->> 'audio_url', audio_title = d ->> 'audio_title',
      status = coalesce(d ->> 'status', status), is_new = coalesce((d ->> 'is_new')::boolean, is_new), sort = coalesce((d ->> 'sort')::int, sort)
    where id = pid;
    if not found then perform public._fail('NOT_FOUND'); end if;
  end if;

  -- colours (matched by name)
  for col in select value from jsonb_array_elements(coalesce(p -> 'colors', '[]')) loop
    i := i + 1;
    insert into public.product_colors (product_id, name, hex, ink_hex, sort)
    values (pid, col ->> 'name', col ->> 'hex', nullif(col ->> 'ink_hex', ''), i)
    on conflict (product_id, name) do update set hex = excluded.hex, ink_hex = excluded.ink_hex, sort = excluded.sort
    returning id into cid;
    keep_colors := keep_colors || cid;
  end loop;

  -- variants (matched by colour + size); stock changes go through the restock logic
  i := 0;
  for var in select value from jsonb_array_elements(coalesce(p -> 'variants', '[]')) loop
    i := i + 1;
    select id into cid from public.product_colors where product_id = pid and name = var ->> 'color';
    if cid is null then perform public._fail('UNKNOWN_COLOR', jsonb_build_object('color', var ->> 'color')); end if;
    select id into vid from public.product_variants where product_id = pid and color_id = cid and size = var ->> 'size';
    if vid is null then
      insert into public.product_variants (product_id, color_id, size, sku, stock, low_stock_threshold, sort)
      values (pid, cid, var ->> 'size',
              coalesce(nullif(var ->> 'sku', ''), upper(left(regexp_replace(d ->> 'slug', '[^a-z0-9]', '', 'g'), 10)) || '-' || upper(left(regexp_replace(lower(var ->> 'color'), '[^a-z0-9]', '', 'g'), 4)) || '-' || upper(var ->> 'size') || '-' || substr(encode(gen_random_bytes(2), 'hex'), 1, 4)),
              coalesce((var ->> 'stock')::int, 0), coalesce((var ->> 'low_stock_threshold')::int, default_threshold), i)
      returning id into vid;
    else
      update public.product_variants set sort = i where id = vid;
      r := public._inventory_apply(vid, coalesce((var ->> 'stock')::int, 0), coalesce((var ->> 'low_stock_threshold')::int, default_threshold));
      notify := notify || (r -> 'notify');
    end if;
    keep_variants := keep_variants || vid;
  end loop;
  if p ? 'variants' then
    delete from public.product_variants where product_id = pid and not (id = any (keep_variants))
      and not exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                      where oi.variant_id = product_variants.id and o.status = 'pending_payment');
  end if;
  if p ? 'colors' then
    delete from public.product_colors where product_id = pid and not (id = any (keep_colors))
      and not exists (select 1 from public.product_variants pv where pv.color_id = product_colors.id);
  end if;

  -- media: replaced as a list
  if p ? 'media' then
    delete from public.product_media where product_id = pid;
    i := 0;
    for med in select value from jsonb_array_elements(p -> 'media') loop
      i := i + 1;
      insert into public.product_media (product_id, color_id, kind, url, poster_url, alt, sort)
      values (pid, (select id from public.product_colors where product_id = pid and name = med ->> 'color'),
              med ->> 'kind', med ->> 'url', med ->> 'poster_url', coalesce(med ->> 'alt', ''), i);
    end loop;
  end if;

  -- reviews: entered by the owner
  if p ? 'reviews' then
    for rev in select value from jsonb_array_elements(p -> 'reviews') loop
      if nullif(rev ->> 'id', '') is null then
        insert into public.product_reviews (product_id, author_name, rating, title, body, is_published, created_at)
        values (pid, rev ->> 'author', (rev ->> 'rating')::int, coalesce(rev ->> 'title', ''), coalesce(rev ->> 'body', ''),
                coalesce((rev ->> 'is_published')::boolean, true), coalesce((rev ->> 'date')::timestamptz, now()))
        returning id into vid;
      else
        update public.product_reviews set author_name = rev ->> 'author', rating = (rev ->> 'rating')::int, title = coalesce(rev ->> 'title', ''),
          body = coalesce(rev ->> 'body', ''), is_published = coalesce((rev ->> 'is_published')::boolean, true)
        where id = (rev ->> 'id')::uuid and product_id = pid returning id into vid;
      end if;
      keep_reviews := keep_reviews || vid;
    end loop;
    delete from public.product_reviews where product_id = pid and not (id = any (keep_reviews));
  end if;

  insert into public.audit_log (actor_id, action, target, details) values ((p ->> 'actor_id')::uuid, 'product.save', pid::text, jsonb_build_object('name', d ->> 'name'));
  return jsonb_build_object('product_id', pid, 'notify', notify);
end $$;

create or replace function public.admin_product_get(p jsonb) returns jsonb language plpgsql stable as $$
declare pr public.products;
begin
  select * into pr from public.products where id = (p ->> 'id')::uuid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  return public._product_json(pr, false) || jsonb_build_object(
    'category_id', pr.category_id, 'price_paise', pr.price_paise, 'sort', pr.sort,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'color', c.name, 'size', v.size, 'sku', v.sku, 'stock', v.stock,
                  'reserved', v.reserved, 'low_stock_threshold', v.low_stock_threshold,
                  'waiting', (select count(*) from public.restock_reminders r where r.variant_id = v.id and r.notified_at is null)) order by c.sort, v.sort)
                  from public.product_variants v join public.product_colors c on c.id = v.color_id where v.product_id = pr.id), '[]'),
    'media', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'url', m.url, 'poster_url', m.poster_url, 'alt', m.alt,
                  'color', (select name from public.product_colors where id = m.color_id)) order by m.sort)
                  from public.product_media m where m.product_id = pr.id), '[]'),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'author', r.author_name, 'rating', r.rating, 'title', r.title, 'body', r.body,
                  'is_published', r.is_published, 'date', r.created_at) order by r.created_at desc)
                  from public.product_reviews r where r.product_id = pr.id), '[]'));
end $$;

create or replace function public.admin_products_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'slug', pr.slug, 'name', pr.name, 'status', pr.status,
           'category', (select name from public.categories where id = pr.category_id),
           'price_paise', pr.price_paise, 'discount_pct', pr.discount_pct, 'garment_type', pr.garment_type,
           'colors', (select jsonb_agg(jsonb_build_object('name', name, 'hex', hex) order by sort) from public.product_colors where product_id = pr.id),
           'stock', (select coalesce(sum(stock - reserved), 0) from public.product_variants where product_id = pr.id),
           'low_variants', (select count(*) from public.product_variants where product_id = pr.id and stock - reserved <= low_stock_threshold),
           'waiting', (select count(distinct user_id) from public.restock_reminders where product_id = pr.id and notified_at is null),
           'updated_at', pr.updated_at) order by pr.sort, pr.created_at desc), '[]')
  from public.products pr where pr.status <> 'archived' or coalesce((p ->> 'include_archived')::boolean, false)
$$;

create or replace function public.admin_product_status(p jsonb) returns jsonb language plpgsql as $$
begin
  if p ->> 'status' not in ('draft', 'live', 'archived') then perform public._fail('BAD_STATUS'); end if;
  update public.products set status = p ->> 'status' where id = (p ->> 'id')::uuid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  insert into public.audit_log (actor_id, action, target, details) values ((p ->> 'actor_id')::uuid, 'product.status', p ->> 'id', jsonb_build_object('status', p ->> 'status'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_category_save(p jsonb) returns jsonb language plpgsql as $$
declare cid uuid := nullif(p ->> 'id', '')::uuid;
begin
  if cid is null then
    insert into public.categories (slug, name, description, sort, is_active)
    values (p ->> 'slug', p ->> 'name', coalesce(p ->> 'description', ''), coalesce((p ->> 'sort')::int, 0), coalesce((p ->> 'is_active')::boolean, true))
    returning id into cid;
  else
    update public.categories set slug = p ->> 'slug', name = p ->> 'name', description = coalesce(p ->> 'description', ''),
      sort = coalesce((p ->> 'sort')::int, sort), is_active = coalesce((p ->> 'is_active')::boolean, is_active) where id = cid;
  end if;
  return jsonb_build_object('id', cid);
end $$;

create or replace function public.admin_categories_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'sort', c.sort, 'is_active', c.is_active,
           'products', (select count(*) from public.products where category_id = c.id and status <> 'archived')) order by c.sort, c.name), '[]')
  from public.categories c
$$;

create or replace function public.admin_category_delete(p jsonb) returns jsonb language sql as $$
  delete from public.categories where id = (p ->> 'id')::uuid;
  select jsonb_build_object('ok', true)
$$;

-- ================================================================ orders (owner)
create or replace function public.admin_orders_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]') from (
    select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total_paise', o.total_paise,
             'created_at', o.created_at, 'paid_at', o.paid_at, 'enc_shipping', o.enc_shipping, 'ship_state', o.ship_state,
             'device_type', o.device_type, 'os', o.os, 'user_id', o.user_id,
             'items', (select jsonb_agg(jsonb_build_object('product', product_name, 'color', color_name, 'size', size, 'qty', qty)) from public.order_items where order_id = o.id)) x
    from public.orders o
    where (not p ? 'status' or o.status = p ->> 'status')
      and o.status not in ('expired') and (coalesce((p ->> 'include_pending')::boolean, false) or o.status <> 'pending_payment')
    order by o.created_at desc
    limit least(coalesce((p ->> 'limit')::int, 100), 500) offset coalesce((p ->> 'offset')::int, 0)) s
$$;

create or replace function public.admin_order_status_set(p jsonb) returns jsonb language plpgsql as $$
declare o public.orders; ns text := p ->> 'status'; it record;
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid for update;
  if not found then perform public._fail('NOT_FOUND'); end if;
  if not (
    (o.status = 'paid' and ns in ('packed', 'cancelled', 'refunded')) or
    (o.status = 'packed' and ns in ('shipped', 'cancelled', 'refunded')) or
    (o.status = 'shipped' and ns in ('delivered', 'refunded')) or
    (o.status = 'delivered' and ns = 'refunded')) then
    perform public._fail('BAD_TRANSITION', jsonb_build_object('from', o.status, 'to', ns));
  end if;
  -- cancelled before shipping: units go back on the shelf
  if ns in ('cancelled', 'refunded') and o.status in ('paid', 'packed') then
    for it in select * from public.order_items where order_id = o.id loop
      perform public._inventory_apply(it.variant_id, (select stock from public.product_variants where id = it.variant_id) + it.qty, null);
    end loop;
  end if;
  update public.orders set status = ns where id = o.id;
  insert into public.audit_log (actor_id, action, target, details) values ((p ->> 'actor_id')::uuid, 'order.status', o.number, jsonb_build_object('from', o.status, 'to', ns));
  return jsonb_build_object('ok', true, 'status', ns);
end $$;

-- ================================================================ alerts & settings
create or replace function public.alerts_mark_emailed(p jsonb) returns jsonb language sql as $$
  update public.owner_alerts set emailed_at = now() where id in (select (jsonb_array_elements_text(p -> 'ids'))::uuid);
  select jsonb_build_object('ok', true)
$$;

create or replace function public.admin_alerts_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]') from (
    select * from public.owner_alerts
    where not coalesce((p ->> 'unread_only')::boolean, false) or read_at is null
    order by created_at desc limit 200) a
$$;

create or replace function public.admin_alerts_read(p jsonb) returns jsonb language sql as $$
  update public.owner_alerts set read_at = now()
   where read_at is null and (not p ? 'id' or id = (p ->> 'id')::uuid);
  select jsonb_build_object('ok', true)
$$;

create or replace function public.settings_get(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(key, value), '{}') from public.settings
$$;

create or replace function public.settings_set(p jsonb) returns jsonb language plpgsql as $$
declare k text;
begin
  for k in select jsonb_object_keys(p -> 'values') loop
    if k not in ('low_stock_default', 'reminder_alert_threshold', 'owner_alert_email', 'notify_owner_on_order', 'audio_volume', 'shipping', 'reservation_minutes') then
      perform public._fail('UNKNOWN_SETTING', jsonb_build_object('key', k));
    end if;
    insert into public.settings (key, value, updated_at) values (k, p -> 'values' -> k, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
  insert into public.audit_log (actor_id, action, details) values ((p ->> 'actor_id')::uuid, 'settings.set', p -> 'values');
  return public.settings_get('{}');
end $$;

-- ================================================================ people
create or replace function public.profile_upsert(p jsonb) returns jsonb language plpgsql as $$
begin
  insert into public.profiles (id, email_bidx, enc_email, enc_full_name, consent_analytics, consent_at)
  values ((p ->> 'id')::uuid, p ->> 'email_bidx', p ->> 'enc_email', p ->> 'enc_full_name',
          coalesce((p ->> 'consent_analytics')::boolean, false), case when (p ->> 'consent_analytics')::boolean then now() end)
  on conflict (id) do update set
    email_bidx = coalesce(excluded.email_bidx, profiles.email_bidx),
    enc_email = coalesce(excluded.enc_email, profiles.enc_email),
    enc_full_name = coalesce(excluded.enc_full_name, profiles.enc_full_name);
  return public.profile_get(p);
end $$;

create or replace function public.profile_get(p jsonb) returns jsonb language sql stable as $$
  select to_jsonb(pr) || jsonb_build_object('address', (select to_jsonb(a) from public.addresses a where a.user_id = pr.id and a.is_default order by created_at desc limit 1))
  from public.profiles pr where pr.id = (p ->> 'id')::uuid
$$;

create or replace function public.profile_update(p jsonb) returns jsonb language plpgsql as $$
declare uid uuid := (p ->> 'id')::uuid;
begin
  update public.profiles set
    enc_full_name = coalesce(p ->> 'enc_full_name', enc_full_name),
    enc_phone = case when p ? 'enc_phone' then p ->> 'enc_phone' else enc_phone end,
    enc_age = case when p ? 'enc_age' then p ->> 'enc_age' else enc_age end,
    enc_gender = case when p ? 'enc_gender' then p ->> 'enc_gender' else enc_gender end,
    consent_analytics = coalesce((p ->> 'consent_analytics')::boolean, consent_analytics),
    consent_at = case when p ? 'consent_analytics' then now() else consent_at end,
    deletion_requested_at = case when (p ->> 'request_deletion')::boolean then now() else deletion_requested_at end
  where id = uid;
  if (p ->> 'request_deletion')::boolean then
    insert into public.owner_alerts (kind, message, payload)
    values ('account_deletion', 'A shopper asked for their account and personal data to be deleted.', jsonb_build_object('user_id', uid));
  end if;
  if p ? 'enc_address' then
    update public.addresses set is_default = false where user_id = uid;
    insert into public.addresses (user_id, enc_payload, ship_state, is_default) values (uid, p ->> 'enc_address', p ->> 'ship_state', true);
  end if;
  return public.profile_get(p);
end $$;

create or replace function public.owner_emails(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'enc_email', enc_email)), '[]') from public.profiles where role = 'owner'
$$;

create or replace function public.users_enc_emails(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(id, enc_email), '{}') from public.profiles
  where id in (select (jsonb_array_elements_text(p -> 'ids'))::uuid)
$$;

-- ================================================================ analytics
create or replace function public.events_insert(p jsonb) returns jsonb language plpgsql as $$
declare n int;
begin
  insert into public.events (occurred_at, session_id, anon_id, user_id, name, path, product_id, variant_id, props,
                             device_type, os, browser, referrer, utm_source, utm_medium, utm_campaign, country)
  select least(coalesce((e ->> 'ts')::timestamptz, now()), now()), left(e ->> 'session_id', 64), left(e ->> 'anon_id', 64),
         nullif(e ->> 'user_id', '')::uuid, left(e ->> 'name', 48), left(e ->> 'path', 300),
         nullif(e ->> 'product_id', '')::uuid, nullif(e ->> 'variant_id', '')::uuid, coalesce(e -> 'props', '{}'),
         left(e ->> 'device_type', 16), left(e ->> 'os', 24), left(e ->> 'browser', 24), left(e ->> 'referrer', 300),
         left(e ->> 'utm_source', 80), left(e ->> 'utm_medium', 80), left(e ->> 'utm_campaign', 120), left(e ->> 'country', 4)
  from jsonb_array_elements(p -> 'events') e
  where (nullif(e ->> 'product_id', '') is null or exists (select 1 from public.products where id = (e ->> 'product_id')::uuid));
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n);
end $$;

create or replace function public.identity_link(p jsonb) returns jsonb language plpgsql as $$
begin
  insert into public.identity_links (anon_id, user_id) values (p ->> 'anon_id', (p ->> 'user_id')::uuid) on conflict do nothing;
  update public.events set user_id = (p ->> 'user_id')::uuid where anon_id = p ->> 'anon_id' and user_id is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.analytics_summary(p jsonb) returns jsonb language plpgsql stable as $$
declare
  t0 timestamptz := coalesce((p ->> 'from')::timestamptz, now() - interval '30 days');
  t1 timestamptz := coalesce((p ->> 'to')::timestamptz, now());
  paid text[] := array['paid', 'packed', 'shipped', 'delivered'];
begin
  return jsonb_build_object(
    'range', jsonb_build_object('from', t0, 'to', t1),
    'kpis', jsonb_build_object(
      'visitors', (select count(distinct coalesce(anon_id, session_id)) from public.events where occurred_at between t0 and t1),
      'sessions', (select count(distinct session_id) from public.events where occurred_at between t0 and t1),
      'product_views', (select count(*) from public.events where name = 'product_view' and occurred_at between t0 and t1),
      'add_to_cart', (select count(*) from public.events where name in ('add_to_cart', 'buy_now') and occurred_at between t0 and t1),
      'checkouts', (select count(*) from public.events where name = 'checkout_start' and occurred_at between t0 and t1),
      'orders', (select count(*) from public.orders where status = any (paid) and paid_at between t0 and t1),
      'revenue_paise', (select coalesce(sum(total_paise), 0) from public.orders where status = any (paid) and paid_at between t0 and t1),
      'units', (select coalesce(sum(oi.qty), 0) from public.order_items oi join public.orders o on o.id = oi.order_id where o.status = any (paid) and o.paid_at between t0 and t1),
      'signups', (select count(*) from public.profiles where created_at between t0 and t1),
      'reminders_active', (select count(*) from public.restock_reminders where notified_at is null)),
    'funnel', (select jsonb_agg(jsonb_build_object('step', s.step, 'sessions', s.n) order by s.ord) from (
      select 1 ord, 'Visited' step, count(distinct session_id) n from public.events where occurred_at between t0 and t1
      union all select 2, 'Viewed a product', count(distinct session_id) from public.events where name in ('product_view', 'try_on_open') and occurred_at between t0 and t1
      union all select 3, 'Added to bag', count(distinct session_id) from public.events where name in ('add_to_cart', 'buy_now') and occurred_at between t0 and t1
      union all select 4, 'Started checkout', count(distinct session_id) from public.events where name = 'checkout_start' and occurred_at between t0 and t1
      union all select 5, 'Paid', count(distinct session_id) from public.events where name = 'purchase' and occurred_at between t0 and t1) s),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'visitors', d.visitors, 'orders', d.orders, 'revenue_paise', d.revenue) order by d.day), '[]') from (
      select g::date as day,
        (select count(distinct coalesce(anon_id, session_id)) from public.events where occurred_at >= g and occurred_at < g + interval '1 day') visitors,
        (select count(*) from public.orders where status = any (paid) and paid_at >= g and paid_at < g + interval '1 day') orders,
        (select coalesce(sum(total_paise), 0) from public.orders where status = any (paid) and paid_at >= g and paid_at < g + interval '1 day') revenue
      from generate_series(date_trunc('day', t0), date_trunc('day', t1), interval '1 day') g) d),
    'top_products', (select coalesce(jsonb_agg(x order by (x ->> 'units')::int desc, (x ->> 'views')::int desc), '[]') from (
      select jsonb_build_object('product_id', pr.id, 'name', pr.name,
        'views', (select count(*) from public.events e where e.product_id = pr.id and e.name = 'product_view' and e.occurred_at between t0 and t1),
        'adds', (select count(*) from public.events e where e.product_id = pr.id and e.name in ('add_to_cart', 'buy_now') and e.occurred_at between t0 and t1),
        'units', (select coalesce(sum(oi.qty), 0) from public.order_items oi join public.orders o on o.id = oi.order_id where oi.product_id = pr.id and o.status = any (paid) and o.paid_at between t0 and t1),
        'revenue_paise', (select coalesce(sum(oi.qty * oi.unit_price_paise), 0) from public.order_items oi join public.orders o on o.id = oi.order_id where oi.product_id = pr.id and o.status = any (paid) and o.paid_at between t0 and t1),
        'waiting', (select count(distinct user_id) from public.restock_reminders r where r.product_id = pr.id and r.notified_at is null)) x
      from public.products pr where pr.status <> 'archived' limit 50) s),
    'colors_sizes', (select coalesce(jsonb_agg(jsonb_build_object('color', color_name, 'size', size, 'units', u) order by u desc), '[]') from (
      select oi.color_name, oi.size, sum(oi.qty) u from public.order_items oi join public.orders o on o.id = oi.order_id
      where o.status = any (paid) and o.paid_at between t0 and t1 group by 1, 2) s),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', coalesce(device_type, 'unknown'), 'os', coalesce(os, 'unknown'), 'sessions', n) order by n desc), '[]') from (
      select device_type, os, count(distinct session_id) n from public.events where occurred_at between t0 and t1 group by 1, 2) s),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('source', src, 'sessions', n) order by n desc), '[]') from (
      select coalesce(nullif(utm_source, ''), nullif(split_part(split_part(referrer, '://', 2), '/', 1), ''), 'direct') src, count(distinct session_id) n
      from public.events where occurred_at between t0 and t1 and name = 'page_view' group by 1 order by 2 desc limit 10) s),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', coalesce(ship_state, 'unknown'), 'orders', n) order by n desc), '[]') from (
      select ship_state, count(*) n from public.orders where status = any (paid) and paid_at between t0 and t1 group by 1) s),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]') from (
      select name, count(*) n from public.events where occurred_at between t0 and t1 group by 1) s),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('product', pr.name, 'color', c.name, 'size', v.size, 'available', v.stock - v.reserved, 'threshold', v.low_stock_threshold) order by v.stock - v.reserved), '[]')
      from public.product_variants v join public.products pr on pr.id = v.product_id join public.product_colors c on c.id = v.color_id
      where pr.status = 'live' and v.stock - v.reserved <= v.low_stock_threshold)
  );
end $$;

-- rows for the owner's CSV downloads (personal fields are decrypted by the API server)
create or replace function public.export_rows(p jsonb) returns jsonb language plpgsql stable as $$
declare
  t0 timestamptz := coalesce((p ->> 'from')::timestamptz, now() - interval '90 days');
  t1 timestamptz := coalesce((p ->> 'to')::timestamptz, now());
begin
  case p ->> 'dataset'
  when 'orders' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'order_number', o.number, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at,
        'subtotal_inr', o.subtotal_paise / 100.0, 'shipping_inr', o.shipping_paise / 100.0, 'total_inr', o.total_paise / 100.0,
        'mrp_inr', o.mrp_paise / 100.0, 'items', (select string_agg(format('%s | %s | %s x%s @%s', product_name, color_name, size, qty, unit_price_paise / 100.0), '; ') from public.order_items where order_id = o.id),
        'device', o.device_type, 'os', o.os, 'browser', o.browser, 'payment_id', o.provider_payment_id,
        'user_id', o.user_id, 'enc_shipping', o.enc_shipping, 'enc_age', pr.enc_age, 'enc_gender', pr.enc_gender) order by o.created_at), '[]')
      from public.orders o left join public.profiles pr on pr.id = o.user_id
      where o.created_at between t0 and t1 and o.status <> 'expired');
  when 'customers' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', pr.id, 'signed_up', pr.created_at, 'role', pr.role, 'consent_analytics', pr.consent_analytics,
        'enc_email', pr.enc_email, 'enc_full_name', pr.enc_full_name, 'enc_phone', pr.enc_phone, 'enc_age', pr.enc_age, 'enc_gender', pr.enc_gender,
        'enc_address', (select enc_payload from public.addresses a where a.user_id = pr.id and a.is_default order by created_at desc limit 1),
        'orders', (select count(*) from public.orders o where o.user_id = pr.id and o.status in ('paid','packed','shipped','delivered')),
        'spent_inr', (select coalesce(sum(total_paise), 0) / 100.0 from public.orders o where o.user_id = pr.id and o.status in ('paid','packed','shipped','delivered')),
        'reminders', (select count(*) from public.restock_reminders r where r.user_id = pr.id and r.notified_at is null),
        'first_seen', (select min(occurred_at) from public.events e where e.user_id = pr.id),
        'sessions', (select count(distinct session_id) from public.events e where e.user_id = pr.id)) order by pr.created_at), '[]')
      from public.profiles pr where pr.created_at <= t1);
  when 'events' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'time', e.occurred_at, 'event', e.name, 'session_id', e.session_id, 'visitor_id', e.anon_id, 'user_id', e.user_id,
        'path', e.path, 'product', (select name from public.products where id = e.product_id), 'props', e.props,
        'device', e.device_type, 'os', e.os, 'browser', e.browser, 'referrer', e.referrer,
        'utm_source', e.utm_source, 'utm_medium', e.utm_medium, 'utm_campaign', e.utm_campaign, 'country', e.country) order by e.occurred_at), '[]')
      from (select * from public.events where occurred_at between t0 and t1 order by occurred_at limit 100000) e);
  when 'inventory' then
    return public.admin_inventory_list('{}');
  else
    perform public._fail('BAD_DATASET');
  end case;
end $$;

-- ================================================================ abuse protection
create or replace function public.rate_limit_hit(p jsonb) returns jsonb language plpgsql as $$
declare k text := p ->> 'key'; lim int := (p ->> 'limit')::int; win int := (p ->> 'window_seconds')::int; r public.rate_limits;
begin
  insert into public.rate_limits as rl (key, window_start, count) values (k, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start < now() - make_interval(secs => win) then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < now() - make_interval(secs => win) then now() else rl.window_start end
  returning * into r;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return jsonb_build_object('allowed', r.count <= lim, 'count', r.count, 'retry_after', greatest(0, win - extract(epoch from now() - r.window_start)::int));
end $$;

create or replace function public.audit(p jsonb) returns jsonb language sql as $$
  insert into public.audit_log (actor_id, action, target, details) values ((p ->> 'actor_id')::uuid, p ->> 'action', p ->> 'target', coalesce(p -> 'details', '{}'));
  select jsonb_build_object('ok', true)
$$;

-- Everything one customer did from landing to paying: their events since their previous
-- purchase (max 30 days), across visits, linked by account and by the visit that paid.
create or replace function public.order_journey(p jsonb) returns jsonb language plpgsql stable as $$
declare o public.orders; t_end timestamptz; t_start timestamptz;
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  t_end := coalesce(o.paid_at, o.created_at) + interval '10 minutes';
  t_start := greatest(coalesce(o.paid_at, o.created_at) - interval '30 days',
    coalesce((select max(paid_at) from public.orders x where x.user_id = o.user_id and x.id <> o.id and x.paid_at < coalesce(o.paid_at, o.created_at)), '-infinity'));
  return jsonb_build_object(
    'order', jsonb_build_object('number', o.number, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at,
                                'device_type', o.device_type, 'os', o.os, 'browser', o.browser, 'total_paise', o.total_paise),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'name', e.name, 'path', e.path, 'product', pr.name,
                  'props', e.props, 'session_id', e.session_id, 'device_type', e.device_type, 'os', e.os, 'referrer', e.referrer,
                  'utm_source', e.utm_source, 'utm_campaign', e.utm_campaign) order by e.occurred_at)
      from (select * from public.events ev
            where ((o.user_id is not null and ev.user_id = o.user_id) or (o.session_id is not null and ev.session_id = o.session_id))
              and ev.occurred_at between t_start and t_end
            order by ev.occurred_at desc limit 400) e
      left join public.products pr on pr.id = e.product_id), '[]'));
end $$;

-- ================================================================ permissions
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
