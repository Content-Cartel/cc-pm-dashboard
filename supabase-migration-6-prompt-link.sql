-- Migration 6: Add master prompt tracking to client_settings
-- Links the PM dashboard to the auto-generated master prompts in client_prompts table

ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS prompt_version INTEGER DEFAULT 0;
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS prompt_generated_at TIMESTAMPTZ;
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS youtube_handle TEXT DEFAULT '';
