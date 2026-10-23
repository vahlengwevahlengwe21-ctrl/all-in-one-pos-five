'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/auth';
import { validateStoreCreditAction } from '@/app/actions/advanced-pos-actions';
import { Loader2, Gift } from 'lucide-react';

interface StoreCreditRedeemerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalAmount: number;
  onRedeem: (amount: number, code: string) => void;
}

export function StoreCreditRedeemer({
  open,
  onOpenChange,
  totalAmount,
  onRedeem,
}: StoreCreditRedeemerProps) {
  const auth = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [code, setCode] = useState('');
  const [redeemAmount, setRedeemAmount] = useState(totalAmount.toString());

  const handleRedeem = async () => {
    if (!auth?.currentUser || !code.trim()) {
      toast({ variant: 'destructive', title: 'Invalid code' });
      return;
    }

    const amount = parseFloat(redeemAmount) || 0;
    if (amount <= 0 || amount > totalAmount) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }

    setIsLoading(true);
    try {
      const sessionProof = await auth.currentUser.getSessionProof();
      const result = await validateStoreCreditAction({
        sessionProof,
        code: code.trim(),
        amount,
      });

      if (result.success) {
        toast({
          title: 'Store Credit Redeemed',
          description: `R${amount.toFixed(2)} applied`,
        });
        onRedeem(amount, code.trim());
        setCode('');
        setRedeemAmount(totalAmount.toString());
        onOpenChange(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Redeem Store Credit
          </DialogTitle>
          <DialogDescription>
            Available: <span className="font-semibold">R{totalAmount.toFixed(2)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Credit Code</label>
            <Input
              placeholder="Enter code (e.g., SC-123456-ABC)"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium">Redeem Amount (R)</label>
            <Input
              type="number"
              placeholder="0.00"
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
              min="0"
              max={totalAmount}
              disabled={isLoading}
            />
            <div className="text-xs text-muted-foreground mt-1">
              Maximum: R{totalAmount.toFixed(2)}
            </div>
          </div>

          <Card className="p-3 bg-muted">
            <div className="text-sm">
              <div className="flex justify-between">
                <span>Amount to Redeem:</span>
                <span className="font-semibold">
                  R{(parseFloat(redeemAmount) || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </Card>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button onClick={handleRedeem} disabled={isLoading} className="flex-1">
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Redeem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
