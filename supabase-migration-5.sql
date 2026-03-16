-- Migration 5: Add dna_doc_url to client_settings
-- Run this in Supabase SQL Editor
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS dna_doc_url TEXT DEFAULT '';
