import { BookOpenCheck, Cloud, LockKeyhole, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const safeguards = [
  { icon: LockKeyhole, title: 'Protected access', text: 'MySQL authentication and shop-scoped permissions keep each shop separated from every other shop.' },
  { icon: MonitorSmartphone, title: 'Registered terminals', text: 'Electron terminals use a local activation record and server verification before opening the POS.' },
  { icon: Cloud, title: 'Cloud plus offline continuity', text: 'Online sales sync to the cloud. The desktop shell can queue an offline sale for later synchronization.' },
  { icon: ShieldCheck, title: 'Account controls', text: 'Billing status, device seats, audit events, and shop administration are controlled from protected server actions.' },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="border-b pb-6"><p className="text-sm font-medium text-primary">All In One POS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">A clearer way to run an independent shop</h1><p className="mt-2 max-w-2xl text-muted-foreground">Built for daily checkout, stock control, supplier decisions, cash-up, and practical reporting. The system keeps the important information close to the people making the decisions.</p></div>
      <div className="grid gap-4 md:grid-cols-2">{safeguards.map(({ icon: Icon, title, text }) => <Card key={title}><CardHeader><Icon className="h-5 w-5 text-primary" /><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">{text}</p></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle>What the platform brings together</CardTitle><CardDescription>One operational picture for the owner and the counter team.</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><div><p className="font-medium">At the counter</p><p className="mt-1 leading-6 text-muted-foreground">Fast scanning, cash and card recording, split payments, customer records, receipts, held sales, discounts, and store credit.</p></div><div><p className="font-medium">Behind the counter</p><p className="mt-1 leading-6 text-muted-foreground">Grouped reports, sizes and pack formats, cost and margin visibility, low-stock actions, cash-up, audit history, and terminal administration.</p></div></CardContent></Card>
      <Card><CardHeader><CardTitle>How the system protects the shop</CardTitle><CardDescription>Security controls are designed to make important actions visible and accountable.</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-3"><div><p className="font-medium">Access</p><p className="mt-1 leading-6 text-muted-foreground">Role-based access and shop-scoped records.</p></div><div><p className="font-medium">Continuity</p><p className="mt-1 leading-6 text-muted-foreground">Offline queueing for temporary outages and later synchronisation.</p></div><div><p className="font-medium">Oversight</p><p className="mt-1 leading-6 text-muted-foreground">Audit history, terminal seats, billing state, and security status.</p></div></CardContent></Card>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"><BookOpenCheck className="h-5 w-5 shrink-0 text-primary" /><p>Version and deployment details are managed by the system administrator. Contact your shop owner or administrator when a terminal needs activation, replacement, or billing assistance.</p></div>
    </div>
  );
}