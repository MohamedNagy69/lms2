CREATE TABLE IF NOT EXISTS notification_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 attempt_id BIGINT UNSIGNED NOT NULL,
 channel ENUM('email','telegram','whatsapp') NOT NULL,
 recipient VARCHAR(254) NOT NULL,
 body TEXT NOT NULL,
 status ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
 tries INT NOT NULL DEFAULT 0,
 last_error VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 sent_at DATETIME(3) NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_notification_target (attempt_id,channel,recipient),
 FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
