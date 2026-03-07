import pg from "pg";
import type { Config } from "../config/index.js";

let pool: pg.Pool | null = null;

export function getPool(config: Config): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
