-- Audio clips harvested for retention-window analysis are now extracted as
-- MP3 rather than AAC (lib/media/video-extraction.ts): OpenAI's input_audio
-- only accepts wav/mp3, so every "Analyzing audio" call was failing with a
-- 400 against the previously-stored .aac clips. Widen the bucket's allowed
-- MIME types to admit the new audio/mpeg output alongside the old ones.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'audio/aac', 'audio/mp4', 'audio/mpeg']
where id = 'retention-window-media';
