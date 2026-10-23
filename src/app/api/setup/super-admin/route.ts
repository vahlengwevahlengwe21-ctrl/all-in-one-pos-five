import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/mysql-password';
import { getMysqlPool } from '@/lib/mysql';
import type { MysqlConnection } from '@/lib/mysql-gateway-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const setupMarkerPath = 'setup_state/initial_super_admin';
const lockMarkerQuery = 'SELECT payload FROM app_records WHERE path = ? FOR UPDATE';
const collectionLockQuery = 'SELECT path, payload FROM app_records WHERE collection_path = ? FOR UPDATE';
const existingEmailQuery = 'SELECT user_id FROM user_credentials WHERE email = ? LIMIT 1';
const insertCredentialQuery = `INSERT INTO user_credentials (user_id, email, password_hash, password_salt)
  VALUES (?, ?, ?, ?)`;
const upsertRecordQuery = `INSERT INTO app_records (path, collection_path, collection_group, doc_id, payload)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`;

class SetupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function tokenMatches(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

async function upsertRecord(
  connection: MysqlConnection,
  path: string,
  payload: Record<string, unknown>,
) {
  const parts = path.split('/');
  if (parts.length !== 2) throw new Error('Invalid setup record path.');
  await connection.execute(upsertRecordQuery, [
    path,
    parts.slice(0, -1).join('/'),
    parts[parts.length - 2],
    parts[parts.length - 1],
    JSON.stringify(payload),
  ]);
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'JSON content type required.' }, { status: 415 });
  }

  const setupToken = process.env.MYSQL_SUPER_ADMIN_SETUP_TOKEN;
  const configuredEmail = process.env.MYSQL_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!setupToken || !configuredEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail)) {
    return NextResponse.json({ error: 'Initial administrator setup is unavailable.' }, { status: 404 });
  }

  let body: {
    token?: unknown;
    email?: unknown;
    name?: unknown;
    surname?: unknown;
    password?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }

  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || typeof body.token !== 'string'
    || typeof body.email !== 'string'
    || typeof body.name !== 'string'
    || typeof body.surname !== 'string'
    || typeof body.password !== 'string'
    || body.token.length > 128
    || body.email.length > 320
    || body.name.trim().length === 0
    || body.name.trim().length > 100
    || body.surname.trim().length === 0
    || body.surname.trim().length > 100
    || body.password.length < 12
    || body.password.length > 1024
  ) {
    return NextResponse.json({ error: 'Enter valid administrator details and a password of at least 12 characters.' }, { status: 400 });
  }
  if (!tokenMatches(setupToken, body.token)) {
    return NextResponse.json({ error: 'Invalid setup token.' }, { status: 403 });
  }

  const email = body.email.trim().toLowerCase();
  if (email !== configuredEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'The email does not match the configured administrator account.' }, { status: 400 });
  }

  try {
    const { hash, salt } = await hashPassword(body.password);
    const userId = randomUUID();
    const createdAt = { __mysqlType: 'timestamp', value: Date.now() };
    const pool = getMysqlPool();
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [markerRows] = await connection.execute<(RowDataPacket & { payload: unknown })[]>(
        lockMarkerQuery,
        [setupMarkerPath],
      );
      const [users] = await connection.execute<(RowDataPacket & { path: string })[]>(
        collectionLockQuery,
        ['users'],
      );
      const [adminRoles] = await connection.execute<(RowDataPacket & { path: string })[]>(
        collectionLockQuery,
        ['roles_super_admin'],
      );
      const [adminAccounts] = await connection.execute<(RowDataPacket & { path: string })[]>(
        collectionLockQuery,
        ['roles_admin'],
      );
      const [matchingCredentials] = await connection.execute<(RowDataPacket & { user_id: string })[]>(
        existingEmailQuery,
        [email],
      );

      if (markerRows.length || users.length || adminRoles.length || adminAccounts.length || matchingCredentials.length) {
        throw new SetupError('Initial setup is already complete or the database is not empty.', 409);
      }

      await connection.execute(insertCredentialQuery, [userId, email, hash, salt]);
      await upsertRecord(connection, `users/${userId}`, {
        id: userId,
        name: body.name.trim(),
        surname: body.surname.trim(),
        email,
        role: 'super administrator',
        hiddenFromUserList: true,
        mustChangePassword: true,
        createdAt,
      });
      await upsertRecord(connection, `roles_admin/${userId}`, { createdAt });
      await upsertRecord(connection, `roles_super_admin/${userId}`, { createdAt });
      await upsertRecord(connection, setupMarkerPath, { email, createdAt });
      await connection.commit();
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SetupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Initial super administrator setup failed:', error);
    return NextResponse.json({ error: 'Unable to create the initial administrator.' }, { status: 500 });
  }
}
