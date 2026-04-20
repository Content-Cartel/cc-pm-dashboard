-- Migration 9: Catch-all sweep for any FK → clients(id) that migration 8 missed.
-- Migration 8 listed tables by name; this one queries information_schema and
-- rewrites EVERY remaining FK on *.client_id → clients(id) so we can't be
-- bitten by tables we didn't know about (found: slack_message_embeddings, +
-- anything else in Supabase writable from another app).
-- Run this in Supabase SQL Editor.

-- Rule: tables whose name ends with `_log` OR starts with `activity_` get SET NULL
-- (preserve audit trail). Everything else gets CASCADE (wipe derived data).

DO $$
DECLARE
  rec RECORD;
  new_rule TEXT;
BEGIN
  FOR rec IN
    SELECT DISTINCT
      tc.table_name,
      tc.constraint_name,
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
      AND kcu.column_name = 'client_id'
      AND ccu.table_name = 'clients'
      AND ccu.column_name = 'id'
      AND rc.delete_rule NOT IN ('CASCADE','SET NULL')
  LOOP
    IF rec.table_name ~ '(_log|^agent_log$|^activity_log$|^task_activity_log$)' THEN
      new_rule := 'SET NULL';
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN client_id DROP NOT NULL', rec.table_name);
    ELSE
      new_rule := 'CASCADE';
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', rec.table_name, rec.constraint_name);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE %s',
      rec.table_name,
      rec.table_name || '_client_id_fkey',
      new_rule
    );

    RAISE NOTICE 'Rewrote FK on %.client_id → clients(id) as ON DELETE %', rec.table_name, new_rule;
  END LOOP;
END $$;

-- Sanity check: every FK pointing at clients(id) should now be CASCADE or SET NULL.
-- RESTRICT/NO ACTION rows in this output = something still blocking deletion.
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
ORDER BY rc.delete_rule DESC, tc.table_name;
