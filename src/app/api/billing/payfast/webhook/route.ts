import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { Timestamp } from '@/lib/mysql-store';
import { initializeMysqlServer } from '@/lib/mysql-auth-server';
import { writeAuditEvent } from '@/lib/audit';

function signature(fields: Record<string, string>, passphrase: string, includeEmpty = false, spacesAsPlus = true) {
  const encoded = Object.entries(fields)
    .filter(([key, value]) => key !== 'signature' && (includeEmpty || value !== ''))
    .map(([key, value]) => `${key}=${spacesAsPlus ? encodeURIComponent(value.trim()).replace(/%20/g, '+') : encodeURIComponent(value.trim())}`)
    .join('&');
  const encodedPassphrase = spacesAsPlus ? encodeURIComponent(passphrase.trim()).replace(/%20/g, '+') : encodeURIComponent(passphrase.trim());
  return createHash('md5').update(`${encoded}&passphrase=${encodedPassphrase}`).digest('hex');
}

function nextBillingDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let body: string;
    let fields: Record<string, string>;
    if (contentType.startsWith('multipart/form-data')) {
      const formData = await request.formData();
      fields = {};
      formData.forEach((value, key) => {
        if (typeof value === 'string') fields[key] = value;
      });
      body = new URLSearchParams(fields).toString();
    } else {
      body = await request.text();
      fields = Object.fromEntries(new URLSearchParams(body).entries());
    }
    const passphrase = process.env.PAYFAST_PASSPHRASE;
    const merchantId = process.env.PAYFAST_MERCHANT_ID;
    if (!passphrase || !merchantId || !fields.m_payment_id || fields.merchant_id !== merchantId) {
      console.error('PayFast ITN identity validation failed', { hasPassphrase: Boolean(passphrase), hasMerchantId: Boolean(merchantId), paymentId: fields.m_payment_id, merchantId: fields.merchant_id });
      return NextResponse.json({ success: false }, { status: 400 });
    }
    const expectedSignature = signature(fields, passphrase, true, true);
    if (fields.signature !== expectedSignature) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const baseUrl = process.env.PAYFAST_BASE_URL || 'https://www.payfast.co.za';
    const confirmation = await fetch(`${baseUrl}/eng/query/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'All-In-One-POS/1.0',
        Referer: `${baseUrl}/eng/process`,
      },
      body,
    });
    const confirmationBody = (await confirmation.text()).trim();
    if (confirmationBody !== 'VALID') {
      console.error('PayFast ITN confirmation failed', { paymentId: fields.m_payment_id, status: confirmation.status, body: confirmationBody });
      return NextResponse.json({ success: false }, { status: 400 });
    }
    if (fields.payment_status !== 'COMPLETE') return NextResponse.json({ success: true }, { status: 200 });

    const { mysql } = initializeMysqlServer();
    await mysql.runTransaction(async (transaction) => {
      const paymentRef = mysql.collection('billing_payments').doc(fields.m_payment_id);
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists) throw new Error('Billing payment was not found.');
      const payment = paymentSnapshot.data()!;
      if (payment.status === 'paid') return;
      if (Math.abs(Number(fields.amount_gross) - Number(payment.amount)) > 0.01) throw new Error('PayFast amount does not match the billing payment.');
      const shopRef = mysql.collection('shops').doc(payment.shopId);
      const shopSnapshot = await transaction.get(shopRef);
      if (!shopSnapshot.exists) throw new Error('Shop was not found.');
      const currentExpiry = shopSnapshot.data()?.billingExpiresAt?.toDate?.() || shopSnapshot.data()?.billingExpiresAt;
      const baseDate = currentExpiry && new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date();
      transaction.update(paymentRef, { status: 'paid', providerPaymentId: fields.pf_payment_id || null, paidAt: Timestamp.now() });
      transaction.update(shopRef, { billingStatus: 'active', billingExpiresAt: Timestamp.fromDate(nextBillingDate(baseDate)), lastPaymentAt: Timestamp.now(), billingProvider: 'payfast' });
    });
    const paymentSnapshot = await mysql.collection('billing_payments').doc(fields.m_payment_id).get();
    await writeAuditEvent(mysql, { action: 'billing.payfast_paid', actorId: 'payfast-webhook', shopId: paymentSnapshot.data()?.shopId || null, entityType: 'billing_payment', entityId: fields.m_payment_id, details: { providerPaymentId: fields.pf_payment_id || null, amount: fields.amount_gross } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Unable to process PayFast notification.' }, { status: 400 });
  }
}
