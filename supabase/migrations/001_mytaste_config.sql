-- Fonti di MyTaste: una sola riga con tutto il JSON delle sezioni e dei canali.
create table if not exists public.mytaste_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null,
  updated_at timestamptz not null default now()
);
-- Copia di ogni versione precedente, per poter tornare indietro.
create table if not exists public.mytaste_config_history (
  id bigint generated always as identity primary key,
  config jsonb not null,
  note text,
  saved_at timestamptz not null default now()
);
alter table public.mytaste_config enable row level security;
alter table public.mytaste_config_history enable row level security;
-- Lettura pubblica delle fonti (servono all'app e all'aggiornamento orario); nessuna scrittura diretta:
-- si scrive solo tramite la funzione "mytaste" che usa la chiave di servizio.
drop policy if exists "lettura pubblica fonti" on public.mytaste_config;
create policy "lettura pubblica fonti" on public.mytaste_config for select to anon, authenticated using (true);
