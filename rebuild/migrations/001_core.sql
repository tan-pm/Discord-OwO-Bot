begin;
create table public.players(guild_id text not null,user_id text not null,balance bigint not null default 0 check(balance>=0),daily_at timestamptz,hunt_at timestamptz,animals integer not null default 0,primary key(guild_id,user_id));
create table public.receipts(id text primary key,result text not null);
alter table public.players enable row level security;
alter table public.receipts enable row level security;
create function public.play(interaction text,guild text,player text,action text) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.players; result text;
begin
 perform pg_advisory_xact_lock(hashtextextended(interaction,0));
 select r.result into result from receipts r where id=interaction;
 if found then return result; end if;
 insert into players(guild_id,user_id) values(guild,player) on conflict do nothing;
 select * into p from players where guild_id=guild and user_id=player for update;
 case action
 when 'balance' then result := 'Số dư: '||p.balance;
 when 'zoo' then result := 'Số thú: '||p.animals;
 when 'daily' then
 if p.daily_at is not null and p.daily_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' then result := 'Bạn đã nhận daily hôm nay.';
 else update players set balance=balance+100,daily_at=now() where guild_id=guild and user_id=player; result := 'Bạn nhận được 100 xu.'; end if;
 when 'hunt' then
 if p.hunt_at > now()-interval '15 seconds' then result := 'Hãy đợi hết cooldown 15 giây.';
 else update players set animals=animals+1,hunt_at=now() where guild_id=guild and user_id=player; result := 'Bạn bắt được 1 thú!'; end if;
 else raise exception 'Unsupported action';
 end case;
 insert into receipts values(interaction,result);
 return result;
end $$;
revoke all on function public.play(text,text,text,text) from public,anon,authenticated;
grant execute on function public.play(text,text,text,text) to service_role;
commit;
