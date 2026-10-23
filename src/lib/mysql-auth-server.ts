import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { getMysqlPool } from '@/lib/mysql';
import { hashPassword, verifyPassword } from '@/lib/mysql-password';
import { MysqlStore } from '@/lib/mysql-store';

export const sessionCookieName = 'pos_session';
export const sessionDurationSeconds = 60 * 60 * 24 * 7;
const sessionMarker = 'mysql-session';
const store = new MysqlStore();

export type MysqlUser = {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
};

export type MysqlIdentity = MysqlUser & {
  role: string;
  shopId?: string;
  isSuperAdmin: boolean;
  profile: Record<string, any>;
};

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function authenticateSessionToken(token?: string | null): Promise<MysqlIdentity> {
  if (!token) throw new Error('Unauthorized');
  const pool = getMysqlPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT s.user_id, u.payload
     FROM app_sessions s
     INNER JOIN app_records u ON u.path = CONCAT('users/', s.user_id)
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3)
     LIMIT 1`,
    [hashSessionToken(token)],
  );
  if (!rows.length) throw new Error('Unauthorized');
  const profile = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  const [superAdminRows] = await pool.execute<any[]>(
    'SELECT path FROM app_records WHERE path = ? LIMIT 1',
    [`roles_super_admin/${rows[0].user_id}`],
  );
  return {
    uid: rows[0].user_id,
    email: String(profile.email ?? ''),
    displayName: `${profile.name ?? ''} ${profile.surname ?? ''}`.trim() || undefined,
    photoURL: profile.photoURL,
    role: String(profile.role ?? ''),
    shopId: typeof profile.shopId === 'string' ? profile.shopId : undefined,
    isSuperAdmin: profile.role === 'super administrator' || superAdminRows.length > 0,
    profile,
  };
}

export async function createMysqlSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000);
  const pool = getMysqlPool();
  await pool.execute('DELETE FROM app_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)');
  await pool.execute('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    hashSessionToken(token), userId, expiresAt,
  ]);
  return { token, expiresAt };
}

export async function deleteMysqlSession(token?: string | null) {
  if (!token) return;
  await getMysqlPool().execute('DELETE FROM app_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
}

async function getCookieSessionToken() {
  return cookies().get(sessionCookieName)?.value;
}

export class MysqlAccountService {
  async verifySessionProof(token: string) {
    if (token !== sessionMarker) throw new Error('Authentication session is invalid.');
    const identity = await authenticateSessionToken(await getCookieSessionToken());
    return { uid: identity.uid, email: identity.email, name: identity.displayName ?? identity.email };
  }

  async getUser(userId: string) {
    const profile = (await store.doc(`users/${userId}`).get()).data();
    const [rows] = await getMysqlPool().execute<any[]>(
      'SELECT email FROM user_credentials WHERE user_id = ? LIMIT 1', [userId],
    );
    if (!profile && !rows.length) throw Object.assign(new Error('User not found.'), { code: 'auth/user-not-found' });
    return {
      uid: userId,
      email: rows[0]?.email ?? profile?.email ?? '',
      displayName: `${profile?.name ?? ''} ${profile?.surname ?? ''}`.trim(),
    };
  }

  async createUser(input: { email: string; displayName?: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid email address.');
    }
    const [existing] = await getMysqlPool().execute<any[]>(
      'SELECT user_id FROM user_credentials WHERE email = ? LIMIT 1', [email],
    );
    if (existing.length) throw Object.assign(new Error('A user with this email address already exists.'), { code: 'auth/email-already-exists' });
    const [profileMatches] = await getMysqlPool().execute<any[]>(
      `SELECT path FROM app_records
       WHERE collection_group = 'users'
         AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.email'))) = ?
       LIMIT 1`,
      [email],
    );
    if (profileMatches.length) throw Object.assign(new Error('A user with this email address already exists.'), { code: 'auth/email-already-exists' });
    const uid = randomUUID();
    const { hash, salt } = await hashPassword(input.password);
    await getMysqlPool().execute(
      'INSERT INTO user_credentials (user_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)',
      [uid, email, hash, salt],
    );
    return { uid, email, displayName: input.displayName ?? '' };
  }

  async updateUser(userId: string, input: { password?: string; displayName?: string; revokeSessions?: boolean }) {
    if (input.password !== undefined) {
      const { hash, salt } = await hashPassword(input.password);
      const profile = (await store.doc(`users/${userId}`).get()).data();
      const email = String(profile?.email ?? '').trim().toLowerCase();
      if (!email) throw new Error('A user profile with an email address is required.');
      await getMysqlPool().execute(
        `INSERT INTO user_credentials (user_id, email, password_hash, password_salt)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash), password_salt = VALUES(password_salt)`,
        [userId, email, hash, salt],
      );
      if (input.revokeSessions) {
        await getMysqlPool().execute('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
      }
    }
    if (input.displayName !== undefined) {
      const [name, ...surname] = input.displayName.split(' ');
      await store.doc(`users/${userId}`).set({ name, surname: surname.join(' ') }, { merge: true });
    }
    return this.getUser(userId);
  }

  async deleteUser(userId: string) {
    await getMysqlPool().execute('DELETE FROM user_credentials WHERE user_id = ?', [userId]);
    await getMysqlPool().execute('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
  }

  async signInWithEmailAndPassword(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await getMysqlPool().execute<any[]>(
      `SELECT c.user_id, c.password_hash, c.password_salt, u.payload
       FROM user_credentials c
       INNER JOIN app_records u ON u.path = CONCAT('users/', c.user_id)
       WHERE c.email = ? LIMIT 1`,
      [normalizedEmail],
    );
    if (!rows.length || !await verifyPassword(password, rows[0].password_salt, rows[0].password_hash)) {
      throw new Error('Invalid email or password.');
    }
    const { token, expiresAt } = await createMysqlSession(rows[0].user_id);
    const profile = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    return {
      token,
      expiresAt,
      user: {
        uid: rows[0].user_id,
        email: normalizedEmail,
        displayName: `${profile.name ?? ''} ${profile.surname ?? ''}`.trim(),
        photoURL: profile.photoURL ?? null,
        mustChangePassword: profile.mustChangePassword === true,
      },
    };
  }
}

export function initializeMysqlServer() {
  return { auth: new MysqlAccountService(), mysql: store };
}
