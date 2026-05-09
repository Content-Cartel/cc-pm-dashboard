-- Backfill: Kayla's 5 known live failures, per the spec from 2026-05-08.
-- Run AFTER supabase-migration-13-failure-log.sql.
--
-- Each insert references the client by name via subquery so the script is
-- safe to re-run without hard-coded IDs. The Production->editor entry has
-- no client (process-level fix) and is already Resolved.
--
-- If a client name in your `clients` table differs from below, tweak the
-- WHERE clauses before running.

INSERT INTO public.failure_log (station, client_id, what_broke, owner, status, source)
SELECT 'Reporting',
       (SELECT id FROM public.clients WHERE name ILIKE 'Tom%' ORDER BY id LIMIT 1),
       'Tom: attribution gap — leads not tying back to source content',
       'Vedant', 'Open', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.failure_log
  WHERE what_broke = 'Tom: attribution gap — leads not tying back to source content'
);

INSERT INTO public.failure_log (station, client_id, what_broke, owner, status, source)
SELECT 'Distribution',
       (SELECT id FROM public.clients WHERE name ILIKE 'Mark Moss' OR name ILIKE 'Marc Moss' ORDER BY id LIMIT 1),
       'Mark Moss: Metricool connection delay — analytics not flowing',
       'Vedant', 'Open', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.failure_log
  WHERE what_broke = 'Mark Moss: Metricool connection delay — analytics not flowing'
);

INSERT INTO public.failure_log (station, client_id, what_broke, owner, status, source)
SELECT 'Onboarding',
       (SELECT id FROM public.clients WHERE name ILIKE 'Sachin%' ORDER BY id LIMIT 1),
       'Sachin: recording non-compliance pattern — 4 hrs / 2 months vs 4 hrs / week contracted',
       'Kayla', 'Open', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.failure_log
  WHERE what_broke = 'Sachin: recording non-compliance pattern — 4 hrs / 2 months vs 4 hrs / week contracted'
);

INSERT INTO public.failure_log (station, client_id, what_broke, owner, status, source)
SELECT 'Onboarding',
       (SELECT id FROM public.clients WHERE name ILIKE 'Eric Siu%' OR name ILIKE 'Marketing School%' ORDER BY id LIMIT 1),
       'Eric Siu: Day-1 absorption gap — Megaphone + HubSpot context missed in onboarding',
       'Kayla', 'Open', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.failure_log
  WHERE what_broke = 'Eric Siu: Day-1 absorption gap — Megaphone + HubSpot context missed in onboarding'
);

INSERT INTO public.failure_log (station, client_id, what_broke, owner, status, resolution_notes, source)
SELECT 'Production',
       NULL,
       'Production manager → editor: broken telephone on revision intent',
       'Saad', 'Resolved',
       'Fixed by establishing direct line between PM and editor (no intermediary).',
       'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.failure_log
  WHERE what_broke = 'Production manager → editor: broken telephone on revision intent'
);

-- Sanity check: should return 5 rows after first run, 5 after subsequent runs (idempotent).
SELECT id, station, client_id, status, owner, LEFT(what_broke, 60) AS what_broke
FROM public.failure_log
WHERE source = 'manual'
ORDER BY id;
