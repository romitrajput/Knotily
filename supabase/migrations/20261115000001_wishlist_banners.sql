-- Wishlist (per account) and owner-managed homepage content (hero slides, full-width
-- banners, collection tiles, and the announcement bar).

create table public.wishlist_items (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index wishlist_items_product_idx on public.wishlist_items (product_id);

create table public.banners (
  id               uuid primary key default gen_random_uuid(),
  placement        text not null default 'hero' check (placement in ('announcement', 'hero', 'strip', 'tile')),
  title            text not null default '' check (char_length(title) <= 120),
  subtitle         text not null default '' check (char_length(subtitle) <= 200),
  cta_label        text not null default 'Shop now' check (char_length(cta_label) <= 30),
  link_url         text not null default '/shop' check (char_length(link_url) <= 300),
  image_url        text,
  mobile_image_url text,
  theme            text not null default 'dark' check (theme in ('light', 'dark')), -- dark = white text over a darker photo
  sort             int not null default 0,
  is_active        boolean not null default true,
  starts_at        timestamptz,
  ends_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (placement = 'announcement' or image_url is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger t_banners_touch before update on public.banners for each row execute function public.touch_updated_at();

alter table public.wishlist_items enable row level security;
alter table public.banners enable row level security;
revoke all on public.wishlist_items, public.banners from anon, authenticated;
grant all on public.wishlist_items, public.banners to service_role;

-- ---------------------------------------------------------------- wishlist
create or replace function public.wishlist_list(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('productIds', coalesce(jsonb_agg(w.product_id order by w.created_at desc), '[]'))
  from public.wishlist_items w join public.products pr on pr.id = w.product_id and pr.status = 'live'
  where w.user_id = (p ->> 'user_id')::uuid;
$$;

create or replace function public.wishlist_set(p jsonb) returns jsonb language plpgsql as $$
declare uid uuid := (p ->> 'user_id')::uuid; pid uuid := (p ->> 'product_id')::uuid;
begin
  if (p ->> 'on')::boolean then
    if not exists (select 1 from public.products where id = pid and status = 'live') then perform public._fail('NOT_FOUND'); end if;
    if (select count(*) from public.wishlist_items where user_id = uid) >= 200 then perform public._fail('WISHLIST_FULL'); end if;
    insert into public.wishlist_items (user_id, product_id) values (uid, pid) on conflict do nothing;
  else
    delete from public.wishlist_items where user_id = uid and product_id = pid;
  end if;
  return public.wishlist_list(jsonb_build_object('user_id', uid));
end $$;

-- ---------------------------------------------------------------- banners
create or replace function public._banner_json(b public.banners) returns jsonb language sql stable as $$
  select jsonb_build_object('id', b.id, 'placement', b.placement, 'title', b.title, 'subtitle', b.subtitle, 'cta_label', b.cta_label,
    'link_url', b.link_url, 'image_url', b.image_url, 'mobile_image_url', b.mobile_image_url, 'theme', b.theme, 'sort', b.sort,
    'is_active', b.is_active, 'starts_at', b.starts_at, 'ends_at', b.ends_at);
$$;

create or replace function public.banners_public(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(public._banner_json(b) order by b.placement, b.sort, b.created_at), '[]')
  from public.banners b
  where b.is_active and (b.starts_at is null or b.starts_at <= now()) and (b.ends_at is null or b.ends_at > now());
$$;

create or replace function public.admin_banners_list(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('banners', coalesce(jsonb_agg(public._banner_json(b) order by b.placement, b.sort, b.created_at), '[]'))
  from public.banners b;
$$;

create or replace function public.admin_banner_save(p jsonb) returns jsonb language plpgsql as $$
declare b public.banners; bid uuid := nullif(p ->> 'id', '')::uuid;
begin
  if bid is null then
    insert into public.banners (placement, title, subtitle, cta_label, link_url, image_url, mobile_image_url, theme, sort, is_active, starts_at, ends_at)
    values (p ->> 'placement', coalesce(p ->> 'title', ''), coalesce(p ->> 'subtitle', ''), coalesce(nullif(p ->> 'cta_label', ''), 'Shop now'),
            coalesce(nullif(p ->> 'link_url', ''), '/shop'), nullif(p ->> 'image_url', ''), nullif(p ->> 'mobile_image_url', ''),
            coalesce(p ->> 'theme', 'dark'), coalesce((p ->> 'sort')::int, 0), coalesce((p ->> 'is_active')::boolean, true),
            nullif(p ->> 'starts_at', '')::timestamptz, nullif(p ->> 'ends_at', '')::timestamptz)
    returning * into b;
  else
    update public.banners set placement = p ->> 'placement', title = coalesce(p ->> 'title', ''), subtitle = coalesce(p ->> 'subtitle', ''),
      cta_label = coalesce(nullif(p ->> 'cta_label', ''), 'Shop now'), link_url = coalesce(nullif(p ->> 'link_url', ''), '/shop'),
      image_url = nullif(p ->> 'image_url', ''), mobile_image_url = nullif(p ->> 'mobile_image_url', ''), theme = coalesce(p ->> 'theme', 'dark'),
      sort = coalesce((p ->> 'sort')::int, 0), is_active = coalesce((p ->> 'is_active')::boolean, true),
      starts_at = nullif(p ->> 'starts_at', '')::timestamptz, ends_at = nullif(p ->> 'ends_at', '')::timestamptz
    where id = bid returning * into b;
    if not found then perform public._fail('NOT_FOUND'); end if;
  end if;
  perform public.audit(jsonb_build_object('actor_id', p ->> 'actor_id', 'action', 'banner_save', 'target', b.id::text, 'details', jsonb_build_object('placement', b.placement, 'title', b.title)));
  return public._banner_json(b);
end $$;

create or replace function public.admin_banner_delete(p jsonb) returns jsonb language plpgsql as $$
begin
  delete from public.banners where id = (p ->> 'id')::uuid;
  if not found then perform public._fail('NOT_FOUND'); end if;
  perform public.audit(jsonb_build_object('actor_id', p ->> 'actor_id', 'action', 'banner_delete', 'target', p ->> 'id'));
  return jsonb_build_object('ok', true);
end $$;

-- only the API server may run these
do $$
declare f text;
begin
  foreach f in array array['wishlist_list', 'wishlist_set', '_banner_json', 'banners_public', 'admin_banners_list', 'admin_banner_save', 'admin_banner_delete'] loop
    execute format('revoke all on function public.%I from public, anon, authenticated', f);
    execute format('grant execute on function public.%I to service_role', f);
  end loop;
end $$;
