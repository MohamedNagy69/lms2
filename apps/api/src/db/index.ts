import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';

// Rows are typed at the SQL boundary; write inputs are validated separately.
export type Row = Record<string, any>;
export const pool = mysql.createPool(config.db);
export function database(connection: typeof pool | PoolConnection = pool) {
  return {
    async rows<T extends Row = Row>(sql: string, values: unknown[] = []): Promise<T[]> {
      const [result] = await connection.query<RowDataPacket[]>(sql, values);
      return result as T[];
    },
    async one<T extends Row = Row>(sql: string, values: unknown[] = []): Promise<T | undefined> {
      return (await this.rows<T>(sql, values))[0];
    },
    async run(sql: string, values: unknown[] = []): Promise<ResultSetHeader> {
      const [result] = await connection.query<ResultSetHeader>(sql, values);
      return result;
    },
  };
}
export const db = database();
export type Database = ReturnType<typeof database>;
export async function transaction<T>(fn: (connection: Database) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const result = await fn(database(connection)); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
