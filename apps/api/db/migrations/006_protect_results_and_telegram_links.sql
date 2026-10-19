ALTER TABLE exam_attempts
  DROP FOREIGN KEY fk_attempts_exam,
  ADD CONSTRAINT fk_attempts_exam_preserve FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  recipient_role ENUM('father','mother','student') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  INDEX idx_telegram_link_student (student_id, expires_at),
  CONSTRAINT fk_telegram_link_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
