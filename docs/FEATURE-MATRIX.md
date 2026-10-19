# Feature migration matrix

| Capability | Source behavior | Next/Express/MySQL status |
|---|---|---|
| RTL dark public site | Django base/home/catalogue, Tailwind, Cairo fonts | migrated in `apps/web` |
| Username/phone login | custom auth backend | migrated, bcrypt + Django PBKDF2 upgrade |
| Registration/profile/password | Django forms | migrated with Zod and HTTP-only cookie |
| Password reset | parent-phone verified form and teacher workflow | parent-phone verification resets immediately; teacher reset endpoint and historical queue remain available |
| Roles | student/teacher/superuser | migrated; registration cannot submit a role |
| Course/lecture/lesson/attachment CRUD | teacher views/forms | generic resource editor and SQL constraints |
| Free/preview/paid enrollment | master and single-use codes, pending approvals | migrated transactionally |
| Lesson player | YouTube, Drive, local protected video, watermark, next/previous | migrated; local file streaming is signed/range-capable |
| Protected video controls | signed session links, one-hour expiry, referer checks, blocked downloader agents, no-store/range headers | migrated |
| Exams | timer, attempts, shuffle, MCQ, essay auto-grade, review | migrated; saved answers survive timeout |
| Exam monitoring | fullscreen/tab/camera/multiple-person/screens/strikes | migrated as browser signals + server enforcement; screen count is checked at start and during the attempt |
| Camera pre-check | public Django camera-check page before an exam | migrated as public `/camera-check` page and signed-in student menu item |
| Results | student/teacher views, manual essay grading | migrated |
| Weekly reports | Saturday–Friday course progress, watched lesson details, exam answers, parent token/views, WhatsApp share links | migrated with detailed course/week data |
| Teacher codes | generation, filters, CSV/Excel export | migrated |
| Announcements/testimonials/contact inbox | public and teacher CRUD | migrated |
| Student device policy | max two active devices | migrated |
| Email result notifications | background Django thread with rich result template | queue/worker with detailed text + HTML email; disabled until SMTP configured |
| WhatsApp result notifications | UltraMsg/custom API + manual `wa.me` links | queue/manual links with detailed result, pass status, infractions, and result URL; credentials required |
| Telegram notifications/linking/poller | Bot `/start` payloads and background polling | migrated; opt-in background polling persists its update cursor |
| Django stock admin | `/admin/` registrations | replaced by custom teacher dashboard |
| Demo seed command | `seed_demo` | existing source data imported; new teacher CLI exists |
| MongoDB fallback | runtime Mongo/SQLite choice | deliberately removed; MySQL is the target database |
