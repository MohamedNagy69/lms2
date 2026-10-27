-- Creates the course "كورس كمبردج الكود الجديد 7180 (2027)" with its lectures and lessons (no videos) if it is not there yet.
-- Generated from the local database. Upload each lesson video from the teacher dashboard, then publish the course.
-- The master access code is left empty on purpose: this file is public on GitHub.
INSERT IGNORE INTO grades (name,slug,`order`,is_active) VALUES ('كورس كمبردج الكود الجديد 7180 (2026)','كورس كمبردج الكود الجديد 7180 (2026)',2,1);
SET @seed_grade = (SELECT id FROM grades WHERE name='كورس كمبردج الكود الجديد 7180 (2026)' LIMIT 1);
SET @seed_new = (SELECT @seed_grade IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courses WHERE slug='كورس-كمبردج-الكود-الجديد-7180-2026-ad48c3'));
INSERT INTO courses (title,slug,grade_id,summary,description,price,is_free,is_published,enable_watermark,master_access_code,emoji,accent,`order`) SELECT 'كورس كمبردج الكود الجديد 7180 (2027)','كورس-كمبردج-الكود-الجديد-7180-2026-ad48c3',@seed_grade,'','كورس كمبردج الكود الجديد',450,0,0,1,'','📘','brand',1 FROM DUAL WHERE @seed_new;
SET @seed_course = (SELECT id FROM courses WHERE slug='كورس-كمبردج-الكود-الجديد-7180-2026-ad48c3' LIMIT 1);
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الأولى','',1 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'الكتابة السليمة (الهمزات)','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الثانية','',2 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'تابع الكتابة السليمة','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الثالثة','',3 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'الرسالة الغير رسمية','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الرابعة','',4 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'اختبار وحل على الهمزات','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الخامسة','',5 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'الرسالة الرسمية وأنواع الكلمة وسؤال المعاني','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة السادسة','',6 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'كلمات جديدة وحل نحو وقراءة رسائل','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة السابعة','',7 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'أسئلة الفهم والجملة الاسمية والنواسخ','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة الثامنة','',8 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'حل على النواسخ وأسئلة الفهم وامتحان على الرسالة','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
INSERT INTO lectures (course_id,title,description,`order`) SELECT @seed_course,'المحاضرة التاسعة','',9 FROM DUAL WHERE @seed_new;
SET @seed_lecture = LAST_INSERT_ID();
INSERT INTO lessons (lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) SELECT @seed_lecture,'الخطبة والأسلوب الخبري والإنشائي','','file',NULL,'','',0,1,0,1 FROM DUAL WHERE @seed_new;
