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
import { X, Plus } from 'lucide-react';
import type { Payment } from '@/lib/types';

interface SplitPaymentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalAmount: number;
  onApplyPayments: (payments: Payment[]) => void;
}

export function SplitPayment({
  open,
  onOpenChange,
  totalAmount,
  onApplyPayments,
}: SplitPaymentProps) {
  const [payments, setPayments] = useState<Payment[]>([
    { method: 'cash', amount: totalAmount },
  ]);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = totalAmount - totalPaid;
  const isComplete = Math.abs(remaining) < 0.01;

  const addPaymentMethod = () => {
    setPayments([...payments, { method: 'card', amount: 0 }]);
  };

  const removePaymentMethod = (index: number) => {
    if (payments.length > 1) {
      setPayments(payments.filter((_, i) => i !== index));
    }
  };

  const updatePaymentAmount = (index: number, amount: number) => {
    const updated = [...payments];
    updated[index].amount = Math.max(0, Math.min(amount, totalAmount));
    setPayments(updated);
  };

  const updatePaymentReference = (index: number, reference: string) => {
    const updated = [...payments];
    updated[index].reference = reference;
    setPayments(updated);
  };

  const updatePaymentMethod = (
    index: number,
    method: 'cash' | 'card' | 'credit' | 'giftcard'
  ) => {
    const updated = [...payments];
    updated[index].method = method;
    setPayments(updated);
  };

  const handleApply = () => {
    if (isComplete) {
      onApplyPayments(payments);
      onOpenChange(false);
      setPayments([{ method: 'cash', amount: totalAmount }]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Split Payment</DialogTitle>
          <DialogDescription>
            Total Amount: <span className="font-semibold">R{totalAmount.toFixed(2)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {payments.map((payment, index) => (
            <div key={index} className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <select
                  value={payment.method}
                  onChange={(e) =>
                    updatePaymentMethod(
                      index,
                      e.target.value as 'cash' | 'card' | 'credit' | 'giftcard'
                    )
                  }
                  className="w-full h-9 px-3 rounded-md border text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="credit">Store Credit</option>
                  <option value="giftcard">Gift Card</option>
                </select>
                <Input
                  type="number"
                  value={payment.amount || ''}
                  onChange={(e) => updatePaymentAmount(index, parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  min="0"
                  className="text-right"
                />
                {payment.method === 'card' && <Input value={payment.reference || ''} onChange={(event) => updatePaymentReference(index, event.target.value)} placeholder="Card approval reference" />}
              </div>
              {payments.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removePaymentMethod(index)}
                  className="text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={addPaymentMethod}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Payment Method
          </Button>

          <Card className="p-3 bg-muted">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="font-semibold">R{totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Paid:</span>
                <span className="font-semibold">R{totalPaid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Remaining:</span>
                <span
                  className={
                    remaining < 0
                      ? 'font-semibold text-green-600'
                      : 'font-semibold text-destructive'
                  }
                >
                  R{remaining.toFixed(2)}
                </span>
              </div>
            </div>
          </Card>

          {remaining !== 0 && (
            <div className="text-xs text-muted-foreground text-center">
              {remaining > 0
                ? `Remaining: R${remaining.toFixed(2)}`
                : `Overpaid: R${Math.abs(remaining).toFixed(2)}`}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!isComplete}
            className="flex-1"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
