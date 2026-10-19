# تشغيل الإنتاج

## قبل التشغيل

1. انسخ `.env.example` إلى `.env` واضبط MySQL و`JWT_SECRET` و`WEB_ORIGIN` على عنوان HTTPS الحقيقي.
2. اجعل `UPLOAD_ROOT` مجلدًا دائمًا خارج مجلد البناء، أو اربطه بوحدة تخزين تحفظ النسخ الاحتياطية.
3. شغّل `npm ci` ثم `npm run db:migrate` ثم `npm run build`.
4. راجع الإعدادات عبر `npm run check:production`.

## تشغيل الخدمات

يوجد إعداد PM2 جاهز في `deploy/ecosystem.config.cjs`:

```text
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

استخدم `deploy/nginx.conf.example` كنقطة بداية للـreverse proxy، وأضف شهادة TLS من مزودك قبل نشر الموقع للعامة.

## النسخ الاحتياطي

شغّل `npm run db:backup` وفق جدول يومي، وانقل الناتج من `.local/backups` إلى مكان منفصل عن خادم التطبيق. اختبر استعادة نسخة احتياطية دوريًا.

## الإشعارات

فعّل `NOTIFICATIONS_ENABLED=1` بعد ضبط مزود واحد على الأقل. يعمل العامل داخل API حاليًا، ويمكن فصل تشغيله إلى عملية مستقلة عند زيادة حجم الرسائل.
