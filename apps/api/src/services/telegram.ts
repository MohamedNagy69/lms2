import { db, transaction } from '../db/index.js';
import { createHash } from 'node:crypto';

type TelegramUpdate = { update_id?: number; message?: { text?: string; chat?: { id?: string|number } } };
const token = () => String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] || ch));

async function send(chatId: string, text: string) {
  const bot = token(); if (!bot) return;
  await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML'}), signal:AbortSignal.timeout(15000) });
}

async function handleStart(chatId: string, text: string) {
  const payload = text.trim().split(/\s+/)[1] || '';
  const match = payload.match(/^(father|mother|student)_([A-Za-z0-9_-]{43})$/);
  if (match) {
    const role = String(match[1]), hash = createHash('sha256').update(String(match[2])).digest('hex');
    const user = await transaction(async tx => {
      const link = await tx.one('SELECT student_id,recipient_role FROM telegram_link_tokens WHERE token_hash=? AND recipient_role=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [hash, role]);
      if (!link) return null;
      const student = await tx.one("SELECT id,first_name,last_name,username FROM users WHERE id=? AND role='student'", [link.student_id]);
      if (!student) return null;
      const field = role === 'father' ? 'father_telegram_chat_id' : role === 'mother' ? 'mother_telegram_chat_id' : 'telegram_chat_id';
      await tx.run(`UPDATE users SET \`${field}\`=? WHERE id=?`, [chatId, student.id]);
      await tx.run('UPDATE telegram_link_tokens SET consumed_at=UTC_TIMESTAMP(3) WHERE token_hash=?', [hash]);
      return student;
    });
    if (user) {
      const name = escapeHtml(`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username);
      await send(chatId, `🎉 <b>تم ربط حسابك بنجاح</b>\n\n${name}\nستصلك تقارير النتائج والتنبيهات تلقائيًا عبر هذا البوت.`);
      return;
    }
  }
  await send(chatId, `👋 <b>مرحبًا بك في بوت منصة الأستاذ</b>\n\nمعرّف المحادثة الخاص بك هو:\n<code>${escapeHtml(chatId)}</code>\n\nاستخدم رابط الربط الموجود في إعدادات الحساب لربط الإشعارات.`);
}

async function pollOnce() {
  const bot = token(); if (!bot) return;
  const cursor = await db.one('SELECT cursor_value FROM integration_cursors WHERE name=?', ['telegram_updates']);
  const offset = Number(cursor?.cursor_value || 0) + 1;
  const response = await fetch(`https://api.telegram.org/bot${bot}/getUpdates?offset=${offset}&timeout=2`, { signal:AbortSignal.timeout(7000) });
  if (!response.ok) return;
  const data = await response.json() as { ok?: boolean; result?: TelegramUpdate[] };
  if (!data.ok || !data.result?.length) return;
  for (const update of data.result) {
    const id = Number(update.update_id || 0); if (!id) continue;
    const message = update.message, chatId = message?.chat?.id == null ? '' : String(message.chat.id);
    if (chatId && message?.text?.startsWith('/start')) await handleStart(chatId, message.text);
    await transaction(async tx => { await tx.run('INSERT INTO integration_cursors(name,cursor_value) VALUES (?,?) ON DUPLICATE KEY UPDATE cursor_value=VALUES(cursor_value)', ['telegram_updates', id]); });
  }
}

let started = false, polling = false;
export function startTelegramPoller() {
  if (started || !token() || process.env.TELEGRAM_POLLING === '0') return;
  started = true;
  const tick = () => { if (polling) return; polling = true; void pollOnce().catch(() => undefined).finally(() => { polling = false; }); };
  const timer = setInterval(tick, 3000);
  timer.unref();
  tick();
}
