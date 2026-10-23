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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { validatePromoCodeAction } from '@/app/actions/advanced-pos-actions';
import { useAuth } from '@/auth';
import { Loader2, Tag, Percent, DollarSign } from 'lucide-react';

interface DiscountApplierProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  onApplyDiscount: (discount: {
    type: 'percentage' | 'fixed' | 'bulk';
    value: number;
    description: string;
    appliedAmount: number;
    promoCode?: string;
  }) => void;
}

export function DiscountApplier({
  open,
  onOpenChange,
  subtotal,
  onApplyDiscount,
}: DiscountApplierProps) {
  const auth = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [percentageValue, setPercentageValue] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [promoCode, setPromoCode] = useState('');

  const handleApplyPercentage = () => {
    const percent = parseFloat(percentageValue) || 0;
    if (percent <= 0 || percent > 100) {
      toast({ variant: 'destructive', title: 'Invalid percentage' });
      return;
    }
    const discountAmount = (subtotal * percent) / 100;
    onApplyDiscount({
      type: 'percentage',
      value: percent,
      description: `${percent}% off`,
      appliedAmount: discountAmount,
    });
    setPercentageValue('');
    onOpenChange(false);
  };

  const handleApplyFixed = () => {
    const amount = parseFloat(fixedAmount) || 0;
    if (amount <= 0 || amount > subtotal) {
      toast({ variant: 'destructive', title: 'Invalid discount amount' });
      return;
    }
    onApplyDiscount({
      type: 'fixed',
      value: amount,
      description: `R${amount.toFixed(2)} off`,
      appliedAmount: amount,
    });
    setFixedAmount('');
    onOpenChange(false);
  };

  const handleApplyPromoCode = async () => {
    if (!auth?.currentUser || !promoCode.trim()) {
      toast({ variant: 'destructive', title: 'Invalid promo code' });
      return;
    }

    setIsLoading(true);
    try {
      const sessionProof = await auth.currentUser.getSessionProof();
      const result = await validatePromoCodeAction({
        sessionProof,
        promoCode: promoCode.trim(),
        subtotal,
      });

      if (result.success && result.discount) {
        onApplyDiscount({
          type: result.discount.type,
          value: result.discount.value,
          description: result.discount.name,
          appliedAmount: result.discount.discountAmount,
          promoCode: promoCode.trim(),
        });
        toast({
          title: 'Discount Applied',
          description: `Saved R${result.discount.discountAmount.toFixed(2)}`,
        });
        setPromoCode('');
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
          <DialogTitle>Apply Discount</DialogTitle>
          <DialogDescription>
            Subtotal: <span className="font-semibold">R{subtotal.toFixed(2)}</span>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="percentage" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="percentage">
              <Percent className="h-4 w-4 mr-1" />
              %
            </TabsTrigger>
            <TabsTrigger value="fixed">
              <DollarSign className="h-4 w-4 mr-1" />
              Fixed
            </TabsTrigger>
            <TabsTrigger value="promo">
              <Tag className="h-4 w-4 mr-1" />
              Promo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="percentage" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Discount Percentage</label>
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="Enter percentage (0-100)"
                value={percentageValue}
                onChange={(e) => setPercentageValue(e.target.value)}
              />
              {percentageValue && (
                <div className="text-xs text-muted-foreground mt-2">
                  Discount: R{((subtotal * parseFloat(percentageValue)) / 100).toFixed(2)}
                </div>
              )}
            </div>
            <Button onClick={handleApplyPercentage} className="w-full">
              Apply
            </Button>
          </TabsContent>

          <TabsContent value="fixed" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Fixed Amount (R)</label>
              <Input
                type="number"
                min="0"
                max={subtotal}
                placeholder="Enter amount"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
              />
              <div className="text-xs text-muted-foreground mt-2">
                Max: R{subtotal.toFixed(2)}
              </div>
            </div>
            <Button onClick={handleApplyFixed} className="w-full">
              Apply
            </Button>
          </TabsContent>

          <TabsContent value="promo" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Promo Code</label>
              <Input
                placeholder="Enter promo code"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                disabled={isLoading}
              />
            </div>
            <Button
              onClick={handleApplyPromoCode}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Validate & Apply
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
