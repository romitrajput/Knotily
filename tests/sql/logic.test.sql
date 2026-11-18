-- Business-rule tests. Run on a fresh database with the shim, migrations and seed loaded.
\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;

-- test users
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'u' || g || '@test.in' from generate_series(1, 14) g;
insert into public.profiles (id, enc_email) select id, 'enc:' || email from auth.users;
update public.profiles set role = 'owner' where id = '00000000-0000-0000-0000-000000000014';

create temp table t_ids as
select (select v.id from product_variants v join products p on p.id = v.product_id join product_colors c on c.id = v.color_id
        where p.slug = 'after-hours-oversized-tee' and c.name = 'Latex Black' and v.size = 'M') as oos,
       (select v.id from product_variants v join products p on p.id = v.product_id join product_colors c on c.id = v.color_id
        where p.slug = 'bad-idea-oversized-tee' and c.name = 'Red Light' and v.size = 'S') as low2;
grant all on t_ids to public;

do $$
declare oos uuid; low2 uuid; u1 uuid := '00000000-0000-0000-0000-000000000001'; u2 uuid := '00000000-0000-0000-0000-000000000002';
  r jsonb; o1 jsonb; o2 jsonb; failed boolean; cnt int;
begin
  select t.oos, t.low2 into oos, low2 from t_ids t;

  -- 1. out-of-stock variants cannot go in the cart
  failed := false;
  begin perform cart_set(jsonb_build_object('user_id', u1, 'variant_id', oos, 'qty', 1));
  exception when others then failed := sqlerrm = 'OUT_OF_STOCK'; end;
  assert failed, '1: OUT_OF_STOCK expected';

  -- 2. asking for more than is left is refused, with the available count
  failed := false;
  begin perform cart_set(jsonb_build_object('user_id', u1, 'variant_id', low2, 'qty', 3));
  exception when others then failed := sqlerrm = 'INSUFFICIENT_STOCK'; end;
  assert failed, '2: INSUFFICIENT_STOCK expected';
  r := cart_set(jsonb_build_object('user_id', u1, 'variant_id', low2, 'qty', 2));
  assert (r ->> 'count')::int = 2, '2b: cart count';
  assert (r ->> 'subtotal_paise')::int > 0, '2c: subtotal';

  -- 3. checkout reserves stock; a second shopper cannot take the same last units
  o1 := order_create(jsonb_build_object('user_id', u1, 'enc_shipping', 'x', 'ship_state', 'West Bengal', 'provider', 'mock'));
  assert (select reserved from product_variants where id = low2) = 2, '3: reserved';
  failed := false;
  begin perform order_create(jsonb_build_object('user_id', u2, 'enc_shipping', 'x', 'items', jsonb_build_array(jsonb_build_object('variant_id', low2, 'qty', 1))));
  exception when others then failed := sqlerrm = 'OUT_OF_STOCK'; end;
  assert failed, '3b: reserved units are not sold twice';

  -- 4. payment converts the reservation into a sale, alerts the owner, empties the cart; repeating is harmless
  r := order_mark_paid(jsonb_build_object('order_id', o1 ->> 'order_id', 'provider_payment_id', 'pay_1'));
  assert r ->> 'status' = 'paid', '4: paid';
  assert (select stock from product_variants where id = low2) = 0 and (select reserved from product_variants where id = low2) = 0, '4b: stock decremented';
  assert exists (select 1 from owner_alerts where variant_id = low2 and kind = 'out_of_stock'), '4c: out-of-stock alert';
  assert not exists (select 1 from cart_items where user_id = u1), '4d: cart emptied';
  r := order_mark_paid(jsonb_build_object('order_id', o1 ->> 'order_id', 'provider_payment_id', 'pay_1'));
  assert (r ->> 'already')::boolean, '4e: idempotent';
  assert (select stock from product_variants where id = low2) = 0, '4f: not double-decremented';

  -- 5. abandoned checkouts give their stock back
  o2 := order_create(jsonb_build_object('user_id', u2, 'enc_shipping', 'x', 'items',
          jsonb_build_array(jsonb_build_object('variant_id', (select id from product_variants where stock > 5 limit 1), 'qty', 1))));
  update orders set reserved_until = now() - interval '1 minute' where id = (o2 ->> 'order_id')::uuid;
  r := release_expired_reservations('{}');
  assert (r ->> 'released')::int = 1, '5: released';
  assert (select status from orders where id = (o2 ->> 'order_id')::uuid) = 'expired', '5b: expired';

  -- 6. reminders: only for sold-out sizes; the owner is told once when more than 10 shoppers wait
  failed := false;
  begin perform reminder_set(jsonb_build_object('user_id', u1, 'variant_id', (select id from product_variants where stock > 5 limit 1)));
  exception when others then failed := sqlerrm = 'IN_STOCK'; end;
  assert failed, '6: no reminders for in-stock sizes';
  for i in 1..10 loop
    r := reminder_set(jsonb_build_object('user_id', ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'variant_id', oos));
    assert r -> 'alert' = 'null'::jsonb, '6b: no alert at ' || i;
  end loop;
  r := reminder_set(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000011', 'variant_id', oos));
  assert (r ->> 'waiting')::int = 11 and r -> 'alert' <> 'null'::jsonb, '6c: alert when the 11th shopper waits';
  r := reminder_set(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000012', 'variant_id', oos));
  assert r -> 'alert' = 'null'::jsonb, '6d: alert only once';
  r := reminder_set(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000012', 'variant_id', oos));
  assert (r ->> 'waiting')::int = 12, '6e: duplicate reminder ignored';

  -- 7. restocking emails every waiting shopper exactly once and re-arms the owner alert
  r := admin_inventory_set(jsonb_build_object('variant_id', oos, 'stock', 20, 'actor_id', '00000000-0000-0000-0000-000000000014'));
  assert jsonb_array_length(r -> 'notify') = 12, '7: 12 shoppers to notify, got ' || jsonb_array_length(r -> 'notify');
  assert not exists (select 1 from restock_reminders where variant_id = oos and notified_at is null), '7b: reminders marked sent';
  assert not exists (select 1 from reminder_alert_state), '7c: alert re-armed';
  r := admin_inventory_set(jsonb_build_object('variant_id', oos, 'stock', 25));
  assert jsonb_array_length(r -> 'notify') = 0, '7d: no repeat emails';

  -- 8. cancelling a paid order puts units back
  r := admin_order_status_set(jsonb_build_object('order_id', o1 ->> 'order_id', 'status', 'cancelled'));
  assert (select stock from product_variants where id = low2) = 2, '8: units returned';
  failed := false;
  begin perform admin_order_status_set(jsonb_build_object('order_id', o1 ->> 'order_id', 'status', 'shipped'));
  exception when others then failed := sqlerrm = 'BAD_TRANSITION'; end;
  assert failed, '8b: no shipping a cancelled order';

  -- 9. discounts are applied server-side and rounded to the rupee
  assert _sale_price(159000, 10) = 143100, '9: 10% off 1590 = 1431, got ' || _sale_price(159000, 10);

  -- 10. analytics and exports run
  perform events_insert(jsonb_build_object('events', jsonb_build_array(
    jsonb_build_object('session_id', 's1', 'anon_id', 'a1', 'name', 'page_view', 'path', '/', 'device_type', 'phone', 'os', 'android'),
    jsonb_build_object('session_id', 's1', 'anon_id', 'a1', 'name', 'product_view', 'product_id', (select id from products limit 1)))));
  perform identity_link(jsonb_build_object('anon_id', 'a1', 'user_id', u1));
  assert (select count(*) from events where user_id = u1) = 2, '10: events stitched to the account';
  r := analytics_summary('{}');
  assert (r -> 'kpis' ->> 'sessions')::int = 1, '10b: sessions';
  assert jsonb_array_length(export_rows('{"dataset":"orders"}')) >= 1, '10c: orders export';
  assert jsonb_array_length(export_rows('{"dataset":"customers"}')) = 14, '10d: customers export';

  -- 11. rate limiter
  for i in 1..3 loop r := rate_limit_hit('{"key":"t","limit":3,"window_seconds":60}'); end loop;
  assert (r ->> 'allowed')::boolean, '11: 3rd allowed';
  r := rate_limit_hit('{"key":"t","limit":3,"window_seconds":60}');
  assert not (r ->> 'allowed')::boolean, '11b: 4th blocked';

  raise notice 'ALL LOGIC TESTS PASSED';
end $$;

-- 12. the public keys can read and run nothing
set local role anon;
do $$ declare failed boolean := false; begin
  begin perform 1 from public.products limit 1; exception when insufficient_privilege then failed := true; end;
  assert failed, '12: anon cannot read tables';
  failed := false;
  begin perform public.catalog('{}'); exception when insufficient_privilege then failed := true; end;
  assert failed, '12b: anon cannot call functions';
end $$;
reset role;
set local role authenticated;
do $$ declare failed boolean := false; begin
  begin perform 1 from public.orders limit 1; exception when insufficient_privilege then failed := true; end;
  assert failed, '12c: signed-in users cannot read orders directly';
  failed := false;
  begin perform 1 from public.wishlist_items limit 1; exception when insufficient_privilege then failed := true; end;
  assert failed, '12d: signed-in users cannot read wishlists directly';
  failed := false;
  begin perform public.admin_banner_save('{"placement":"announcement","title":"x"}'); exception when insufficient_privilege then failed := true; end;
  assert failed, '12e: signed-in users cannot change banners';
end $$;
reset role;
do $$ begin raise notice 'PERMISSION TESTS PASSED'; end $$;
rollback;
