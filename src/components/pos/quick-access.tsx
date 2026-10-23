'use client';

import { useMysql, useCollection, useAuth } from '@/auth';
import { collection, query } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { Favorite } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { removeFavoriteAction } from '@/app/actions/advanced-pos-actions';
import { useState } from 'react';

interface QuickAccessProps {
  onAddToCart: (productId: string, productName: string) => void;
}

export function QuickAccess({ onAddToCart }: QuickAccessProps) {
  const mysql = useMysql();
  const auth = useAuth();
  const { toast } = useToast();
  const [removing, setRemoving] = useState<string | null>(null);

  const favoritesQuery = useMemoMysql(
    () =>
      mysql && auth?.currentUser
        ? query(collection(mysql, `users/${auth.currentUser.uid}/favorites`))
        : null,
    [mysql, auth?.currentUser]
  );

  const { data: favorites, isLoading } = useCollection<Favorite>(favoritesQuery);

  const handleRemoveFavorite = async (productId: string) => {
    if (!auth?.currentUser) return;
    setRemoving(productId);
    try {
      const sessionProof = await auth.currentUser.getSessionProof();
      const result = await removeFavoriteAction({ sessionProof, productId });
      if (!result.success) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setRemoving(null);
    }
  };

  if (!favorites || favorites.length === 0) {
    return (
      <Card className="opacity-50">
        <CardHeader>
          <CardTitle className="text-sm">Quick Favorites</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">No favorites yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Star className="h-4 w-4 fill-yellow-400" />
          Quick Favorites
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-32">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-2 pr-4">
              {favorites.map((fav) => (
                <div
                  key={fav.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 text-xs"
                >
                  <button
                    onClick={() => onAddToCart(fav.productId, fav.productName)}
                    className="flex-1 text-left hover:underline truncate font-medium"
                  >
                    {fav.productName}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleRemoveFavorite(fav.productId)}
                    disabled={removing === fav.productId}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
