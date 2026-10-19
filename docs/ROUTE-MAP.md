# Source URL → target route map

| Django URL | Source view | Target API / web route | Auth |
|---|---|---|---|
| `/` | `public.home` | `GET /api/home`, `/` | public |
| `/courses/` | `public.course_catalog` | `GET /api/courses`, `/courses` | public |
| `/contact/` | `public.contact` | `POST /api/contact`, `/contact` | public |
| `/report/parent/<token>/` | `public.parent_report_view` | `GET /api/report/parent/:token`, `/report/parent/:token` | token |
| `/login/` | `accounts.AcademyLoginView` | `POST /api/auth/login`, `/login` | public |
| `/logout/` | `accounts.logout_view` | `POST /api/auth/logout` | session |
| `/register/` | `accounts.register` | `POST /api/auth/register`, `/register` | public |
| `/profile/` | `accounts.profile` | `PATCH /api/auth/profile`, `/profile` | signed in |
| `/profile/password/` | password change view | `POST /api/auth/password`, `/profile/password` | signed in |
| `/password-reset/` | `student_password_reset` | `POST /api/auth/password-reset`, `/password-reset` | public |
| `/dashboard/` | `student.dashboard` | `GET /api/dashboard`, `/dashboard` | student |
| `/course/<slug>/` | `student.course_detail` | `GET /api/courses/:slug`, `/course/:slug` | public/student |
| `/course/<slug>/enroll/` | `student.enroll` | `POST /api/courses/:slug/enroll` | student |
| `/course/<slug>/lesson/<id>/` | `student.lesson_detail` | `GET /api/lessons/:id`, `/course/:slug/lesson/:id` | preview/enrolled |
| `/lesson/<id>/stream/` | `student.video_stream` | `GET /api/lessons/:id/stream` | signed session |
| `/lesson/<id>/done/` | `student.toggle_lesson_done` | `POST /api/lessons/:id/progress` | student |
| `/exams/` | `student.exam_list` | `GET /api/exams`, `/exams` | student |
| `/exam/<id>/start/` | `student.exam_start` | `POST /api/exams/:id/start`, `/exam/:id/start` | student |
| `/attempt/<id>/` | `student.exam_take` | `GET /api/attempts/:id`, `/attempt/:id` | owner/teacher |
| `/attempt/<id>/submit/` | `student.exam_submit` | `POST /api/attempts/:id/submit` | owner |
| `/attempt/<id>/result/` | `student.attempt_result` | same attempt endpoint, `/attempt/:id/result` | owner/teacher |
| `/attempt/<id>/resend-email/` | `resend_attempt_email` | `POST /api/attempts/:id/resend` | owner/teacher |
| `/results/` | `student.my_results` | `GET /api/results`, `/results` | student |
| `/my-report/` | `student.my_weekly_report` | `GET /api/my-report`, `/my-report` | student |
| `/camera-check/` | `student.camera_check` | client camera component, `/camera-check` | public (also available in the signed-in student menu) |
| `/api/security/record-violation/` | `record_screenshot_violation` | `POST /api/security/record-violation` | student |
| `/teacher/` | `teacher.dashboard` | `GET /api/teacher/dashboard`, `/teacher` | teacher |
| `/teacher/courses/`, `/teacher/lectures/`, `/teacher/lessons/`, `/teacher/attachments/` | content views | `/api/teacher/resources/:resource`, `/teacher/:resource` | teacher |
| `/teacher/exams/`, `/teacher/questions/` | exam views | resource API and nested management pages | teacher |
| `/teacher/students/` | `teacher.student_list` | `/api/teacher/students`, `/teacher/students` | teacher |
| `/teacher/students/<id>/` | `teacher.student_detail` | `/api/teacher/students/:id`, `/teacher/students/:id` | teacher |
| `/teacher/students/<id>/report/` | report view | `/api/teacher/students/:id/report`, `/teacher/students/:id/report` | teacher |
| `/teacher/reports/` | overview | `GET /api/teacher/reports`, `/teacher/reports` | teacher |
| `/teacher/codes/` | code management | `/api/teacher/codes`, `/teacher/codes` | teacher |
| `/teacher/codes/export/` | Excel export | `/api/teacher/codes/export?format=xlsx` | teacher |
| `/teacher/announcements/`, `/teacher/grades/` | CRUD views | resource API and `/teacher/:resource` | teacher |
| `/teacher/inbox/` | inbox | `/api/teacher/inbox`, `/teacher/inbox` | teacher |
| `/teacher/security/` | security logs | `/api/teacher/security`, `/teacher/security` | teacher |

Legacy redirects are represented as API/page equivalents rather than Django form POST URLs. The old `/admin/` stock Django admin is intentionally replaced by the teacher resource dashboard and is not exposed against the new database.
