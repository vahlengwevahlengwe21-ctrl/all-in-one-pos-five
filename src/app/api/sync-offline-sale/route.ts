import { NextResponse } from 'next/server';
import { createSaleAction } from '@/app/actions/sale-actions';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    if (!payload?.sessionProof || !payload?.idempotencyKey || !payload?.sale || !Array.isArray(payload.items)) {
      return NextResponse.json({ success: false, error: 'Offline sale payload is incomplete.' }, { status: 400 });
    }
    const result = await createSaleAction(payload);
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch {
    return NextResponse.json({ success: false, error: 'Unable to sync offline sale.' }, { status: 400 });
  }
}