'use client';

import { useEffect, useState } from 'react';
import { listAuditEventsAction } from '@/app/actions/shop-actions';
import { useUser } from '@/auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

 type AuditEvent = { id: string; action: string; actorId: string; actorName?: string | null; shopId?: string | null; entityType: string; entityId: string; details: Record<string, unknown>; createdAt?: number | null };

export function AuditLog() {
  const { user } = useUser();
  const { toast } = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const loadEvents = async () => {
    if (!user) return;
    setIsLoading(true);
    const result = await listAuditEventsAction({ sessionProof: await user.getSessionProof() });
    if (result.success) setEvents(result.events as AuditEvent[]);
    else toast({ variant: 'destructive', title: 'Unable to load audit log', description: result.error });
    setIsLoading(false);
  };

  useEffect(() => { loadEvents(); }, [user?.uid]);

  const filteredEvents = events.filter((event) => {
    const normalizedFilter = filter.trim().toLowerCase();
    return !normalizedFilter || [event.action, event.actorName, event.entityType, event.entityId].some((value) => value?.toLowerCase().includes(normalizedFilter));
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle>Audit Log</CardTitle><CardDescription>Recent sales, returns, voids, and billing events.</CardDescription></div><Button variant="outline" onClick={loadEvents} disabled={isLoading}>{isLoading ? 'Loading...' : 'Refresh'}</Button></CardHeader>
      <CardContent>
        <Input className="mb-4" placeholder="Filter by action, actor, or entity" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {isLoading ? <p className="text-sm text-muted-foreground">Loading audit events...</p> : filteredEvents.length === 0 ? <p className="text-sm text-muted-foreground">No audit events match the current filter.</p> : <div className="space-y-2">{filteredEvents.map((event) => <div key={event.id} className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[180px_1fr_180px]"><div><p className="font-medium">{event.action}</p><p className="text-xs text-muted-foreground">{event.entityType}: {event.entityId.slice(0, 12)}</p></div><div><p>{event.actorName || event.actorId}</p><p className="text-xs text-muted-foreground">{Object.entries(event.details).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></div><p className="text-xs text-muted-foreground md:text-right">{event.createdAt ? new Date(event.createdAt).toLocaleString() : 'Unknown time'}</p></div>)}</div>}
      </CardContent>
    </Card>
  );
}
