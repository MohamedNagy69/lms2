ALTER TABLE telegram_link_tokens ADD INDEX idx_telegram_link_expiry (expires_at);
