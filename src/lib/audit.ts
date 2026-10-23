import type { MysqlStore } from '@/lib/mysql-store';
import { Timestamp } from '@/lib/mysql-store';

type AuditEvent = {
  action: string;
  actorId: string;
  actorName?: string | null;
  shopId?: string | null;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
};

export async function writeAuditEvent(mysql: MysqlStore, event: AuditEvent) {
  await mysql.collection('audit_logs').add({
    ...event,
    createdAt: Timestamp.now(),
  });
}
