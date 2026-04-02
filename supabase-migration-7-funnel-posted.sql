-- Migration 7: Add posted counters + funnel status to weekly_checklist
-- Run this in Supabase SQL Editor

-- Posted counters (track how many were actually posted this week)
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS lf_posted INTEGER DEFAULT 0;
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS sf_posted INTEGER DEFAULT 0;
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS wc_posted INTEGER DEFAULT 0;

-- Funnel status toggles
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS funnel_lead_magnet BOOLEAN DEFAULT FALSE;
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS funnel_vsl_routing BOOLEAN DEFAULT FALSE;
ALTER TABLE weekly_checklist ADD COLUMN IF NOT EXISTS funnel_dm_automation BOOLEAN DEFAULT FALSE;
