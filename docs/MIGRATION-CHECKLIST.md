# Verification checklist

## Completed

- [x] Audited settings, models, forms, views, URLs, middleware, services, templates, static assets, migrations, seed command, admin, and media.
- [x] Created MySQL schema with foreign keys, uniqueness constraints, indexes, and delete behavior.
- [x] Imported the selected SQLite data into MySQL without changing the source.
- [x] Compared 19 tables, 387 rows, 3,307 fields, and 23 media files; zero mismatches.
- [x] Migrated public pages, account pages, student pages, teacher dashboard, content CRUD, enrollments, codes, reports, inbox, security, and notifications UI.
- [x] Matched lesson auto-completion, student pending enrollments/exam dashboard, recent results with answer review, exam question counts, course counters, detailed Saturday–Friday reports, and WhatsApp report links.
- [x] Report pages render stored exam answers, correct answers, and teacher feedback in addition to the summary.
- [x] Migrated login/logout/profile/password flow, role checks, device sessions, rate limiting, CSRF-origin checks, validation, uploads, protected files, signed video URLs, and error handling.
- [x] Added API integration checks for password migration, role escalation, CSRF origin, code races, active attempts, answer privacy, essay grading, manual grading, report links, device limits, and session revocation.
- [x] API TypeScript build and web typecheck pass.
- [x] Full production build passes for API and Next.js when the synced workspace is available to SWC.
- [x] Integration suite passes all 22 checks against local MySQL.
- [x] Result notifications include detailed text, HTML email content, evaluation, pass threshold, infractions, and result link.
- [x] Added production environment validation and a repeatable MySQL backup command.
- [x] Browser smoke check passes for home, catalogue, course detail, and contact pages against the imported database.
- [x] Mobile viewport smoke check passes; collapsed navigation opens and exposes the expected links.
- [x] Public camera pre-check is available before login, and resource validation prevents incomplete media records or orphaned direct uploads on deletion.
- [x] Activation-code filters and filtered Excel export are available in the teacher dashboard.
- [x] Teacher dashboard latest students/results and weekly-report filters/navigation match the legacy views.
- [x] Student profile includes Telegram linking actions and the authorized-device list; teacher student profiles and weekly reports include WhatsApp contacts.
- [x] Telegram linking uses the configured `TELEGRAM_BOT_USERNAME` value and falls back to the legacy bot name for local compatibility.
- [x] Lesson management exposes linked quizzes, question management, and prefilled quiz creation from the lesson.
- [x] Authenticated browser smoke check passes for teacher dashboard, reports, codes, course editor, student report, parent report, and public camera page; camera permission itself remains user-controlled.
- [x] Added PM2 and reverse-proxy deployment templates plus production deployment instructions.

## Remaining before production sign-off

- [x] Telegram `/start` account-link polling behavior with a durable update cursor.
- [ ] Decide and configure production storage for large video uploads. Local `apps/api/uploads` is suitable for development and a single host only.
- [ ] Configure and verify SMTP, UltraMsg, and Telegram credentials in a staging environment; no external notification is sent by default.
- [ ] Complete the authenticated browser workflow check for camera permission, fullscreen, Drive embed, local range streaming, mobile navigation, teacher CRUD, and parent report opening against the imported database.
- [ ] Validate camera occlusion thresholds against the legacy browser script in a real browser session; the new detector is implemented with frame brightness/variance checks and needs calibration.
- [ ] Schedule `npm run db:backup` and store backups outside the application host; install the provided PM2/Nginx templates with real TLS certificates and a separate notification worker when message volume requires it.

## Local verification note

The API TypeScript build, web typecheck, production build, integration suite, and local MySQL backup have been verified from the current OneDrive checkout. If OneDrive temporarily denies SWC access in a later run, make the folder available offline or use a local non-synced checkout.

The remaining items are explicit integration/deployment work. They are not hidden inside the source migration and should be completed before a production launch is called final.
