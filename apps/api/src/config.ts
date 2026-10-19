import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

function findProjectRoot() {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (pkg.name === 'mudarris-platform-next') return current;
      } catch {}
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

export const projectRoot = findProjectRoot();
dotenv.config({ path: path.join(projectRoot, '.env') });
export const config = {
  port: Number(process.env.API_PORT || 4000),
  production: process.env.NODE_ENV === 'production',
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  secret: process.env.JWT_SECRET || '',
  uploads: path.resolve(projectRoot, process.env.UPLOAD_ROOT || 'apps/api/uploads'),
  db: {
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'mudarris', charset: 'utf8mb4', timezone: '+00:00',
    connectionLimit: 10, decimalNumbers: true, supportBigNumbers: true,
  },
  site: {
    site_name: process.env.SITE_NAME || 'منصة الغيطي',
    teacher_name: process.env.TEACHER_NAME || 'د. ناجي الغيطي',
    subject: process.env.TEACHER_SUBJECT || 'اللغة العربية IGCSE',
    tagline: process.env.TEACHER_TAGLINE || 'هدفنا إنك تتفوق في العربي',
    phone: process.env.TEACHER_PHONE || '', whatsapp: process.env.TEACHER_WHATSAPP || '',
    telegram_bot_username: process.env.TELEGRAM_BOT_USERNAME || 'ElGheityExamBot',
  },
};
