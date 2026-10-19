import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { config, projectRoot } from '../config.js';

if (!/^[a-zA-Z0-9_]+$/.test(config.db.database)) throw new Error('Invalid database name');
const { database: name, connectionLimit: _, ...options } = config.db;
const connection = await mysql.createConnection(options);
try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database: name });
  await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  const folder = path.join(projectRoot, 'apps/api/db/migrations');
  for (const filename of (await fs.readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await fs.readFile(path.join(folder, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const [applied] = await connection.query<any[]>('SELECT checksum FROM schema_migrations WHERE name=?', [filename]);
    if (applied.length) { if (applied[0].checksum !== checksum) throw new Error(`Applied migration changed: ${filename}`); continue; }
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(statement);
    await connection.query('INSERT INTO schema_migrations(name,checksum) VALUES (?,?)', [filename, checksum]);
    console.log(`Applied ${filename}`);
  }
} finally { await connection.end(); }
