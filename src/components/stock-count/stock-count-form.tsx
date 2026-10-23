
'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useAuth, useDoc, useMysql, useUser } from '@/auth';
import { collection, query, doc, getDocs, where } from '@/lib/mysql-client';
import type { Product, UserProfile } from '@/lib/types';
import { applyStockCountAction } from '@/app/actions/advanced-pos-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useMemoMysql } from '@/auth/provider';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

const formSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      recordedCount: z.number(),
      actualCount: z.coerce.number().min(0, 'Count must be non-negative'),
      threshold: z.number(),
    })
  ),
});

type FormData = z.infer<typeof formSchema>;

type Discrepancy = {
  id: string;
  name: string;
  recordedCount: number;
  actualCount: number;
  variance: number;
};

export function StockCountForm() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [variances, setVariances] = useState<Record<string, number | null>>({});
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [comparisonDone, setComparisonDone] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);


  const { toast } = useToast();

  const mysql = useMysql();
  const auth = useAuth();
  const { user } = useUser();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      items: [],
    },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: 'items',
  });
  
  const { getValues } = form;

  useEffect(() => {
    async function fetchInitialStock() {
      if (!mysql || !profile?.shopId) return;
      setIsLoadingProducts(true);
      try {
        const productsQuery = query(collection(mysql, 'products'), where('shopId', '==', profile.shopId));
        const querySnapshot = await getDocs(productsQuery);
        const productsData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Product).filter((product) => !product.isArchived);
        
        const formItems = productsData.map((p) => ({
          id: p.id,
          name: p.name,
          recordedCount: p.stock,
          actualCount: p.stock, // Initialize with recorded count
          threshold: p.threshold,
        }));
        replace(formItems);
      } catch (error) {
        console.error("Failed to fetch initial stock:", error);
        toast({
          variant: 'destructive',
          title: 'Error fetching products',
          description: 'Could not load initial inventory data.',
        })
      } finally {
        setIsLoadingProducts(false);
      }
    }
    fetchInitialStock();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mysql, profile?.shopId, replace, toast]);


  const handleCompareStock = () => {
    const items = getValues('items');
    const newVariances: Record<string, number | null> = {};
    const foundDiscrepancies: Discrepancy[] = [];
    
    items.forEach(item => {
      const variance = item.actualCount - item.recordedCount;
      if (variance !== 0) {
        newVariances[item.id] = variance;
        foundDiscrepancies.push({ ...item, variance });
      } else {
        newVariances[item.id] = null;
      }
    });
    setVariances(newVariances);
    setDiscrepancies(foundDiscrepancies);
    setComparisonDone(true);

    if (foundDiscrepancies.length === 0) {
      toast({
        title: "No Discrepancies Found",
        description: "All physical counts match the recorded stock levels.",
      });
    } else {
      toast({
        title: "Stock Comparison Complete",
        description: `Found ${foundDiscrepancies.length} item(s) with discrepancies. Please review the report below.`
      });
    }
  };

  async function handleUpdateStock(data: FormData) {
    if (!mysql || !auth?.currentUser) return;
    setIsUpdating(true);

    const discrepantItems = data.items.filter(item => item.recordedCount !== item.actualCount);

    if (discrepantItems.length === 0 && discrepancies.length > 0) {
      // User might have corrected the counts back to the original
      toast({
        title: 'Counts Corrected',
        description: 'All counts now match the original records. No update needed.',
      });
    } else if (discrepantItems.length === 0) {
        toast({
          title: 'No Changes to Submit',
          description: 'There are no stock count discrepancies to update.',
        });
        setIsUpdating(false);
        return;
    }

    let result;
    try {
      result = await applyStockCountAction({ sessionProof: await auth.currentUser.getSessionProof(), items: discrepantItems.map((item) => ({ productId: item.id, actualCount: item.actualCount })) });
    } catch (error: any) {
      setIsUpdating(false);
      toast({ variant: 'destructive', title: 'Stock update failed', description: error.message || 'Unable to update stock.' });
      return;
    }
    if (!result.success) throw new Error('Unable to update stock.');
    const updatedCount = result.updatedCount || 0;

    toast({
      title: 'Stock Updated',
      description: `${updatedCount} product(s) have been updated with the new stock counts.`,
    });
    
    // Now, we need to refresh the "recorded" count in the UI to reflect the new state of truth
    const updatedItems = data.items.map(item => ({
      ...item,
      recordedCount: item.actualCount,
    }));
    replace(updatedItems);
    
    setIsUpdating(false);
    setVariances({}); // Reset variances after update
    setDiscrepancies([]);
    setComparisonDone(false);
  }

  if (isLoadingProducts) {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[...Array(6)].map((_, i) => (
                        <Card key={i} className="p-4 space-y-2">
                           <Skeleton className="h-5 w-2/3" />
                           <Skeleton className="h-4 w-1/3" />
                           <Skeleton className="h-10 w-full" />
                        </Card>
                    ))}
                </div>
            </CardContent>
            <CardFooter>
                 <Skeleton className="h-10 w-36" />
            </CardFooter>
        </Card>
    )
  }

  return (
    <div className="space-y-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleUpdateStock)}>
          <Card>
            <CardHeader>
              <CardTitle>Physical Stock Count</CardTitle>
              <CardDescription>
                Enter the actual physical count for each item, then click "Compare Stock" to see the differences.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((field, index) => {
                  const variance = variances[field.id];
                  
                  return (
                    <Card key={field.id} className="p-4">
                      <FormField
                        control={form.control}
                        name={`items.${index}.actualCount`}
                        render={({ field: formField }) => (
                          <FormItem>
                            <FormLabel className="font-semibold">{field.name}</FormLabel>
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>Recorded: {field.recordedCount}</span>
                              {variance != null && (
                                <span className={cn(
                                  "font-semibold",
                                  variance > 0 ? "text-green-600" : "text-destructive"
                                )}>
                                  Variance: {variance > 0 ? `+${variance}`: variance}
                                </span>
                              )}
                            </div>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="Actual count"
                                {...formField}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </Card>
                  );
                })}
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleCompareStock}>
                Compare Stock
              </Button>
              <Button type="submit" disabled={isUpdating || !comparisonDone}>
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Stock Counts'
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
      
      {comparisonDone && (
        <Card>
          <CardHeader>
            <CardTitle>Stock Comparison Report</CardTitle>
            <CardDescription>
              A summary of all discrepancies found between recorded and physical counts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {discrepancies.length === 0 ? (
               <Alert>
                <AlertTitle>No Discrepancies</AlertTitle>
                <AlertDescription>
                  All physical stock counts match the recorded inventory levels. No action is needed.
                </AlertDescription>
              </Alert>
            ) : (
                <div className="space-y-4">
                   <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 font-medium text-muted-foreground px-4">
                    <div>Product Name</div>
                    <div className="text-center">Recorded</div>
                    <div className="text-center">Physical</div>
                    <div className="text-right">Variance</div>
                  </div>
                  <Separator />
                  {discrepancies.map((item) => (
                    <div key={item.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center px-4 py-2 rounded-md hover:bg-muted/50">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-center text-muted-foreground">{item.recordedCount}</div>
                        <div className="text-center font-medium">{item.actualCount}</div>
                        <div className={cn("text-right font-bold", item.variance > 0 ? 'text-green-600' : 'text-destructive')}>
                          {item.variance > 0 ? `+${item.variance}` : item.variance}
                        </div>
                    </div>
                  ))}
                </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
