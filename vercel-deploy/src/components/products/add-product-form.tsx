
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload } from 'lucide-react';
import { useState } from 'react';
import Image from 'next/image';
import { useMysql, addDocumentNonBlocking, useUser, useDoc } from '@/auth';
import { collection, doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';

const formSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  description: z.string().min(1, 'Description is required'),
  category: z.string().min(1, 'Category is required'),
  sizeVariant: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be a non-negative number'),
  costPrice: z.coerce.number().min(0, 'Cost price must be a non-negative number'),
  stock: z.coerce.number().int().min(0, 'Stock must be a non-negative integer'),
  location: z.string().min(1, 'Location is required'),
  threshold: z.coerce.number().int().min(0, 'Threshold must be a non-negative integer'),
  leadTimeDays: z.coerce.number().int().min(0, 'Lead time must be a non-negative integer').default(2),
  image: z.any(),
  baseProductSku: z.string().optional(),
  containedUnits: z.coerce.number().int().min(1, 'Must contain at least 1 unit').default(1),
});

type FormData = z.infer<typeof formSchema>;

export function AddProductForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const mysql = useMysql();
  const { user } = useUser();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const router = useRouter();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      sku: '',
      description: '',
      category: '',
      sizeVariant: '',
      price: 0,
      costPrice: 0,
      stock: 0,
      location: '',
      threshold: 10,
      leadTimeDays: 2,
      baseProductSku: '',
      containedUnits: 1,
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      form.setValue('image', file);
    } else {
      setImagePreview(null);
      form.setValue('image', null);
    }
  };

  async function onSubmit(data: FormData) {
    setIsLoading(true);

    if (!mysql) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'The MySQL data service is not initialized.',
      });
      setIsLoading(false);
      return;
    }

    try {
      const productsCollection = collection(mysql, 'products');
      const { image, ...productData } = data;
      
      // If baseProductSku is empty, it's a base product, so its base SKU is its own SKU.
      const finalBaseProductSku = productData.baseProductSku || productData.sku;

      const status = productData.stock > productData.threshold ? 'In Stock' : (productData.stock > 0 ? 'Low Stock' : 'Out of Stock');
      
      addDocumentNonBlocking(productsCollection, {
        ...productData,
        shopId: profile?.shopId,
        baseProductSku: finalBaseProductSku,
        status,
        imageUrl: imagePreview,
      });

      toast({
        title: 'Product Added!',
        description: `The product "${data.name}" has been added to your inventory.`,
      });

      router.push('/products');
    } catch (e: any) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: e.message || 'Could not save product.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Product Details</CardTitle>
                <CardDescription>
                  Fill out the form below to add a new product.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Product Name</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g. Minimalist Wooden Chair" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>SKU</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g. MWC-001" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="costPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Price (R)</FormLabel>
                        <FormControl><Input type="number" placeholder="e.g. 800.00" {...field} /></FormControl>
                        <FormDescription>Your purchase cost, used for gross-profit reporting.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="sizeVariant"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Size or pack format</FormLabel>
                      <FormControl><Input placeholder="e.g. 750ml bottle, 440ml can, 6-pack, 10kg bag" {...field} /></FormControl>
                      <FormDescription>Keep sizes as separate report and supplier-order lines.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="leadTimeDays" render={({ field }) => <FormItem><FormLabel>Supplier lead time (days)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormDescription>Used by the restock radar to warn before delivery can arrive.</FormDescription><FormMessage /></FormItem>} />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter a brief description of the product."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Category</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g. Furniture" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price (R)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="e.g. 1299.99" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                    control={form.control}
                    name="stock"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Stock Quantity</FormLabel>
                        <FormControl>
                            <Input type="number" placeholder="e.g. 25" {...field} />
                        </FormControl>
                        <FormDescription>
                            For a single/base item, this is the TOTAL number of individual units available. For packs/cases, this is the number of packs/cases.
                        </FormDescription>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g. Warehouse A, Shelf 3" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="threshold"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Low Stock Threshold</FormLabel>
                        <FormControl>
                            <Input type="number" placeholder="e.g. 10" {...field} />
                        </FormControl>
                         <FormDescription>
                            When stock reaches this level, it will be marked as "Low Stock".
                         </FormDescription>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                 <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Product Bundling</CardTitle>
                        <CardDescription>Use these fields to link packs to single items.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="baseProductSku"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Base Product SKU</FormLabel>
                                <FormControl>
                                    <Input placeholder="SKU of the single item" {...field} />
                                </FormControl>
                                <FormDescription>
                                    For a pack/case, enter the SKU of the single item it's made of. For a single item, leave this empty.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="containedUnits"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Contained Units</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormDescription>
                                   e.g., 1 for a single, 6 for a 6-pack, 24 for a case.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Product Image</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-video flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted">
                  {imagePreview ? (
                    <Image src={imagePreview} alt="Product image preview" fill className="rounded-lg object-cover" />
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Upload className="mx-auto h-8 w-8" />
                      <p>Image Preview</p>
                    </div>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name="image"
                  render={() => (
                    <FormItem>
                      <FormLabel>Image</FormLabel>
                      <FormControl>
                        <Input type="file" accept="image/*" onChange={handleImageChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                    <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding Product...
                    </>
                ) : (
                    'Add Product'
                )}
            </Button>
            <Button variant="outline" type="button" onClick={() => router.back()}>
                Cancel
            </Button>
        </div>
      </form>
    </Form>
  );
}
