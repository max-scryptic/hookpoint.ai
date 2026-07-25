-- Script taxonomy: the categorical, comparison-grade read of a video's spoken
-- content (lib/script-taxonomy.ts), the countable companion to the packaging
-- taxonomy but for the whole transcript rather than the title/thumbnail/hook.
-- Like the other surface-level reads it is derived purely from the caption
-- transcript (no source-file upload required), so it is stored directly on the
-- analysed_videos row with the same claim-column guard the packaging alignment
-- and retention attribution use.

alter table public.analysed_videos
  -- The full ScriptTaxonomy JSON. null = not generated yet; a row whose
  -- schemaVersion is below the current one is regenerated on its next visit.
  add column if not exists script_taxonomy jsonb,
  add column if not exists script_taxonomy_status text
    check (script_taxonomy_status in ('processing', 'failed')),
  add column if not exists script_taxonomy_claimed_at timestamptz;

-- The script taxonomy is one more light-analysis LLM call, so it needs to be a
-- permitted call_type in the cost log. Recreate the check constraint with it
-- added (the original was created inline, giving it the default name
-- cost_logs_call_type_check).
alter table public.cost_logs
  drop constraint if exists cost_logs_call_type_check;

alter table public.cost_logs
  add constraint cost_logs_call_type_check check (
    call_type in (
      'pacing',
      'packaging_alignment',
      'packaging_taxonomy',
      'script_taxonomy',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis'
    )
  );
