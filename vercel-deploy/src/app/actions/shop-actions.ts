'use server';

import { createHash, randomBytes } from 'crypto';
import { initializeMysqlServer } from '@/lib/mysql-auth-server';
import { FieldValue, Timestamp, type Query } from '@/lib/mysql-store';
import { writeAuditEvent } from '@/lib/audit';

async function requireSuperAdmin(sessionProof: string) {
  const { auth, mysql } = initializeMysqlServer();
  if (!sessionProof) throw new Error('Authentication token is missing.');
  const decoded = await auth.verifySessionProof(sessionProof);
  const role = await mysql.collection('roles_super_admin').doc(decoded.uid).get();
  if (!role.exists) {
    const profile = await mysql.collection('users').doc(decoded.uid).get();
    if (profile.data()?.role !== 'super administrator') {
      throw new Error('Only super administrators can manage shops.');
    }
  }
  return { auth, mysql, uid: decoded.uid };
}

async function requireShopAccess(sessionProof: string, shopId: string) {
  const { auth, mysql } = initializeMysqlServer();
  if (!sessionProof) throw new Error('Authentication token is missing.');
  const decoded = await auth.verifySessionProof(sessionProof);
  const profile = await mysql.collection('users').doc(decoded.uid).get();
  const isSuperAdmin = profile.data()?.role === 'super administrator' || (await mysql.collection('roles_super_admin').doc(decoded.uid).get()).exists;
  if (!isSuperAdmin && profile.data()?.shopId !== shopId) throw new Error('You do not have access to this shop.');
  return { mysql, role: profile.data()?.role };
}

function normalizeShopId(value: string) {
  const shopId = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(shopId)) {
    throw new Error('Shop ID must be 3-40 characters and contain only letters, numbers, hyphens, or underscores.');
  }
  return shopId;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function payFastSignature(fields: Record<string, string>, passphrase?: string) {
  const encoded = Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value.trim()).replace(/%20/g, '+')}`)
    .join('&');
  const value = passphrase ? `${encoded}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}` : encoded;
  return createHash('md5').update(value).digest('hex');
}

function nextBillingDate(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function getBillingExpiry(shop: Record<string, any>) {
  const explicitExpiry = shop.billingExpiresAt?.toDate?.() || shop.billingExpiresAt;
  if (explicitExpiry) return new Date(explicitExpiry);
  const createdAt = shop.createdAt?.toDate?.() || shop.createdAt;
  return createdAt ? nextBillingDate(new Date(createdAt)) : null;
}

function assertBillingActive(shop: Record<string, any>) {
  if (shop.billingStatus !== 'active') throw new Error('This shop account is suspended. Please pay the monthly fee.');
  const expiresAt = getBillingExpiry(shop);
  if (expiresAt && new Date(expiresAt) <= new Date()) throw new Error('Monthly payment is due. Please pay the monthly fee to unlock this shop.');
}

export async function listShopsAction(payload: { sessionProof: string }) {
  try {
    const { mysql } = await requireSuperAdmin(payload.sessionProof);
    const snapshot = await mysql.collection('shops').get();
    const shops = snapshot.docs
      .map((shop) => {
        const data = shop.data();
        return {
          id: shop.id,
          shopName: data.shopName || '',
          address: data.address || null,
          phone: data.phone || null,
          website: data.website || null,
          ownerEmail: data.ownerEmail || null,
          billingStatus: data.billingStatus || 'active',
          billingExpiresAt: data.billingExpiresAt?.toMillis?.() || null,
          maxUsersAllowed: Number(data.maxUsersAllowed || 0),
          maxDevicesAllowed: Number(data.maxDevicesAllowed || 0),
          ownerUid: data.ownerUid || null,
          createdAt: data.createdAt?.toMillis?.() || null,
          activationToken: data.activationToken || null,
          activationTokenExpiresAt: data.activationTokenExpiresAt?.toMillis?.() || null,
        };
      })
      .sort((left: any, right: any) => {
        const leftTime = left.createdAt?.toMillis?.() || 0;
        const rightTime = right.createdAt?.toMillis?.() || 0;
        return rightTime - leftTime;
      });
    return {
      success: true,
      shops,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to load shops.' };
  }
}

export async function getShopProfileAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireShopAccess(payload.sessionProof, payload.shopId);
    const snapshot = await mysql.collection('shops').doc(payload.shopId).get();
    if (!snapshot.exists) throw new Error('Shop profile not found.');
    const data = snapshot.data() || {};
    return { success: true, shop: { id: snapshot.id, shopName: data.shopName || '', address: data.address || null, phone: data.phone || null, website: data.website || null } };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to load shop profile.' };
  }
}

export async function getShopBillingStatusAction(payload: { sessionProof: string; shopId: string }) {
    try {
      const { mysql } = await requireShopAccess(payload.sessionProof, payload.shopId);
      const snapshot = await mysql.collection('shops').doc(payload.shopId).get();
      if (!snapshot.exists) throw new Error('Shop not found.');
      const data = snapshot.data() || {};
      return { success: true, shop: { id: snapshot.id, shopName: data.shopName || '', billingStatus: data.billingStatus || 'active', billingExpiresAt: data.billingExpiresAt?.toMillis?.() || null } };
    } catch (error: any) {
      return { success: false, error: error.message || 'Unable to load billing status.' };
    }
  }
export async function updateShopProfileAction(payload: { sessionProof: string; shopId: string; shopName: string; address?: string; phone?: string; website?: string }) {
  try {
    const { mysql, role } = await requireShopAccess(payload.sessionProof, payload.shopId);
    if (role !== 'shop owner' && role !== 'super administrator') throw new Error('Only a shop owner can update this profile.');
    const shopName = payload.shopName.trim();
    if (!shopName) throw new Error('Shop name is required.');
    await mysql.collection('shops').doc(payload.shopId).update({ shopName, address: payload.address?.trim() || null, phone: payload.phone?.trim() || null, website: payload.website?.trim() || null });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to save shop profile.' };
  }
}

export async function getShopPaymentSettingsAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireShopAccess(payload.sessionProof, payload.shopId);
    const snapshot = await mysql.collection('shop_payment_settings').doc(payload.shopId).get();
    const data = snapshot.data() || {};
    return {
      success: true,
      settings: {
        shopId: payload.shopId,
        provider: data.provider || 'manual_terminal',
        displayName: data.displayName || 'Card machine',
        merchantId: data.merchantId || null,
        terminalName: data.terminalName || null,
        currency: 'ZAR',
        enabled: data.enabled !== false,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to load payment settings.' };
  }
}

export async function updateShopPaymentSettingsAction(payload: {
  sessionProof: string;
  shopId: string;
  provider: 'manual_terminal' | 'stripe_terminal' | 'payfast' | 'paystack' | 'yoco' | 'ikhokha' | 'snapscan';
  displayName: string;
  merchantId?: string;
  terminalName?: string;
  enabled: boolean;
}) {
  try {
    const { mysql, role } = await requireShopAccess(payload.sessionProof, payload.shopId);
    if (role !== 'shop owner' && role !== 'super administrator') throw new Error('Only a shop owner can update payment settings.');
    if (!payload.displayName.trim()) throw new Error('Give this card machine a name.');
    await mysql.collection('shop_payment_settings').doc(payload.shopId).set({
      shopId: payload.shopId,
      provider: payload.provider,
      displayName: payload.displayName.trim(),
      merchantId: payload.merchantId?.trim() || null,
      terminalName: payload.terminalName?.trim() || null,
      currency: 'ZAR',
      enabled: payload.enabled,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to save payment settings.' };
  }
}

export async function markShopPaidAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql, uid } = await requireSuperAdmin(payload.sessionProof);
    const shopRef = mysql.collection('shops').doc(normalizeShopId(payload.shopId));
    const snapshot = await shopRef.get();
    if (!snapshot.exists) throw new Error('Shop not found.');
    const currentExpiry = getBillingExpiry(snapshot.data() || {});
    const baseDate = currentExpiry && new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date();
    const billingExpiresAt = nextBillingDate(baseDate);
    await shopRef.update({ billingStatus: 'active', billingExpiresAt: Timestamp.fromDate(billingExpiresAt), lastPaymentAt: Timestamp.now() });
    await writeAuditEvent(mysql, {
      action: 'billing.month_paid',
      actorId: uid,
      shopId: shopRef.id,
      entityType: 'shop',
      entityId: shopRef.id,
      details: { billingExpiresAt: billingExpiresAt.toISOString() },
    });
    return { success: true, billingExpiresAt: billingExpiresAt.getTime() };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to record monthly payment.' };
  }
}

export async function createPayFastBillingCheckoutAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireShopAccess(payload.sessionProof, payload.shopId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const merchantId = process.env.PAYFAST_MERCHANT_ID;
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
    const passphrase = process.env.PAYFAST_PASSPHRASE;
    const amount = process.env.POS_MONTHLY_FEE_ZAR || '550.00';
    if (!appUrl || !merchantId || !merchantKey || !passphrase) throw new Error('PayFast billing is not configured yet.');
    const shopSnapshot = await mysql.collection('shops').doc(normalizeShopId(payload.shopId)).get();
    if (!shopSnapshot.exists) throw new Error('Shop not found.');
    const paymentId = `${shopSnapshot.id}-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const fields = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${appUrl}/settings/billing?payment=success`,
      cancel_url: `${appUrl}/settings/billing?payment=cancelled`,
      notify_url: `${appUrl}/api/billing/payfast/webhook`,
      m_payment_id: paymentId,
      amount: Number(amount).toFixed(2),
      item_name: `Monthly POS subscription - ${shopSnapshot.data()?.shopName || shopSnapshot.id}`,
    };
    await mysql.collection('billing_payments').doc(paymentId).set({ shopId: shopSnapshot.id, amount: Number(amount), provider: 'payfast', status: 'pending', createdAt: Timestamp.now() });
    return { success: true, paymentUrl: `${process.env.PAYFAST_BASE_URL || 'https://www.payfast.co.za'}/eng/process`, fields: { ...fields, signature: payFastSignature(fields, passphrase) } };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to start PayFast checkout.' };
  }
}

export async function listAuditEventsAction(payload: { sessionProof: string; shopId?: string }) {
  try {
    const { auth, mysql } = initializeMysqlServer();
    const decoded = await auth.verifySessionProof(payload.sessionProof);
    const profile = await mysql.collection('users').doc(decoded.uid).get();
    const isSuperAdmin = profile.data()?.role === 'super administrator' || (await mysql.collection('roles_super_admin').doc(decoded.uid).get()).exists;
    const shopId = isSuperAdmin ? payload.shopId : profile.data()?.shopId;
    if (!isSuperAdmin && !shopId) throw new Error('Your account is not assigned to a shop.');
    let query: Query = shopId
      ? mysql.collection('audit_logs').where('shopId', '==', shopId).limit(100)
      : mysql.collection('audit_logs').limit(100);
    const snapshot = await query.get();
    return {
      success: true,
      events: snapshot.docs.map((event) => {
        const data = event.data();
        return { id: event.id, action: data.action || '', actorId: data.actorId || '', actorName: data.actorName || null, shopId: data.shopId || null, entityType: data.entityType || '', entityId: data.entityId || '', details: data.details || {}, createdAt: data.createdAt?.toMillis?.() || null };
      }).sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0)),
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to load audit events.' };
  }
}

export async function createShopAction(payload: {
  sessionProof: string;
  shopId: string;
  shopName: string;
  ownerEmail: string;
  ownerTemporaryPassword: string;
  maxUsersAllowed: number;
  maxDevicesAllowed: number;
}) {
  try {
    const { auth, mysql, uid } = await requireSuperAdmin(payload.sessionProof);
    const shopId = normalizeShopId(payload.shopId);
    const shopName = payload.shopName.trim();
    const ownerEmail = payload.ownerEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('A valid shop owner email is required.');
    if (payload.ownerTemporaryPassword.length < 10) throw new Error('The temporary password must be at least 10 characters.');
    if (!shopName) throw new Error('Shop name is required.');
    if (!Number.isInteger(payload.maxDevicesAllowed) || payload.maxDevicesAllowed < 1 || payload.maxDevicesAllowed > 100) {
      throw new Error('Device limit must be a whole number between 1 and 100.');
    }
    if (!Number.isInteger(payload.maxUsersAllowed) || payload.maxUsersAllowed < 1 || payload.maxUsersAllowed > 100) {
      throw new Error('User limit must be a whole number between 1 and 100.');
    }

    const activationToken = `SPAZA-${randomBytes(5).toString('hex').toUpperCase()}`;
    const ownerRecord = await auth.createUser({
      email: ownerEmail,
      password: payload.ownerTemporaryPassword,
      displayName: ownerEmail,
    });
    const shopRef = mysql.collection('shops').doc(shopId);
    try {
      const now = Timestamp.now();
      await mysql.runTransaction(async (transaction) => {
        const existing = await transaction.get(shopRef);
        if (existing.exists) throw new Error('That Shop ID already exists.');
        transaction.create(shopRef, {
          shopName,
          ownerEmail,
          ownerUid: ownerRecord.uid,
          billingStatus: 'active',
          billingExpiresAt: Timestamp.fromDate(nextBillingDate()),
          maxUsersAllowed: payload.maxUsersAllowed,
          maxDevicesAllowed: payload.maxDevicesAllowed,
          createdAt: now,
          createdBy: uid,
          activationTokenHash: hashToken(activationToken),
          activationToken,
          activationTokenCreatedAt: now,
          activationTokenExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        });
        transaction.create(mysql.collection('users').doc(ownerRecord.uid), {
          id: ownerRecord.uid,
          name: ownerEmail.split('@')[0],
          surname: '',
          email: ownerEmail,
          role: 'shop owner',
          shopId,
          mustChangePassword: true,
          createdAt: now,
        });
        transaction.create(mysql.collection('roles_admin').doc(ownerRecord.uid), { shopId, createdAt: now });
        for (let index = 1; index <= payload.maxDevicesAllowed; index += 1) {
          transaction.create(mysql.collection('device_seats').doc(`${shopId}_seat_${index}`), {
            shopId,
            seatNumber: index,
            hardwareId: null,
            status: 'available',
            createdAt: now,
          });
        }
      });
    } catch (creationError) {
      await auth.deleteUser(ownerRecord.uid).catch(() => undefined);
      throw creationError;
    }

    return { success: true, shopId, ownerEmail, activationToken };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to create shop.' };
  }
}

export async function registerDeviceAction(payload: {
  sessionProof: string;
  shopId: string;
  hardwareId: string;
}) {
  try {
    const { mysql } = initializeMysqlServer();
    const { auth: adminAuth } = initializeMysqlServer();
    if (!payload.sessionProof || !payload.hardwareId?.trim()) throw new Error('Device registration details are incomplete.');
    const user = await adminAuth.verifySessionProof(payload.sessionProof);
    const userProfile = await mysql.collection('users').doc(user.uid).get();
    if (userProfile.data()?.shopId !== payload.shopId) throw new Error('You are not assigned to this shop.');
    const shopRef = mysql.collection('shops').doc(normalizeShopId(payload.shopId));
    const result = await mysql.runTransaction(async (transaction) => {
      const shopSnapshot = await transaction.get(shopRef);
      if (!shopSnapshot.exists) throw new Error('Shop not found.');
      const shop = shopSnapshot.data()!;
      assertBillingActive(shop);
      const seatsSnapshot = await transaction.get(mysql.collection('device_seats').where('shopId', '==', shopRef.id));
      const existing = seatsSnapshot.docs.find((seat) => seat.data().hardwareId === payload.hardwareId.trim());
      if (existing) {
        transaction.update(existing.ref, { lastSeenAt: Timestamp.now() });
        return { seatId: existing.id, registered: true };
      }
      const available = seatsSnapshot.docs.find((seat) => seat.data().status === 'available' || !seat.data().hardwareId);
      if (!available) throw new Error(`All ${shop.maxDevicesAllowed} device seats are already registered.`);
      transaction.update(available.ref, {
        hardwareId: payload.hardwareId.trim(),
        status: 'registered',
        registeredAt: Timestamp.now(),
        registeredBy: user.uid,
        lastSeenAt: Timestamp.now(),
      });
      return { seatId: available.id, registered: true };
    });
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to register device.' };
  }
}

export async function resetDeviceAction(payload: { sessionProof: string; seatId: string }) {
  try {
    const { mysql } = await requireSuperAdmin(payload.sessionProof);
    const seatRef = mysql.collection('device_seats').doc(payload.seatId);
    await seatRef.update({
      hardwareId: null,
      terminalTokenHash: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      lastOnlineAt: FieldValue.delete(),
      lockState: FieldValue.delete(),
      status: 'available',
      resetAt: Timestamp.now(),
      lastSeenAt: FieldValue.delete(),
      registeredAt: FieldValue.delete(),
      registeredBy: FieldValue.delete(),
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to reset device seat.' };
  }
}

export async function regenerateActivationTokenAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireSuperAdmin(payload.sessionProof);
    const token = `SPAZA-${randomBytes(5).toString('hex').toUpperCase()}`;
    const shopRef = mysql.collection('shops').doc(normalizeShopId(payload.shopId));
    await shopRef.update({
      activationTokenHash: hashToken(token),
      activationToken: token,
      activationTokenCreatedAt: Timestamp.now(),
      activationTokenExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });
    return { success: true, activationToken: token };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to generate an activation token.' };
  }
}

export async function listDeviceSeatsAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireSuperAdmin(payload.sessionProof);
    const snapshot = await mysql.collection('device_seats')
      .where('shopId', '==', normalizeShopId(payload.shopId))
      .get();
    const seats = snapshot.docs.map((seat) => ({
      id: seat.id,
      seatNumber: Number((seat.data() as { seatNumber?: number }).seatNumber || 0),
      hardwareId: (seat.data() as { hardwareId?: string | null }).hardwareId || null,
      status: (seat.data() as { status?: string }).status || 'available',
      lockState: (seat.data() as { lockState?: string }).lockState || null,
      lastOnlineAt: (seat.data() as { lastOnlineAt?: Timestamp }).lastOnlineAt?.toMillis?.() || null,
    }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return { success: true, seats };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to load device seats.' };
  }
}

export async function redeemActivationTokenAction(payload: {
  token: string;
  hardwareId: string;
}) {
  try {
    const { mysql } = initializeMysqlServer();
    const token = payload.token.trim().toUpperCase();
    const hardwareId = payload.hardwareId.trim();
    if (!token || !hardwareId) throw new Error('Activation details are incomplete.');

    const shopsSnapshot = await mysql.collection('shops')
      .where('activationTokenHash', '==', hashToken(token))
      .limit(1)
      .get();
    if (shopsSnapshot.empty) throw new Error('Invalid or already-used activation token.');

    const shopRef = shopsSnapshot.docs[0].ref;
    return await mysql.runTransaction(async (transaction) => {
      const shopSnapshot = await transaction.get(shopRef);
      if (!shopSnapshot.exists) throw new Error('Shop not found.');
      const shop = shopSnapshot.data()!;
      assertBillingActive(shop);
      if (!shop.activationTokenHash) throw new Error('Activation token has already been used.');
      const activationExpiresAt = shop.activationTokenExpiresAt?.toDate?.() || shop.activationTokenExpiresAt;
      if (activationExpiresAt && activationExpiresAt < new Date()) throw new Error('This activation token has expired.');

      const seatsSnapshot = await transaction.get(
        mysql.collection('device_seats').where('shopId', '==', shopRef.id)
      );
      const now = Timestamp.now();
      const terminalToken = randomBytes(32).toString('hex');
      const existingSeat = seatsSnapshot.docs.find((seat) => seat.data().hardwareId === hardwareId);
      if (existingSeat) {
        transaction.update(existingSeat.ref, {
          lastSeenAt: now,
          lastOnlineAt: now,
          leaseExpiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
          terminalTokenHash: hashToken(terminalToken),
          lockState: 'unlocked',
        });
        transaction.update(shopRef, {
          activationTokenUsedAt: now,
        });
        return { success: true, shopId: shopRef.id, shopName: shop.shopName, maxDevicesAllowed: shop.maxDevicesAllowed, terminalToken };
      }
      const availableSeat = seatsSnapshot.docs.find((seat) => !seat.data().hardwareId);
      if (!availableSeat) throw new Error(`All ${shop.maxDevicesAllowed} device seats are already registered.`);

      transaction.update(availableSeat.ref, {
        hardwareId,
        status: 'registered',
        registeredAt: now,
        lastSeenAt: now,
        lastOnlineAt: now,
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        terminalTokenHash: hashToken(terminalToken),
        lockState: 'unlocked',
      });
      transaction.update(shopRef, {
        activationTokenUsedAt: now,
      });
      return { success: true, shopId: shopRef.id, shopName: shop.shopName, maxDevicesAllowed: shop.maxDevicesAllowed, terminalToken };
    });
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to activate this device.' };
  }
}

const LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

function serializeTerminalStatus(data: Record<string, any>, now = Date.now()) {
  const leaseExpiresAt = data.leaseExpiresAt?.toDate?.()?.getTime?.() || 0;
  const locked = data.lockState === 'locked' || leaseExpiresAt <= now;
  return {
    shopId: data.shopId,
    hardwareId: data.hardwareId,
    online: true,
    lockState: locked ? 'locked' : 'unlocked',
    leaseExpiresAt: leaseExpiresAt || null,
    offlineWindowDays: 7,
  };
}

export async function heartbeatTerminalAction(payload: {
  shopId: string;
  hardwareId: string;
  terminalToken: string;
}) {
  try {
    const { mysql } = initializeMysqlServer();
    const seats = await mysql.collection('device_seats')
      .where('shopId', '==', normalizeShopId(payload.shopId))
      .get();
    const seat = seats.docs.find((candidate) => candidate.data().hardwareId === payload.hardwareId.trim());
    if (!seat || seat.data().terminalTokenHash !== hashToken(payload.terminalToken)) {
      throw new Error('Terminal is not registered.');
    }
    const leaseExpiresAt = seat.data().leaseExpiresAt?.toDate?.()?.getTime?.() || 0;
    const shopSnapshot = await mysql.collection('shops').doc(normalizeShopId(payload.shopId)).get();
    if (!shopSnapshot.exists) throw new Error('Shop not found.');
    const shop = shopSnapshot.data()!;
    assertBillingActive(shop);
    const lockState = seat.data().lockState === 'locked' || leaseExpiresAt <= Date.now() ? 'locked' : 'unlocked';
    await seat.ref.update({ lastSeenAt: Timestamp.now(), lastOnlineAt: Timestamp.now(), lockState });
    return { success: true, status: serializeTerminalStatus({ ...seat.data(), lockState }) };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to check terminal status.' };
  }
}

export async function unlockShopTerminalsAction(payload: { sessionProof: string; shopId: string }) {
  try {
    const { mysql } = await requireSuperAdmin(payload.sessionProof);
    const seats = await mysql.collection('device_seats').where('shopId', '==', normalizeShopId(payload.shopId)).get();
    const registered = seats.docs.filter((seat) => seat.data().hardwareId);
    const cutoff = Date.now() - HEARTBEAT_FRESH_MS;
    const offline = registered.filter((seat) => (seat.data().lastOnlineAt?.toDate?.()?.getTime?.() || 0) < cutoff);
    if (offline.length) throw new Error(`${offline.length} registered computer(s) must connect before the shop can be unlocked.`);
    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + LEASE_MS);
    await Promise.all(registered.map((seat) => seat.ref.update({ lockState: 'unlocked', leaseExpiresAt })));
    return { success: true, leaseExpiresAt: leaseExpiresAt.toMillis() };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to unlock shop terminals.' };
  }
}

export async function createShopOwnerAction(payload: {
  setupToken: string;
  name: string;
  surname: string;
  email: string;
  password: string;
}) {
  const { auth, mysql } = initializeMysqlServer();
  let createdUid: string | undefined;
  try {
    const setupToken = payload.setupToken.trim();
    if (!setupToken || !payload.name.trim() || !payload.surname.trim()) throw new Error('Owner details are incomplete.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new Error('Enter a valid email address.');
    if (payload.password.length < 10) throw new Error('Password must be at least 10 characters.');

    const shops = await mysql.collection('shops')
      .where('ownerSetupTokenHash', '==', hashToken(setupToken))
      .limit(1)
      .get();
    if (shops.empty) throw new Error('This owner setup link is invalid or already used.');
    const shopRef = shops.docs[0].ref;
    const shop = shops.docs[0].data();
    const expiresAt = shop.ownerSetupTokenExpiresAt?.toDate?.() || shop.ownerSetupTokenExpiresAt;
    if (expiresAt && expiresAt < new Date()) throw new Error('This owner setup link has expired.');

    const userRecord = await auth.createUser({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      displayName: `${payload.name.trim()} ${payload.surname.trim()}`,
    });
    createdUid = userRecord.uid;
    const now = Timestamp.now();
    await mysql.runTransaction(async (transaction) => {
      const currentShop = await transaction.get(shopRef);
      if (!currentShop.exists || !currentShop.data()?.ownerSetupTokenHash) throw new Error('This owner setup link has already been used.');
      const profileRef = mysql.collection('users').doc(userRecord.uid);
      const roleRef = mysql.collection('roles_admin').doc(userRecord.uid);
      transaction.create(profileRef, {
        id: userRecord.uid,
        name: payload.name.trim(),
        surname: payload.surname.trim(),
        email: payload.email.trim().toLowerCase(),
        role: 'shop owner',
        shopId: shopRef.id,
        createdAt: now,
      });
      transaction.set(roleRef, { shopId: shopRef.id, createdAt: now });
      transaction.update(shopRef, {
        ownerUid: userRecord.uid,
        ownerSetupTokenHash: FieldValue.delete(),
        ownerSetupTokenExpiresAt: FieldValue.delete(),
      });
    });
    return { success: true, shopId: shopRef.id };
  } catch (error: any) {
    if (createdUid) await auth.deleteUser(createdUid).catch(() => undefined);
    return { success: false, error: error.message || 'Unable to create shop owner.' };
  }
}
