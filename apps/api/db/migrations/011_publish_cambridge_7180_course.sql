-- Publishes the course seeded by 010 so it shows on the home page. Runs once: unpublishing it later from the
-- teacher dashboard is kept.
UPDATE courses SET is_published=1 WHERE slug='كورس-كمبردج-الكود-الجديد-7180-2026-ad48c3';
