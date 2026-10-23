import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getMysqlPool } from '@/lib/mysql';
import { MysqlAccountService, sessionCookieName } from '@/lib/mysql-auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const auth = new MysqlAccountService();

function requestIsSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  return !origin || new URL(origin).host === request.headers.get('host');
}

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || email.length > 320 || password.length > 1024) {
      return NextResponse.json({ error: 'Enter a valid email address and password.' }, { status: 400 });
    }

    const pool = getMysqlPool();
    await pool.execute('DELETE FROM auth_login_attempts WHERE window_started_at < CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR');
    const address = request.ip || request.headers.get('x-real-ip') || 'unknown';
    const attemptKey = createHash('sha256').update(`${email}\0${address}`).digest('hex');
    const [attemptRows] = await pool.execute<any[]>(
      `SELECT failed_attempts, window_started_at
       FROM auth_login_attempts WHERE attempt_key = ? LIMIT 1`,
      [attemptKey],
    );
    const attempts = attemptRows[0];
    if (attempts && new Date(attempts.window_started_at).getTime() > Date.now() - 15 * 60 * 1000
      && attempts.failed_attempts >= 10) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, { status: 429 });
    }

    try {
      const result = await auth.signInWithEmailAndPassword(email, password);
      await pool.execute('DELETE FROM auth_login_attempts WHERE attempt_key = ?', [attemptKey]);
      const response = NextResponse.json({ user: result.user });
      response.cookies.set(sessionCookieName, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: result.expiresAt,
      });
      return response;
    } catch (error) {
      await pool.execute(
        `INSERT INTO auth_login_attempts (attempt_key, failed_attempts, window_started_at)
         VALUES (?, 1, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           failed_attempts = IF(window_started_at < CURRENT_TIMESTAMP(3) - INTERVAL 15 MINUTE, 1, failed_attempts + 1),
           window_started_at = IF(window_started_at < CURRENT_TIMESTAMP(3) - INTERVAL 15 MINUTE, CURRENT_TIMESTAMP(3), window_started_at)`,
        [attemptKey],
      );
      if (error instanceof Error && error.message === 'Invalid email or password.') {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      throw error;
    }
  } catch (error) {
    console.error('MySQL sign-in failed:', error);
    return NextResponse.json({ error: 'Unable to sign in right now.' }, { status: 500 });
  }
}
