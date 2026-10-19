# منصة الأستاذ — audit of the Django source

Audit source: `../mudarris-platform-github`. The repository contains a complete Django project (`mudarris`) with one domain app (`academy`), a second SQLite working copy under `../mudarris-platform/pro`, and a separate static landing page at the repository root. The working data source selected for migration was `../mudarris-platform/pro/db.sqlite3`; its checksum matched the GitHub copy's `academy/models.py` and it contained the latest 387 domain rows.

## 1. System overview

The product is an Arabic RTL education platform for one teacher. Public visitors browse published courses, submit contact messages, and read announcements/testimonials. Students register, enroll in free or paid courses, watch lessons, download attachments, complete exams, view results, and share weekly reports with parents. A teacher operates the content, enrollment, exam, student, security, report, code, announcement, grade, inbox, and notification workflows.

The source uses server-rendered Django templates and Tailwind CSS. The database adapter can select MongoDB or fall back to SQLite at startup. The migration replaces that runtime choice with MySQL and keeps the Django project untouched as a reference.

## 2. Repository and module inventory

| Source area | Observed responsibility | Migration location |
|---|---|---|
| `mudarris/settings.py` | dotenv loading, MongoDB/SQLite selection, site settings, SMTP, WhatsApp, Telegram, media/static | `apps/api/src/config.ts`, `.env.example` |
| `mudarris/urls.py` | admin, protected video denial, academy include | Express server, protected media routes |
| `academy/models.py` | 19 domain models and computed properties | `apps/api/db/migrations/001_initial.sql` |
| `academy/views/public.py` | home, catalogue, contact, parent report | `routes/public.ts` |
| `academy/views/accounts.py` | login, register, logout, profile, password change/reset | `routes/auth.ts` |
| `academy/views/student.py` | dashboard, lessons, video stream, enrollments, exam lifecycle, results, reports, security | `routes/student.ts`, `routes/media.ts` |
| `academy/views/teacher.py` | dashboard and teacher CRUD/workflows | `routes/teacher.ts`, generic resource editor |
| `academy/forms.py` | server-side form validation and role forcing | Zod schemas and resource validation |
| `academy/middleware.py` | ban expiry and maximum two active student devices | `lib/auth.ts` |
| `academy/context_processors.py` | site data in templates | `/api/home`, web shell |
| `academy/templatetags/academy_extras.py` | template display helpers | React formatters/components |
| `academy/services/grading.py` | Arabic normalization and essay matching | `services/grading.ts` |
| `academy/services/reports.py` | weekly boundaries, progress, results, WhatsApp report data | `services/reports.ts` |
| `academy/services/excel.py` | generated activation-code workbook | `services/excel.ts` |
| `academy/services/notifications.py` | email/WhatsApp/Telegram result dispatch | notification queue and worker |
| `academy/services/telegram.py` | Bot API, linking `/start` payloads, background polling | `services/telegram.ts` with durable cursor |
| `academy/management/commands/seed_demo.py` | demo grades, users, courses, exams, content | `scripts/create-teacher.ts`; existing data imported |
| `academy/admin.py` | Django admin registrations and fieldsets | custom teacher dashboard resources |
| `templates/` | 46 server-rendered pages/partials/email templates | Next App Router components |
| `static/src/input.css`, `static/js/`, `static/img/`, `static/fonts/` | design tokens, interactions, imagery, Cairo font | `apps/web/src/app/globals.css`, components, `public/` |

No Celery configuration, Django signals, custom managers, payment provider, WebSocket server, or cache backend was found in the source. The only background work found is daemon-thread email, WhatsApp, Telegram dispatch and Telegram polling.

## 3. Database model map

The source models are `User`, `Grade`, `Course`, `Lecture`, `Lesson`, `Attachment`, `Enrollment`, `AccessCode`, `LessonProgress`, `Exam`, `Question`, `Choice`, `ExamAttempt`, `AttemptAnswer`, `Announcement`, `Testimonial`, `ContactMessage`, `StudentDevice`, and `ParentReportView`.

Relationships preserved in MySQL:

- Grade → users, courses, announcements.
- Course → lectures, exams, enrollments, access codes, parent reports.
- Lecture → lessons; Lesson → attachments, progress, exams.
- Exam → questions and attempts; Question → choices and attempt answers.
- User → enrollments, attempts, progress, devices, access reports, used codes.
- Composite uniqueness is preserved for student/course enrollment, student/lesson progress, attempt/question answers, and student/device.
- Delete behavior follows the Django source: course/content trees cascade, optional references set null, and student-linked activity cascades.

`001_initial.sql` includes indexes for role/grade, phones, published catalogue queries, ordered content, attempts, unread inbox messages, and foreign-key joins. Runtime-only security, notification, Telegram-linking, and rich notification fields are in `002_runtime.sql` through `005_notification_rich.sql`.

## 4. Authentication, authorization, and security

The source custom user has `student` and `teacher` roles, with superusers treated as teachers. Login accepts username or phone. The target uses bcrypt for new passwords, upgrades imported Django PBKDF2 hashes at first login, and stores an HTTP-only signed cookie bound to a `student_devices` row. Students are limited to two active devices; teacher sessions are not subject to that limit. Teacher routes require the teacher role. All mutation requests require same-origin checks and a custom non-browser header for API clients.

Course access checks preserve free/preview access, active enrollment, pending enrollment, and teacher bypass. Exam attempts are locked to their student; live responses hide correct answers and explanations. Uploads are restricted by destination, extension, size, and path. Video links are short-lived, signed, and bound to the session/device. Helmet, CORS, rate limiting, Zod validation, parameterized SQL, request limits, and centralized error handling are enabled.

The original browser anti-screen-capture behavior is retained as an enforcement signal and account lock workflow. Browser JavaScript cannot prevent a determined screen recorder, so the server-side strike, lock, ban, and teacher-unban behavior is the meaningful control.

## 5. Feature and route inventory

The original route list is preserved in `docs/ROUTE-MAP.md`. The target web application implements the public home/catalogue/contact/report pages, student dashboard/course/lesson/exam/result/report/account pages, and teacher dashboard/resource/student/code/report/inbox/security/notification pages. API methods are listed beside each source route. The generic resource API covers the teacher CRUD forms while keeping relational validation and exam immutability checks in the service layer.

## 6. Migration evidence

The source snapshot was opened read-only. `scripts/verify-import.mjs` compared 19 tables, 387 rows, 3,307 fields, and 23 media files against MySQL and reported zero mismatches in `.local/import-verification.json`. The existing source database and media were never deleted or overwritten.

## 7. Risks and decisions

The legacy project embeds a Telegram bot token as a fallback setting. The target never carries that fallback secret; production credentials must be set in `.env`. Notification delivery is disabled by default and uses an explicit queue when enabled. The old Django admin URL is replaced by the teacher dashboard because the actual domain workflow is the custom academy admin, not the stock admin site. Deployments should use object storage for large video files instead of local disk and should run the API worker as a separate process when notification volume grows.
