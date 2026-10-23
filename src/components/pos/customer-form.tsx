'use client';

import { useState } from 'react';
import { useAuth } from '@/auth';
import { createCustomerAction } from '@/app/actions/advanced-pos-actions';
import type { Customer } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: Customer) => void;
}

export function CustomerForm({ open, onOpenChange, onCreated }: CustomerFormProps) {
  const auth = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setNotes('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth?.currentUser || !name.trim()) return;

    setIsSaving(true);
    try {
      const result = await createCustomerAction({
        sessionProof: await auth.currentUser.getSessionProof(),
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (!result.success || !result.customerId) throw new Error(result.error || 'Unable to create customer.');

      onCreated({
        id: result.customerId,
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        loyaltyPoints: 0,
        totalSpent: 0,
        visitCount: 0,
        createdAt: new Date(),
      });
      reset();
      onOpenChange(false);
      toast({ title: 'Customer Created', description: `${name.trim()} is attached to this sale.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Unable to create customer', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
          <DialogDescription>Add a customer profile to this sale.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Name</Label>
            <Input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer-phone">Phone</Label>
              <Input id="customer-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-email">Email</Label>
              <Input id="customer-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-address">Address</Label>
            <Input id="customer-address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-notes">Notes</Label>
            <Textarea id="customer-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !name.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
