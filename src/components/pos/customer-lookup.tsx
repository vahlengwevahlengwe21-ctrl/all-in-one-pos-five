'use client';

import { useState, useMemo } from 'react';
import { useMysql, useCollection, useDoc, useUser } from '@/auth';
import { collection, query, where, doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { Customer, UserProfile } from '@/lib/types';
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface CustomerLookupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCustomer: (customer: Customer) => void;
  onCreateNew: () => void;
}

export function CustomerLookup({
  open,
  onOpenChange,
  onSelectCustomer,
  onCreateNew,
}: CustomerLookupProps) {
  const mysql = useMysql();
  const { user } = useUser();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const [searchTerm, setSearchTerm] = useState('');

  const customersQuery = useMemoMysql(
    () =>
      mysql
        ? profile?.shopId
          ? query(collection(mysql, 'customers'), where('shopId', '==', profile.shopId))
          : query(collection(mysql, 'customers'))
        : null,
    [mysql, profile?.shopId]
  );

  const { data: allCustomers, isLoading } = useCollection<Customer>(customersQuery);

  const filteredCustomers = useMemo(() => {
    if (!allCustomers) return [];
    const term = searchTerm.toLowerCase();
    return allCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.phone?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term)
    );
  }, [allCustomers, searchTerm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Customer</DialogTitle>
          <DialogDescription>
            Search by name, phone, or email
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>

          <ScrollArea className="h-96 border rounded-md">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No customers found
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => {
                      onSelectCustomer(customer);
                      onOpenChange(false);
                    }}
                    className="w-full text-left p-3 rounded-md hover:bg-accent border transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{customer.name}</div>
                        {customer.phone && (
                          <div className="text-xs text-muted-foreground">
                            📞 {customer.phone}
                          </div>
                        )}
                        {customer.email && (
                          <div className="text-xs text-muted-foreground">
                            📧 {customer.email}
                          </div>
                        )}
                      </div>
                      {customer.loyaltyPoints ? (
                        <Badge variant="secondary" className="ml-2">
                          {customer.loyaltyPoints} pts
                        </Badge>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
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
            onClick={() => {
              onOpenChange(false);
              onCreateNew();
            }}
            className="flex-1"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
