import { NextRequest, NextResponse } from 'next/server';
import { authenticateSessionToken, sessionCookieName } from '@/lib/mysql-auth-server';
import { MysqlStore, type Query } from '@/lib/mysql-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const store = new MysqlStore();
const protectedCollections = new Set([
  'sales', 'inventory_transactions', 'audit_logs', 'roles_admin', 'billing_events',
]);
const managerRoles = new Set(['shop owner', 'super administrator']);

type Identity = { uid: string; role: string; shopId?: string; isSuperAdmin: boolean };

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getIdentity(request: NextRequest): Promise<Identity> {
  const identity = await authenticateSessionToken(request.cookies.get(sessionCookieName)?.value);
  return {
    uid: identity.uid,
    role: identity.role,
    shopId: identity.shopId,
    isSuperAdmin: identity.isSuperAdmin,
  };
}

function hasScope(identity: Identity, path: string, data: Record<string, any> = {}) {
  const parts = path.split('/');
  const isManager = identity.isSuperAdmin || managerRoles.has(identity.role);
  if (parts[0] === 'users') {
    if (parts[1] === identity.uid) return true;
    return parts.length === 2 && (identity.isSuperAdmin || isManager && Boolean(identity.shopId && data.shopId === identity.shopId));
  }
  if (parts[0] === 'roles_admin') {
    return parts[1] === identity.uid || identity.isSuperAdmin || isManager && Boolean(identity.shopId && data.shopId === identity.shopId);
  }
  if (['audit_logs', 'billing_payments'].includes(parts[0])) return identity.isSuperAdmin || isManager && Boolean(identity.shopId && data.shopId === identity.shopId);
  if (parts[0] === 'shops') return identity.isSuperAdmin || parts[1] === identity.shopId;
  return identity.isSuperAdmin || (Boolean(identity.shopId) && data.shopId === identity.shopId);
}

async function canReadRecord(identity: Identity, path: string, data: Record<string, any> = {}) {
  if (hasScope(identity, path, data)) return true;
  const parts = path.split('/');
  if (parts.length < 4 || parts.length % 2 !== 0) return false;
  const parentPath = parts.slice(0, -2).join('/');
  const parent = await store.doc(parentPath).get();
  return hasScope(identity, parentPath, parent.data() ?? {});
}

function assertCanWrite(identity: Identity, path: string, data: Record<string, any> = {}) {
  const parts = path.split('/');
  const collection = parts[0];
  if (protectedCollections.has(collection)) throw new ApiError('This record can only be changed through an authorized POS action.', 403);
  if (parts[0] === 'users' && parts[1] === identity.uid && parts[2] === 'favorites') return;
  if (collection === 'users') throw new ApiError('User profile changes can only be made through an authorized POS action.', 403);
  if (collection !== 'products') throw new ApiError('This record can only be changed through an authorized POS action.', 403);
  if (!hasScope(identity, path, data)) throw new ApiError('You do not have access to this shop data.', 403);
  if (!identity.isSuperAdmin && !managerRoles.has(identity.role)) throw new ApiError('Manager permission is required to change this record.', 403);
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.headers.get('host')) {
      return fail('Invalid request origin.', 403);
    }
    const identity = await getIdentity(request);
    const body = await request.json();
    const operation = String(body.operation ?? '');
    const path = String(body.path ?? '');

    if (operation === 'list') {
      const spec = body.query;
      if (!spec || typeof spec.path !== 'string') return fail('Invalid query.', 400);
      const target = spec.group ? store.collectionGroup(spec.path) : store.collection(spec.path);
      let query: Query = target;
      for (const filter of spec.filters ?? []) query = query.where(filter.field, filter.operator, filter.value);
      for (const sort of spec.sorts ?? []) query = query.orderBy(sort.field, sort.direction);
      if (Number.isInteger(spec.max)) query = query.limit(spec.max);
      const snapshot = await query.get();
      const accessible = [];
      for (const doc of snapshot.docs) {
        if (await canReadRecord(identity, doc.ref.path, doc.data() ?? {})) accessible.push(doc);
      }
      return NextResponse.json(accessible.map(doc => ({ path: doc.ref.path, data: doc.data() })));
    }

    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if (!path) return fail('Invalid path.', 400);
    const pathLength = path.split('/').filter(Boolean).length;
    if (operation === 'add') {
      if (pathLength % 2 === 0) return fail('Invalid collection path.', 400);
      assertCanWrite(identity, path, data);
      const ref = await store.collection(path).add(data);
      return NextResponse.json({ path: ref.path });
    }
    if (pathLength % 2 !== 0) return fail('Invalid document path.', 400);
    if (operation === 'get') {
      const snapshot = await store.doc(path).get();
      const data = snapshot.data();
      if (data && !await canReadRecord(identity, path, data)) return fail('Forbidden.', 403);
      return NextResponse.json({ path, ...(data ? { data } : {}) });
    }

    if (operation === 'delete') {
      const snapshot = await store.doc(path).get();
      assertCanWrite(identity, path, snapshot.data() ?? {});
      await store.doc(path).delete();
      return NextResponse.json({ ok: true });
    }
    const existing = (await store.doc(path).get()).data() ?? {};
    const authorizationData = path.split('/')[0] === 'users'
      ? data
      : operation === 'update' || body.merge ? { ...existing, ...data } : data;
    assertCanWrite(identity, path, authorizationData);
    if (operation === 'set') await store.doc(path).set(data, { merge: body.merge === true });
    else if (operation === 'update') await store.doc(path).update(data);
    else return fail('Unsupported operation.', 400);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database request failed.';
    if (error instanceof ApiError) return fail(message, error.status);
    if (message.includes('token')) return fail('Authentication token is invalid or expired.', 401);
    console.error('MySQL API request failed:', error);
    return fail(message, 500);
  }
}
