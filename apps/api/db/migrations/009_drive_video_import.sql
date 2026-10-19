-- Drive lessons are converted to encrypted uploads in the background. These columns track that conversion.
ALTER TABLE lessons
  ADD COLUMN video_import_status VARCHAR(20) NOT NULL DEFAULT '',
  ADD COLUMN video_import_error VARCHAR(255) NOT NULL DEFAULT '';
