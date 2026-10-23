import { NextRequest, NextResponse } from 'next/server';

const backendOrigin = 'https://pos.allinonesolution.uk';

export function middleware(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.next();

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get('host')) {
        return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
  }

  const destination = new URL(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    backendOrigin,
  );
  const headers = new Headers(request.headers);
  if (origin) headers.set('origin', backendOrigin);

  return NextResponse.rewrite(destination, { request: { headers } });
}

export const config = {
  matcher: [
    '/api/:path*',
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'next-action' }],
    },
  ],
};
