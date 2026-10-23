'use client';

export type DocumentData = Record<string, any>;
export type SetOptions = { merge?: boolean };
export type MySQLClient = Record<string, never>;

export class Timestamp {
  private constructor(private readonly milliseconds: number) {}
  static now() { return new Timestamp(Date.now()); }
  static fromDate(value: Date) { return new Timestamp(value.getTime()); }
  static fromMillis(value: number) { return new Timestamp(value); }
  toDate() { return new Date(this.milliseconds); }
  toMillis() { return this.milliseconds; }
  toJSON() { return { __mysqlType: 'timestamp', value: this.milliseconds }; }
}

export const serverTimestamp = () => ({ __mysqlType: 'server-timestamp' });
export const increment = (value: number) => ({ __mysqlType: 'increment', value });
export const deleteField = () => ({ __mysqlType: 'delete' });

function revive(value: any): any {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    if (value.__mysqlType === 'timestamp' && typeof value.value === 'number') return Timestamp.fromMillis(value.value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]));
  }
  return value;
}

function prepare(value: unknown): unknown {
  if (value instanceof Date) return { __mysqlType: 'timestamp', value: value.getTime() };
  if (Array.isArray(value)) return value.map(prepare);
  if (value && typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') return prepare(value.toJSON());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prepare(item)]));
  }
  return value;
}

type Filter = { field: string; operator: string; value: unknown };
type Sort = { field: string; direction: 'asc' | 'desc' };
type QuerySpec = { path: string; group?: boolean; filters: Filter[]; sorts: Sort[]; max?: number };

export class DocumentReference<T = DocumentData> {
  declare readonly __documentType?: T;
  readonly type = 'document';
  readonly id: string;
  constructor(readonly path: string) { this.id = path.split('/').pop()!; }
  collection(name: string) { return new CollectionReference(`${this.path}/${name}`); }
}

export class Query<T = DocumentData> {
  declare readonly __queryType?: T;
  readonly type: string = 'query';
  constructor(readonly querySpec: QuerySpec) {}
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  override readonly type = 'collection';
  readonly id: string;
  readonly path: string;
  constructor(path: string, querySpec: QuerySpec = { path, filters: [], sorts: [] }) {
    super(querySpec);
    this.path = path;
    this.id = path.split('/').pop()!;
  }
  doc(id = crypto.randomUUID()) { return new DocumentReference<T>(`${this.path}/${id}`); }
}

export function collection(db: unknown, path: string, ...segments: string[]): CollectionReference {
  const base = db instanceof DocumentReference ? db.path : String(path);
  const parts = db instanceof DocumentReference ? [path, ...segments] : segments;
  return new CollectionReference([base, ...parts].filter(Boolean).join('/'));
}
export function doc(db: unknown, path?: string, ...segments: string[]): DocumentReference {
  if (db instanceof CollectionReference) return db.doc([path, ...segments].filter(Boolean).join('/') || crypto.randomUUID());
  if (db instanceof DocumentReference) return new DocumentReference([db.path, path, ...segments].filter(Boolean).join('/'));
  return new DocumentReference([path, ...segments].filter(Boolean).join('/'));
}
export function collectionGroup(_db: unknown, group: string): Query {
  return new Query({ path: group, group: true, filters: [], sorts: [] });
}
export function query(ref: CollectionReference | Query, ...constraints: Array<Filter | Sort | { max: number }>): Query {
  const querySpec = { ...ref.querySpec };
  for (const constraint of constraints) {
    if ('field' in constraint && 'operator' in constraint) querySpec.filters = [...querySpec.filters, constraint as Filter];
    else if ('field' in constraint) querySpec.sorts = [...querySpec.sorts, constraint as Sort];
    else querySpec.max = constraint.max;
  }
  return new Query(querySpec);
}
export function where(field: string, operator: string, value: unknown): Filter { return { field, operator, value }; }
export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Sort { return { field, direction }; }
export function limit(max: number) { return { max }; }

export class DocumentSnapshot<T = DocumentData> {
  readonly id: string;
  readonly exists: () => boolean;
  constructor(readonly ref: DocumentReference<T>, private readonly payload?: T) {
    this.id = ref.id;
    this.exists = () => payload !== undefined;
  }
  data() { return this.payload; }
}
export class QuerySnapshot<T = DocumentData> {
  readonly size: number;
  readonly empty: boolean;
  constructor(readonly docs: DocumentSnapshot<T>[]) {
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback: (snapshot: DocumentSnapshot<T>) => void) { this.docs.forEach(callback); }
}

type Target = CollectionReference | Query | DocumentReference;

async function request<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch('/api/db', {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'same-origin',
    ...(body ? { body: JSON.stringify(prepare(body)) } : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `MySQL request failed (${response.status}).`);
  }
  return response.json();
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const value = await request<{ path: string; data?: DocumentData }>('POST', { operation: 'get', path: ref.path });
  return new DocumentSnapshot(ref, revive(value.data));
}
export async function getDocs(target: CollectionReference | Query): Promise<QuerySnapshot> {
  const result = await request<Array<{ path: string; data: DocumentData }>>('POST', { operation: 'list', query: target.querySpec });
  return new QuerySnapshot(result.map(item => new DocumentSnapshot(new DocumentReference(item.path), revive(item.data))));
}
export async function setDoc(ref: DocumentReference, data: DocumentData, options?: SetOptions) {
  await request('POST', { operation: 'set', path: ref.path, data, merge: options?.merge });
}
export async function addDoc(ref: CollectionReference, data: DocumentData): Promise<DocumentReference> {
  const result = await request<{ path: string }>('POST', { operation: 'add', path: ref.path, data });
  return new DocumentReference(result.path);
}
export async function updateDoc(ref: DocumentReference, data: DocumentData) {
  await request('POST', { operation: 'update', path: ref.path, data });
}
export async function deleteDoc(ref: DocumentReference) {
  await request('POST', { operation: 'delete', path: ref.path });
}
export function onSnapshot(target: Target, next: (snapshot: any) => void, error?: (error: Error) => void) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const refresh = async () => {
    try {
      if (target instanceof DocumentReference) next(await getDoc(target));
      else next(await getDocs(target));
    } catch (cause) {
      error?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
    if (!cancelled) timer = setTimeout(refresh, 5000);
  };
  void refresh();
  return () => { cancelled = true; clearTimeout(timer); };
}
