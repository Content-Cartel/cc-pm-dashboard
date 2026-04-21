-- Migration 11: Per-client content calendar + per-client freeform tasks.
-- Both tables cascade-delete with their parent client. RLS policy mirrors the
-- rest of the app: anon role gets full CRUD (auth is the dashboard password
-- gate, not Supabase auth). Run once in Supabase SQL Editor.

-- ── client_calendar_entries ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_calendar_entries (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type          TEXT   NOT NULL CHECK (type IN ('lf','sf','written')),
  title         TEXT   NOT NULL,
  publish_date  DATE,
  status        TEXT   NOT NULL DEFAULT 'idea'
                CHECK (status IN ('idea','scripting','editing','ready','published')),
  assignee_id   BIGINT REFERENCES public.team_members(id) ON DELETE SET NULL,
  drive_url     TEXT,
  notes         TEXT,
  is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_client_date    ON public.client_calendar_entries (client_id, publish_date);
CREATE INDEX IF NOT EXISTS idx_cal_client_status  ON public.client_calendar_entries (client_id, status);

ALTER TABLE public.client_calendar_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cal_anon_all ON public.client_calendar_entries;
CREATE POLICY cal_anon_all ON public.client_calendar_entries
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ── client_tasks ───────────────────────────────────────────────────
-- Note: a separate `tasks` table already exists in this Supabase project
-- (used by another app — see migration 8 cascade list). Naming this
-- `client_tasks` avoids collision and reads naturally.
CREATE TABLE IF NOT EXISTS public.client_tasks (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title         TEXT   NOT NULL,
  description   TEXT,
  assignee_id   BIGINT REFERENCES public.team_members(id) ON DELETE SET NULL,
  due_date      DATE,
  status        TEXT   NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo','in-progress','done')),
  is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_tasks_client_status ON public.client_tasks (client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_tasks_assignee      ON public.client_tasks (assignee_id) WHERE assignee_id IS NOT NULL;

ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_anon_all ON public.client_tasks;
CREATE POLICY tasks_anon_all ON public.client_tasks
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ── updated_at auto-tick ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cal_touch   ON public.client_calendar_entries;
CREATE TRIGGER trg_cal_touch
  BEFORE UPDATE ON public.client_calendar_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_touch ON public.client_tasks;
CREATE TRIGGER trg_tasks_touch
  BEFORE UPDATE ON public.client_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Sanity check ───────────────────────────────────────────────────
-- Confirms both tables exist with the expected delete rule on client_id.
SELECT
  tc.table_name,
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('client_calendar_entries','client_tasks')
  AND ccu.column_name = 'id'
ORDER BY tc.table_name, tc.constraint_name;
