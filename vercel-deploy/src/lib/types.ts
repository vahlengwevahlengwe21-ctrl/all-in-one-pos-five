

export type Product = {
  id: string;
  shopId?: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  stock: number;
  price: number;
  costPrice?: number;
  location: string;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
  threshold: number;
  imageId?: string;
  imageUrl?: string;
  baseProductSku?: string;
  containedUnits?: number;
  size?: string;
  sizeVariant?: string;
  unitLabel?: string;
  leadTimeDays?: number;
  isArchived?: boolean;
};

export type StockChange = {
  productName: string;
  productSku: string;
  change: number;
  date: string;
};

export type Payment = {
  method: 'cash' | 'card' | 'credit' | 'giftcard';
  amount: number;
  reference?: string; // For card/credit transactions
  provider?: PaymentProvider;
  status?: 'pending' | 'approved' | 'declined' | 'cancelled';
};

export type PaymentProvider = 'manual_terminal' | 'stripe_terminal' | 'payfast' | 'paystack' | 'yoco' | 'ikhokha' | 'snapscan';

export type ShopPaymentSettings = {
  shopId: string;
  provider: PaymentProvider;
  displayName: string;
  merchantId?: string | null;
  terminalName?: string | null;
  currency: 'ZAR';
  enabled: boolean;
  updatedAt?: any;
};

export type SaleDiscount = {
  type: 'percentage' | 'fixed' | 'bulk';
  value: number; // percentage (0-100) or fixed amount or bulk threshold
  description: string;
  promoCode?: string;
  appliedAmount: number; // actual amount discounted
};

export type Sale = {
  id: string;
  shopId?: string;
  total: number;
  tax: number;
  taxRate?: number;
  subtotal: number;
  amountPaid: number;
  changeDue: number;
  paymentMethod: 'cash' | 'card';
  paymentReference?: string;
  payments?: Payment[]; // for split payments
  salespersonId: string;
  salespersonName: string;
  customerId?: string; // customer profile reference
  customerName?: string;
  storeCreditCode?: string;
  storeCreditAmount?: number;
  createdAt: any; // Use 'any' for serverTimestamp, will be Date on fetch
  status?: 'completed' | 'partially_refunded' | 'refunded' | 'voided';
  voidedAt?: any;
  voidedBy?: { uid: string; name?: string | null };
  voidReason?: string;
  returnedTotal?: number;
  lastRefundAmount?: number;
  discounts?: SaleDiscount[];
  discountTotal?: number;
  costOfGoods?: number;
  grossProfit?: number;
  notes?: string;
};

export type SaleItem = {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  baseProductSku?: string;
  containedUnits?: number;
  returnedQuantity?: number;
  createdAt: any; // Use 'any' for serverTimestamp, will be Date on fetch
};

export type UserProfile = {
  id: string;
  name: string;
  surname: string;
  email: string;
  role: 'shop owner' | 'super administrator' | 'sales';
  hiddenFromUserList?: boolean;
  shopId?: string;
  mustChangePassword?: boolean;
  createdAt: any; // Mysql timestamp
}

export type Shop = {
  id: string;
  shopName: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  ownerEmail?: string | null;
  billingStatus: 'active' | 'suspended';
  billingExpiresAt?: any;
  maxUsersAllowed: number;
  maxDevicesAllowed: number;
  createdAt: any;
  ownerUid?: string;
  activationToken?: string | null;
  activationTokenExpiresAt?: number | null;
};

// Customer Profiles & Loyalty
export type Customer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  loyaltyPoints?: number;
  totalSpent?: number;
  visitCount?: number;
  lastVisit?: any;
  notes?: string;
  createdAt: any;
};

// Discounts & Promotions
export type Discount = {
  id: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed' | 'bulk';
  value: number; // percentage or fixed amount
  bulkMinQty?: number; // for bulk discounts
  promoCode?: string; // optional promo code
  applicableProducts?: string[]; // if empty, applies to all
  applicableCategories?: string[]; // if empty, applies to all
  startDate?: any;
  endDate?: any;
  isActive: boolean;
  createdAt: any;
};

// Favorites/Quick Access
export type Favorite = {
  id: string;
  userId: string;
  productId: string;
  productName: string;
  productSku: string;
  addedAt: any;
};

// Recent Items
export type RecentItem = {
  productId: string;
  productName: string;
  price: number;
  lastSoldAt: any;
  timesSold: number;
};

// Till/Cash Drawer
export type CashDrawer = {
  id: string;
  salespersonId: string;
  salespersonName: string;
  openingBalance: number;
  closingBalance?: number;
  expectedTotal?: number;
  actualTotal?: number;
  discrepancy?: number;
  status: 'open' | 'closed';
  openedAt: any;
  closedAt?: any;
  notes?: string;
};

// Store Credit/Gift Card
export type StoreCredit = {
  id: string;
  code: string;
  customerId?: string;
  balance: number;
  initialAmount: number;
  type: 'store_credit' | 'gift_card';
  isActive: boolean;
  createdAt: any;
  expiresAt?: any;
  usageHistory?: Array<{ saleId: string; amount: number; date: any }>;
};

// Layaway/Payment Plan
export type Layaway = {
  id: string;
  customerId: string;
  customerName: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: any;
  scheduledPickupDate?: any;
  notes?: string;
  payments?: Array<{ amount: number; date: any }>;
};
