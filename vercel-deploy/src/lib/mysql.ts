import 'server-only';

import { createPool, type Pool } from 'mysql2/promise';

const globalForMysql = globalThis as typeof globalThis & {
  mysqlPool?: Pool;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required MySQL environment variable: ${name}`);
  }
  return value;
}

export function getMysqlPool(): Pool {
  if (!globalForMysql.mysqlPool) {
    const port = Number(process.env.DB_PORT ?? '3306');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DB_PORT must be a valid TCP port.');
    }

    const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');

    globalForMysql.mysqlPool = createPool({
      host: requiredEnv('DB_HOST'),
      port,
      user: requiredEnv('DB_USER'),
      password: requiredEnv('DB_PASSWORD'),
      database: requiredEnv('DB_NAME'),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl: process.env.DB_SSL?.toLowerCase() === 'false'
        ? undefined
        : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    });
  }

  return globalForMysql.mysqlPool;
}
