export type DatabasePermissionContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: unknown;
};

export class DatabasePermissionError extends Error {
  constructor(readonly request: DatabasePermissionContext) {
    super(`MySQL request was denied: ${JSON.stringify(request)}`);
    this.name = 'DatabasePermissionError';
  }
}
