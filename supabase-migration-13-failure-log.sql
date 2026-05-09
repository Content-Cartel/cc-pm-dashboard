-- Migration 13: System-wide failure log. Single source of truth for every
-- operational failure across the agency (5 stations + automated services).
-- Owned by Kayla (CSM); Moi reviews Friday + monthly.
-- Writes from: PM Dashboard UI (manual), cc-client-agent, cc-qc-tool,
-- attribution-tracker, n8n. Reads in PM Dashboard "Failure Log" + "System Health".

CREATE TABLE IF NOT EXISTS public.failure_log (
  id                       BIGSERIAL PRIMARY KEY,
  date_logged              TIMESTAMPTZ NOT NULL DEFAULT now(),
  station                  TEXT NOT NULL CHECK (station IN
                             ('Onboarding','Strategy','Production','Distribution','Reporting')),
  client_id                BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  what_broke               TEXT NOT NULL,
  owner                    TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Open'
                             CHECK (status IN ('Open','In-progress','Resolved','Blocked')),
  resolution_notes         TEXT,
  client_confirmation_sent BOOLEAN NOT NULL DEFAULT FALSE,
  source                   TEXT NOT NULL DEFAULT 'manual',
                           -- 'manual' | 'cc-client-agent' | 'n8n' | 'qc-tool' | 'attribution-tracker'
  resolved_at              TIMESTAMPTZ,
  escalated_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failure_log_status_date    ON public.failure_log (status, date_logged DESC);
CREATE INDEX IF NOT EXISTS idx_failure_log_client         ON public.failure_log (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_failure_log_station_date   ON public.failure_log (station, date_logged DESC);
CREATE INDEX IF NOT EXISTS idx_failure_log_source_date    ON public.failure_log (source, date_logged DESC);

ALTER TABLE public.failure_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS failure_log_anon_all ON public.failure_log;
CREATE POLICY failure_log_anon_all ON public.failure_log
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- Reuse the touch_updated_at function from migration 11
DROP TRIGGER IF EXISTS trg_failure_log_touch ON public.failure_log;
CREATE TRIGGER trg_failure_log_touch
  BEFORE UPDATE ON public.failure_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-stamp resolved_at when status flips to Resolved
CREATE OR REPLACE FUNCTION public.failure_log_resolve_stamp()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'Resolved' AND OLD.status IS DISTINCT FROM 'Resolved' THEN
    NEW.resolved_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_failure_log_resolve ON public.failure_log;
CREATE TRIGGER trg_failure_log_resolve
  BEFORE UPDATE ON public.failure_log
  FOR EACH ROW EXECUTE FUNCTION public.failure_log_resolve_stamp();

-- ── Sanity check ───────────────────────────────────────────────────
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
  AND tc.table_name = 'failure_log';
