import type {
  FieldPacket,
  QueryResult,
  RowDataPacket,
} from 'mysql2/promise';

export interface MysqlConnection {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, values?: any[]): Promise<[T, FieldPacket[]]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface MysqlPool {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, values?: any[]): Promise<[T, FieldPacket[]]>;
  getConnection(): Promise<MysqlConnection>;
}

type GatewayErrorBody = { error?: string; code?: string };

function serialize(value: unknown): unknown {
  if (value instanceof Date) {
    const date = value.toISOString();
    return `${date.slice(0, 10)} ${date.slice(11, 23)}`;
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

class GatewayRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function send<T>(url: string, token: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(serialize(body)) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Database gateway request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = await response.json().catch(() => ({})) as GatewayErrorBody & T;
  if (!response.ok) {
    throw new GatewayRequestError(
      result.error || `Database gateway request failed (${response.status}).`,
      result.code,
    );
  }
  return result;
}

class GatewayConnection implements MysqlConnection {
  private transactionId?: string;
  private released = false;

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async execute<T extends QueryResult = RowDataPacket[]>(sql: string, values: any[] = []): Promise<[T, FieldPacket[]]> {
    this.assertActive();
    const result = this.transactionId
      ? await send<{ result: T }>(`${this.baseUrl}/pos/transactions/${this.transactionId}/execute`, this.token, { sql, values })
      : await send<{ result: T }>(`${this.baseUrl}/pos/execute`, this.token, { sql, values });
    return [result.result, []];
  }

  async beginTransaction() {
    this.assertActive();
    if (this.transactionId) throw new Error('A database transaction is already active.');
    const result = await send<{ transactionId: string }>(`${this.baseUrl}/pos/transactions`, this.token, {});
    this.transactionId = result.transactionId;
  }

  async commit() {
    this.assertActive();
    if (!this.transactionId) throw new Error('No database transaction is active.');
    await send(`${this.baseUrl}/pos/transactions/${this.transactionId}/commit`, this.token, {});
    this.transactionId = undefined;
  }

  async rollback() {
    this.assertActive();
    if (!this.transactionId) return;
    await send(`${this.baseUrl}/pos/transactions/${this.transactionId}/rollback`, this.token, {});
    this.transactionId = undefined;
  }

  release() {
    this.released = true;
    if (this.transactionId) {
      const transactionId = this.transactionId;
      this.transactionId = undefined;
      void send(`${this.baseUrl}/pos/transactions/${transactionId}/rollback`, this.token, {})
        .catch(error => console.error('Failed to roll back released database gateway transaction:', error));
    }
  }

  private assertActive() {
    if (this.released) throw new Error('Database gateway connection has been released.');
  }
}

class GatewayPool implements MysqlPool {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async execute<T extends QueryResult = RowDataPacket[]>(sql: string, values: any[] = []): Promise<[T, FieldPacket[]]> {
    const result = await send<{ result: T }>(`${this.baseUrl}/pos/execute`, this.token, { sql, values });
    return [result.result, []];
  }

  async getConnection() {
    return new GatewayConnection(this.baseUrl, this.token);
  }
}

export function createGatewayPool(url: string, token: string): MysqlPool {
  const parsed = new URL(url);
  if (
    (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !token
  ) {
    throw new Error('DB_GATEWAY_URL must be a trusted HTTPS URL and DB_GATEWAY_TOKEN must be configured.');
  }
  return new GatewayPool(parsed.toString().replace(/\/$/, ''), token);
}
