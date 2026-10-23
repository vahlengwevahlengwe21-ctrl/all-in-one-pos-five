'use client';

import { useEffect, useState } from 'react';
import { Store, RotateCcw, Copy, Loader2 } from 'lucide-react';
import { useAuth, useUser } from '@/auth';
import { useToast } from '@/hooks/use-toast';
import {
  createShopAction,
  listDeviceSeatsAction,
  listShopsAction,
  markShopPaidAction,
  resetDeviceAction,
  regenerateActivationTokenAction,
  unlockShopTerminalsAction,
} from '@/app/actions/shop-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { Shop } from '@/lib/types';

type DeviceSeat = { id: string; seatNumber: number; hardwareId?: string | null; status: string; lockState?: string | null; lastOnlineAt?: number | null };

export default function ShopsPage() {
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();
  const [shops, setShops] = useState<Shop[]>([]);
  const [seats, setSeats] = useState<DeviceSeat[]>([]);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [form, setForm] = useState({ shopId: '', shopName: '', ownerEmail: '', ownerTemporaryPassword: '', maxUsersAllowed: '3', maxDevicesAllowed: '3' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activationTokens, setActivationTokens] = useState<Record<string, string>>({});

  const loadShops = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await listShopsAction({ sessionProof: await user.getSessionProof() });
      if (result.success) {
        const nextShops = result.shops as Shop[];
        setShops(nextShops);
        setActivationTokens((currentTokens) => {
          const nextTokens = { ...currentTokens };
          nextShops.forEach((shop) => {
            const tokenIsActive = shop.activationToken && (!shop.activationTokenExpiresAt || shop.activationTokenExpiresAt > Date.now());
            if (tokenIsActive) nextTokens[shop.id] = shop.activationToken || '';
            else delete nextTokens[shop.id];
          });
          return nextTokens;
        });
        const nextSelectedShop = nextShops.find((shop) => shop.id === selectedShopId) || nextShops[0];
        if (nextSelectedShop) {
          if (!selectedShopId) setSelectedShopId(nextSelectedShop.id);
        }
      } else toast({ variant: 'destructive', title: 'Unable to load shops', description: result.error });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Unable to load shops', description: error.message || 'Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadSeats = async (shopId: string) => {
    if (!user || !shopId) return;
    const result = await listDeviceSeatsAction({ shopId, sessionProof: await user.getSessionProof() });
    if (result.success) setSeats(result.seats as DeviceSeat[]);
    else toast({ variant: 'destructive', title: 'Unable to load devices', description: result.error });
  };

  useEffect(() => { loadShops(); }, [user?.uid]);
  useEffect(() => { loadSeats(selectedShopId); }, [selectedShopId, user?.uid]);
  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setIsSaving(true);
    const result = await createShopAction({
      sessionProof: await user.getSessionProof(),
      shopId: form.shopId,
      shopName: form.shopName,
      ownerEmail: form.ownerEmail,
      ownerTemporaryPassword: form.ownerTemporaryPassword,
      maxUsersAllowed: Number(form.maxUsersAllowed),
      maxDevicesAllowed: Number(form.maxDevicesAllowed),
    });
    if (result.success) {
      setActivationTokens((currentTokens) => ({ ...currentTokens, [result.shopId || '']: result.activationToken || '' }));
      setForm({ shopId: '', shopName: '', ownerEmail: '', ownerTemporaryPassword: '', maxUsersAllowed: '3', maxDevicesAllowed: '3' });
      await loadShops();
      setSelectedShopId(result.shopId || '');
      toast({ title: 'Shop created', description: `The shop owner can log in with ${form.ownerEmail} and the temporary password, then set a permanent password.` });
    } else toast({ variant: 'destructive', title: 'Shop creation failed', description: result.error });
    setIsSaving(false);
  };

  const handleReset = async (seatId: string) => {
    if (!auth?.currentUser || !window.confirm('Reset this device seat? The current computer will need to register again.')) return;
    const result = await resetDeviceAction({ seatId, sessionProof: await auth.currentUser.getSessionProof() });
    if (result.success) { await loadSeats(selectedShopId); toast({ title: 'Device seat reset' }); }
    else toast({ variant: 'destructive', title: 'Reset failed', description: result.error });
  };

  const handleUnlock = async () => {
    if (!auth?.currentUser || !selectedShopId) return;
    const result = await unlockShopTerminalsAction({ shopId: selectedShopId, sessionProof: await auth.currentUser.getSessionProof() });
    if (result.success) toast({ title: 'Shop unlocked', description: 'All recently connected terminals received a new seven-day lease.' });
    else toast({ variant: 'destructive', title: 'Shop remains locked', description: result.error });
  };

  const handleMarkPaid = async () => {
    if (!auth?.currentUser || !selectedShopId) return;
    const result = await markShopPaidAction({ shopId: selectedShopId, sessionProof: await auth.currentUser.getSessionProof() });
    if (result.success && result.billingExpiresAt) {
      await loadShops();
      toast({ title: 'Monthly payment recorded', description: `Billing is active until ${new Date(result.billingExpiresAt).toLocaleDateString()}.` });
    } else toast({ variant: 'destructive', title: 'Payment update failed', description: result.error });
  };

  const handleRegenerateToken = async () => {
    if (!auth?.currentUser || !selectedShopId) return;
    const result = await regenerateActivationTokenAction({ shopId: selectedShopId, sessionProof: await auth.currentUser.getSessionProof() });
    if (result.success) {
      setActivationTokens((currentTokens) => ({ ...currentTokens, [selectedShopId]: result.activationToken || '' }));
      toast({ title: 'Activation token generated', description: 'Use this token on the replacement PC within 24 hours.' });
    } else toast({ variant: 'destructive', title: 'Token generation failed', description: result.error });
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Shops & Devices</h1><p className="text-muted-foreground">Create tenant records and manage registered terminal seats.</p></div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader><CardTitle>Onboard Shop</CardTitle><CardDescription>The package seat count determines how many PCs may be registered. The minimum is one.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="shop-id">Shop ID</Label><Input id="shop-id" value={form.shopId} onChange={(e) => setForm({ ...form, shopId: e.target.value })} placeholder="shop-001" required /></div>
              <div className="space-y-2"><Label htmlFor="shop-name">Shop name</Label><Input id="shop-name" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} required /></div>
              <div className="space-y-2"><Label htmlFor="owner-email">Shop owner email</Label><Input id="owner-email" type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} required /></div>
              <div className="space-y-2"><Label htmlFor="owner-temporary-password">Temporary password</Label><Input id="owner-temporary-password" type="password" minLength={10} value={form.ownerTemporaryPassword} onChange={(e) => setForm({ ...form, ownerTemporaryPassword: e.target.value })} required /><p className="text-xs text-muted-foreground">Give this temporary password to the shop owner securely. They must replace it at first login.</p></div>
              <div className="space-y-2"><Label htmlFor="user-limit">User limit</Label><Input id="user-limit" type="number" min="1" max="100" value={form.maxUsersAllowed} onChange={(e) => setForm({ ...form, maxUsersAllowed: e.target.value })} required /></div>
              <div className="space-y-2"><Label htmlFor="device-limit">Package PC limit</Label><Input id="device-limit" type="number" min="1" value={form.maxDevicesAllowed} onChange={(e) => setForm({ ...form, maxDevicesAllowed: e.target.value })} required /></div>
              <Button type="submit" className="w-full" disabled={isSaving}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Shop</Button>
            </form>
            {activationTokens[selectedShopId] && <div className="mt-4 rounded-md border bg-muted p-3"><p className="text-xs text-muted-foreground">Active activation token for the selected shop. Use it on each registered shop computer before it expires:</p><div className="flex items-center gap-2"><code className="font-semibold">{activationTokens[selectedShopId]}</code><Button type="button" variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText(activationTokens[selectedShopId])} title="Copy activation token"><Copy className="h-4 w-4" /></Button></div></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />Registered Shops</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : shops.length === 0 ? <p className="text-sm text-muted-foreground">No shops onboarded yet.</p> : <select className="w-full rounded-md border bg-background p-2" value={selectedShopId} onChange={(e) => setSelectedShopId(e.target.value)}>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.shopName} ({shop.id})</option>)}</select>}
            {selectedShopId && <><Button className="w-full" onClick={handleMarkPaid}>Record monthly payment</Button><Button variant="outline" className="w-full" onClick={handleUnlock}>Unlock all shop terminals</Button><Button variant="outline" className="w-full" onClick={handleRegenerateToken}>Generate replacement-PC token</Button></>}
            {seats.map((seat) => <div key={seat.id} className="flex items-center justify-between rounded-md border p-3"><div><p className="font-medium">Device seat {seat.seatNumber}</p><p className="text-xs text-muted-foreground">{seat.hardwareId || 'Available for registration'}</p>{seat.hardwareId && <p className="text-xs">{seat.lockState === 'locked' ? 'Locked' : seat.lastOnlineAt && Date.now() - seat.lastOnlineAt < 5 * 60 * 1000 ? 'Online' : 'Offline'}</p>}</div>{seat.hardwareId ? <Button variant="outline" size="sm" onClick={() => handleReset(seat.id)}><RotateCcw className="mr-2 h-4 w-4" />Reset</Button> : <Badge variant="secondary">Available</Badge>}</div>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
