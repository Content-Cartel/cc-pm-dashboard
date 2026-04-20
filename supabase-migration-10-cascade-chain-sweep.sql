-- Migration 10: Fix inner FKs inside cascade-target tables.
-- Migration 9 ensured clients(id) → children cascade, but CASCADE deletes of
-- child rows then fail when those children have RESTRICT FKs pointing at each
-- other (e.g. qc_submissions.revision_of → qc_submissions.id).
-- This sweeps every FK that points INTO a table we cascade from clients, and
-- rewrites any remaining RESTRICT/NO ACTION rule to SET NULL (for self-refs
-- and audit-style links) or CASCADE (for hard parent-child ownership).
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  rec RECORD;
  new_rule TEXT;

  -- Tables that cascade-delete when their client is deleted. Any FK pointing at
  -- these from another table must also cascade or set null, or the cascade
  -- will get stuck. Kept in sync with migrations 8 & 9.
  cascaded_tables TEXT[] := ARRAY[
    'client_team','client_settings','client_goals','onboarding_checks',
    'weekly_checklist','client_metricool','client_dna','client_knowledge',
    'client_prompts','client_content_examples','client_transcripts',
    'client_analytics','client_analytics_trends','generated_content',
    'editor_assignments','tasks','qc_submissions','qc_checklist_results',
    'qc_notes','spelling_check_results','slack_message_embeddings'
  ];
BEGIN
  FOR rec IN
    SELECT DISTINCT
      tc.table_name AS child_table,        -- table with the FK
      tc.constraint_name,
      kcu.column_name AS child_column,     -- column in the child
      ccu.table_name AS parent_table,      -- table being referenced
      ccu.column_name AS parent_column,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = ANY(cascaded_tables)
      AND rc.delete_rule NOT IN ('CASCADE','SET NULL')
      -- Don't touch the client_id FKs themselves; those are handled in migrations 8 & 9.
      AND kcu.column_name <> 'client_id'
  LOOP
    -- Self-referencing FKs (e.g. qc_submissions.revision_of → qc_submissions.id)
    -- get SET NULL so revision chains break cleanly instead of blocking.
    -- Other inter-table FKs get CASCADE so the whole subtree comes down with
    -- the client's data.
    IF rec.child_table = rec.parent_table THEN
      new_rule := 'SET NULL';
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', rec.child_table, rec.child_column);
    ELSE
      new_rule := 'CASCADE';
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', rec.child_table, rec.constraint_name);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s',
      rec.child_table, rec.constraint_name, rec.child_column, rec.parent_table, rec.parent_column, new_rule
    );

    RAISE NOTICE 'Rewrote %.%.% → %.% as ON DELETE %',
      rec.child_table, rec.constraint_name, rec.child_column, rec.parent_table, rec.parent_column, new_rule;
  END LOOP;
END $$;

-- Sanity check: list every remaining RESTRICT/NO ACTION FK that touches one of
-- the cascaded tables (as parent OR child). Expect the list to be empty — if
-- any row appears, client deletion can still stall on that constraint.
WITH cascaded AS (
  SELECT unnest(ARRAY[
    'client_team','client_settings','client_goals','onboarding_checks',
    'weekly_checklist','client_metricool','client_dna','client_knowledge',
    'client_prompts','client_content_examples','client_transcripts',
    'client_analytics','client_analytics_trends','generated_content',
    'editor_assignments','tasks','qc_submissions','qc_checklist_results',
    'qc_notes','spelling_check_results','slack_message_embeddings'
  ]) AS t
)
SELECT
  tc.table_name AS child_table,
  tc.constraint_name,
  ccu.table_name AS parent_table,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
 AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND rc.delete_rule NOT IN ('CASCADE','SET NULL')
  AND (tc.table_name IN (SELECT t FROM cascaded) OR ccu.table_name IN (SELECT t FROM cascaded))
ORDER BY tc.table_name, tc.constraint_name;
