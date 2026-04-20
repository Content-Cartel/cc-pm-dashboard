-- Migration 8: Cascade client deletion across the shared Supabase.
-- Production clients couldn't be deleted because MANY tables (not just PM-dashboard
-- tables) FK-reference clients(id) with ON DELETE RESTRICT. This migration rewrites
-- every such FK to CASCADE (wipe) or SET NULL (preserve audit) atomically.
-- Run this once in Supabase SQL Editor.

-- The DO block below looks up each existing FK on <child>.client_id → clients(id)
-- by its actual constraint name (since names differ per project), drops it, and
-- re-adds it with the right delete rule. If a listed table doesn't exist or
-- doesn't have a FK to clients(id), the lookup is a safe no-op.

DO $$
DECLARE
  t TEXT;
  cname TEXT;

  -- Wipe dependent rows when client is deleted. All of these are per-client data
  -- that is meaningless without the client.
  cascade_tables TEXT[] := ARRAY[
    'client_team',
    'client_settings',
    'client_goals',
    'onboarding_checks',
    'weekly_checklist',
    'client_metricool',
    'client_dna',
    'client_knowledge',
    'client_prompts',
    'client_content_examples',
    'client_transcripts',
    'client_analytics',
    'client_analytics_trends',
    'generated_content',
    'editor_assignments',
    'tasks',
    'qc_submissions',
    'qc_checklist_results',
    'qc_notes',
    'spelling_check_results'
  ];

  -- Preserve audit trail rows; the PM dashboard already writes activity_log rows
  -- with client_id = null on delete, so these tables should not cascade.
  setnull_tables TEXT[] := ARRAY[
    'activity_log',
    'agent_log',
    'task_activity_log'
  ];
BEGIN
  FOREACH t IN ARRAY cascade_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      CONTINUE;
    END IF;
    FOR cname IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = t
        AND kcu.column_name = 'client_id'
        AND ccu.table_name = 'clients'
        AND ccu.column_name = 'id'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, cname);
    END LOOP;
    -- Only (re)add the constraint if the column actually exists and is a FK candidate.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=t AND column_name='client_id') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE',
        t, t || '_client_id_fkey'
      );
    END IF;
  END LOOP;

  FOREACH t IN ARRAY setnull_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      CONTINUE;
    END IF;
    FOR cname IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = t
        AND kcu.column_name = 'client_id'
        AND ccu.table_name = 'clients'
        AND ccu.column_name = 'id'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, cname);
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=t AND column_name='client_id') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN client_id DROP NOT NULL',
        t
      );
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL',
        t, t || '_client_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- Sanity check: list every FK pointing at clients(id) with its delete rule.
-- Expect CASCADE for most tables, SET NULL for activity_log / agent_log / task_activity_log.
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
  AND ccu.table_name = 'clients'
  AND ccu.column_name = 'id'
ORDER BY tc.table_name;
