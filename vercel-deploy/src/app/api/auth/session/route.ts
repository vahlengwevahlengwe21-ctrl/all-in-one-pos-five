import { NextRequest, NextResponse } from 'next/server';
import { authenticateSessionToken, deleteMysqlSession, sessionCookieName } from '@/lib/mysql-auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const identity = await authenticateSessionToken(request.cookies.get(sessionCookieName)?.value);
    return NextResponse.json({
      user: {
        uid: identity.uid,
        email: identity.email,
        displayName: identity.displayName ?? '',
        photoURL: identity.photoURL ?? null,
        mustChangePassword: identity.profile.mustChangePassword === true,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    console.error('MySQL session lookup failed:', error);
    return NextResponse.json({ error: 'Unable to load the sign-in session.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.headers.get('host')) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
    await deleteMysqlSession(request.cookies.get(sessionCookieName)?.value);
    const response = NextResponse.json({ success: true });
    response.cookies.set(sessionCookieName, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('MySQL sign-out failed:', error);
    return NextResponse.json({ error: 'Unable to sign out.' }, { status: 500 });
  }
}
