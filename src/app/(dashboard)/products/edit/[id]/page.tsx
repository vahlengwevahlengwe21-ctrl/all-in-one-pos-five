'use client';
import { useParams } from 'next/navigation';
import { EditProductForm } from '@/components/products/edit-product-form';
import { useDoc, useMysql } from '@/auth';
import { doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function EditProductPage() {
  const params = useParams();
  const { id } = params;
  const mysql = useMysql();

  const productRef = useMemoMysql(
    () => (mysql && id ? doc(mysql, 'products', id as string) : null),
    [mysql, id]
  );
  const { data: product, isLoading } = useDoc<Product>(productRef);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Edit Product</h1>
      </div>
      {isLoading && (
         <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent className="grid gap-6">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </CardContent>
            </Card>
          </div>
           <div className="space-y-4">
             <Card>
               <CardHeader>
                 <Skeleton className="h-8 w-1/2" />
               </CardHeader>
               <CardContent className="space-y-4">
                  <Skeleton className="aspect-video w-full" />
                  <Skeleton className="h-10 w-full" />
               </CardContent>
             </Card>
           </div>
         </div>
      )}
      {product && <EditProductForm product={product} />}
    </div>
  );
}
