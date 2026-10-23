import 'server-only';

import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { getMysqlPool } from '@/lib/mysql';
import type { MysqlConnection } from '@/lib/mysql-gateway-client';

type Operator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
type Filter = { field: string; operator: Operator; value: unknown };
type Sort = { field: string; direction: 'asc' | 'desc' };
type Marker = { __mysqlType: 'timestamp' | 'server-timestamp' | 'increment' | 'delete' | 'array-union'; value?: any };

const selectPayloadSql = 'SELECT payload FROM app_records WHERE path = ?';
const selectPayloadForUpdateSql = 'SELECT payload FROM app_records WHERE path = ? FOR UPDATE';
const selectCollectionSql = 'SELECT path, payload FROM app_records WHERE collection_path = ?';
const selectCollectionForUpdateSql = 'SELECT path, payload FROM app_records WHERE collection_path = ? FOR UPDATE';
const selectCollectionGroupSql = 'SELECT path, payload FROM app_records WHERE collection_group = ?';
const selectCollectionGroupForUpdateSql = 'SELECT path, payload FROM app_records WHERE collection_group = ? FOR UPDATE';

export class Timestamp {
  private constructor(private readonly milliseconds: number) {}
  static now() { return new Timestamp(Date.now()); }
  static fromDate(value: Date) { return new Timestamp(value.getTime()); }
  static fromMillis(value: number) { return new Timestamp(value); }
  toDate() { return new Date(this.milliseconds); }
  toMillis() { return this.milliseconds; }
  toJSON(): Marker { return { __mysqlType: 'timestamp', value: this.milliseconds }; }
}

export const FieldValue = {
  increment(value: number): Marker { return { __mysqlType: 'increment', value }; },
  delete(): Marker { return { __mysqlType: 'delete' }; },
  arrayUnion(...values: unknown[]): Marker { return { __mysqlType: 'array-union', value: values as any }; },
};

function encode(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toJSON();
  if (value instanceof Date) return { __mysqlType: 'timestamp', value: value.getTime() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

function decode(value: unknown): any {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const marker = value as Marker;
    if (marker.__mysqlType === 'timestamp' && typeof marker.value === 'number') return Timestamp.fromMillis(marker.value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}

function pathParts(path: string, kind: 'document' | 'collection') {
  const parts = path.split('/').filter(Boolean);
  if ((parts.length % 2 === 0) !== (kind === 'document')) throw new Error(`Invalid ${kind} path: ${path}`);
  return parts;
}

function valueAtPath(value: any, field: string): any {
  return field.split('.').reduce((current, key) => current?.[key], value);
}

function matches(value: any, filter: Filter): boolean {
  const actual = valueAtPath(value, filter.field);
  const decoded = decode(filter.value);
  const normalize = (item: any) => item instanceof Timestamp ? item.toMillis() : item;
  const expected = Array.isArray(decoded) ? decoded.map(normalize) : normalize(decoded);
  const comparable = Array.isArray(actual) ? actual.map(normalize) : normalize(actual);
  switch (filter.operator) {
    case '==': return comparable === expected;
    case '!=': return comparable !== expected;
    case '<': return comparable < (expected as any);
    case '<=': return comparable <= (expected as any);
    case '>': return comparable > (expected as any);
    case '>=': return comparable >= (expected as any);
    case 'in': return Array.isArray(expected) && expected.includes(comparable);
    case 'array-contains': return Array.isArray(comparable) && comparable.includes(expected);
  }
}

type QueryOptions = { collectionPath: string; collectionGroup?: string; filters: Filter[]; sorts: Sort[]; max?: number };

export class DocumentSnapshot<T = Record<string, any>> {
  readonly id: string;
  readonly ref: DocumentReference;
  readonly exists: boolean;
  constructor(ref: DocumentReference, private readonly payload?: T) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = payload !== undefined;
  }
  data(): any { return this.payload === undefined ? undefined : decode(this.payload) as T; }
}

export class QuerySnapshot<T = Record<string, any>> {
  readonly docs: DocumentSnapshot<T>[];
  readonly size: number;
  readonly empty: boolean;
  constructor(docs: DocumentSnapshot<T>[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback: (snapshot: DocumentSnapshot<T>) => void) { this.docs.forEach(callback); }
}

export class DocumentReference {
  readonly id: string;
  constructor(readonly path: string) {
    const parts = pathParts(path, 'document');
    this.id = parts[parts.length - 1];
  }
  collection(name: string) { return new CollectionReference(`${this.path}/${name}`); }
  async get() { return readDocument(this.path); }
  async set(data: any, options?: { merge?: boolean }) { await writeDocument(this.path, data, 'set', options?.merge); }
  async create(data: any) { await writeDocument(this.path, data, 'create'); }
  async update(data: any) { await writeDocument(this.path, data, 'update'); }
  async delete() { await deleteDocument(this.path); }
}

export class Query {
  constructor(readonly options: QueryOptions) {}
  where(field: string, operator: Operator, value: unknown) { return new Query({ ...this.options, filters: [...this.options.filters, { field, operator, value }] }); }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') { return new Query({ ...this.options, sorts: [...this.options.sorts, { field, direction }] }); }
  limit(max: number) { return new Query({ ...this.options, max }); }
  async get() { return readQuery(this.options); }
}

export class CollectionReference extends Query {
  readonly path: string;
  constructor(path: string) {
    pathParts(path, 'collection');
    super({ collectionPath: path, filters: [], sorts: [] });
    this.path = path;
  }
  doc(id: string = randomUUID()) { return new DocumentReference(`${this.path}/${id}`); }
  async add(data: any) {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

type Write = { path: string; type: 'set' | 'create' | 'update' | 'delete'; data?: any; merge?: boolean };

export class WriteBatch {
  private writes: Write[] = [];
  set(ref: DocumentReference, data: any, options?: { merge?: boolean }) { this.writes.push({ path: ref.path, type: 'set', data, merge: options?.merge }); return this; }
  create(ref: DocumentReference, data: any) { this.writes.push({ path: ref.path, type: 'create', data }); return this; }
  update(ref: DocumentReference, data: any) { this.writes.push({ path: ref.path, type: 'update', data }); return this; }
  delete(ref: DocumentReference) { this.writes.push({ path: ref.path, type: 'delete' }); return this; }
  async commit() {
    const connection = await getMysqlPool().getConnection();
    try {
      await connection.beginTransaction();
      for (const write of this.writes) await applyWrite(connection, write);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export class Transaction {
  private writes: Write[] = [];
  async get(ref: DocumentReference): Promise<DocumentSnapshot>;
  async get(ref: Query): Promise<QuerySnapshot>;
  async get(ref: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
    if (ref instanceof Query) return readQuery(ref.options, this.connection, true);
    const snapshot = await readDocument(ref.path, this.connection, true);
    return snapshot;
  }
  constructor(private readonly connection: MysqlConnection) {}
  set(ref: DocumentReference, data: any, options?: { merge?: boolean }) { this.writes.push({ path: ref.path, type: 'set', data, merge: options?.merge }); return this; }
  create(ref: DocumentReference, data: any) { this.writes.push({ path: ref.path, type: 'create', data }); return this; }
  update(ref: DocumentReference, data: any) { this.writes.push({ path: ref.path, type: 'update', data }); return this; }
  delete(ref: DocumentReference) { this.writes.push({ path: ref.path, type: 'delete' }); return this; }
  async commit() { for (const write of this.writes) await applyWrite(this.connection, write); }
}

export class MysqlStore {
  collection(path: string) { return new CollectionReference(path); }
  collectionGroup(name: string) { return new Query({ collectionPath: '', collectionGroup: name, filters: [], sorts: [] }); }
  doc(path: string) { return new DocumentReference(path); }
  batch() { return new WriteBatch(); }
  async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    const connection = await getMysqlPool().getConnection();
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await connection.beginTransaction();
          const transaction = new Transaction(connection);
          const result = await callback(transaction);
          await transaction.commit();
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          const code = error instanceof Error && 'code' in error ? error.code : undefined;
          if (attempt < 2 && (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT')) continue;
          throw error;
        }
      }
    } finally {
      connection.release();
    }
  }
}

async function selectDoc(path: string, executor: Pick<MysqlConnection, 'execute'>, lock = false) {
  const payload = await selectRawDoc(path, executor, lock);
  return payload === undefined ? undefined : decode(payload);
}

async function selectRawDoc(path: string, executor: Pick<MysqlConnection, 'execute'>, lock = false) {
  const [rows] = await executor.execute<(RowDataPacket & { payload: string | object })[]>(
    lock ? selectPayloadForUpdateSql : selectPayloadSql, [path],
  );
  if (!rows.length) return undefined;
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
}

async function readDocument(path: string, connection?: MysqlConnection, lock = false): Promise<DocumentSnapshot> {
  const ref = new DocumentReference(path);
  const payload = await selectRawDoc(path, connection ?? getMysqlPool(), lock);
  return new DocumentSnapshot(ref, payload);
}

async function readQuery(options: QueryOptions, connection?: MysqlConnection, lock = false): Promise<QuerySnapshot> {
  const executor = connection ?? getMysqlPool();
  const [rows] = await executor.execute<(RowDataPacket & { path: string; payload: string | object })[]>(
    options.collectionGroup
      ? lock ? selectCollectionGroupForUpdateSql : selectCollectionGroupSql
      : lock ? selectCollectionForUpdateSql : selectCollectionSql,
    [options.collectionGroup ?? options.collectionPath],
  );
  let docs = rows.map(row => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return { path: row.path, payload, data: decode(payload) };
  }).filter(item => options.filters.every(filter => matches(item.data, filter)));
  for (const sort of [...options.sorts].reverse()) {
    docs = docs.sort((a, b) => {
      const left = valueAtPath(a.data, sort.field);
      const right = valueAtPath(b.data, sort.field);
      const leftValue = left instanceof Timestamp ? left.toMillis() : left;
      const rightValue = right instanceof Timestamp ? right.toMillis() : right;
      return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * (sort.direction === 'desc' ? -1 : 1);
    });
  }
  if (options.max !== undefined) docs = docs.slice(0, options.max);
  return new QuerySnapshot(docs.map(item => new DocumentSnapshot(new DocumentReference(item.path), item.payload)));
}

async function applyWrite(connection: MysqlConnection, write: Write) {
  const parts = pathParts(write.path, 'document');
  const collectionPath = parts.slice(0, -1).join('/');
  const docId = parts[parts.length - 1];
  if (write.type === 'delete') {
    await connection.execute('DELETE FROM app_records WHERE path = ?', [write.path]);
    return;
  }

  const previous = write.type === 'set' && !write.merge
    ? undefined
    : await selectDoc(write.path, connection, true);
  if (write.type === 'create' && previous !== undefined) throw new Error(`Document already exists: ${write.path}`);
  if (write.type === 'update' && previous === undefined) throw new Error(`Document does not exist: ${write.path}`);
  let payload = write.type === 'set' && !write.merge ? {} : { ...(previous ?? {}) };
  const incoming = encode(write.data) as Record<string, any>;
  for (const [key, value] of Object.entries(incoming)) {
    const marker = value as Marker;
    const parts = key.split('.');
    let parent = payload;
    for (const part of parts.slice(0, -1)) {
      parent[part] = parent[part] && typeof parent[part] === 'object' ? parent[part] : {};
      parent = parent[part];
    }
    const field = parts[parts.length - 1];
    if (marker?.__mysqlType === 'delete') {
      delete parent[field];
    } else if (marker?.__mysqlType === 'increment') {
      parent[field] = Number(parent[field] ?? 0) + Number(marker.value ?? 0);
    } else if (marker?.__mysqlType === 'array-union') {
      const current = Array.isArray(parent[field]) ? parent[field] : [];
      const additions = Array.isArray(marker.value) ? marker.value : [];
      parent[field] = [...current, ...additions.filter((item: unknown) =>
        !current.some((existing: unknown) => JSON.stringify(existing) === JSON.stringify(item)),
      )];
    } else if (marker?.__mysqlType === 'server-timestamp') {
      parent[field] = { __mysqlType: 'timestamp', value: Date.now() };
    } else {
      parent[field] = value;
    }
  }
  const encoded = JSON.stringify(payload);
  const values = [write.path, collectionPath, parts[parts.length - 2], docId, encoded];
  if (write.type === 'create') {
    await connection.execute(
      'INSERT INTO app_records (path, collection_path, collection_group, doc_id, payload) VALUES (?, ?, ?, ?, ?)',
      values,
    );
  } else {
    await connection.execute(
      `INSERT INTO app_records (path, collection_path, collection_group, doc_id, payload)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      values,
    );
  }
}

async function writeDocument(path: string, data: any, type: Write['type'], merge?: boolean) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await applyWrite(connection, { path, type, data, merge });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteDocument(path: string) {
  await getMysqlPool().execute('DELETE FROM app_records WHERE path = ?', [path]);
}
