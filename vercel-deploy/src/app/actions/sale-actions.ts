'use server';

import { initializeMysqlServer } from '@/lib/mysql-auth-server';
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type MysqlStore, type Transaction } from '@/lib/mysql-store';
import { writeAuditEvent } from '@/lib/audit';

type SaleLine = {
  productId: string;
  quantity: number;
  price: number;
  baseProductSku?: string;
  containedUnits?: number;
};

type Actor = { uid: string; name?: string | null; email?: string | null };
type CreateSalePayload = {
  sessionProof: string;
  idempotencyKey?: string;
  sale: {
    shopId?: string;
    subtotal: number;
    taxRate?: number;
    tax: number;
    total: number;
    amountPaid: number;
    changeDue: number;
    paymentMethod: 'cash' | 'card';
    paymentReference?: string;
    customerId?: string;
    customerName?: string;
    storeCreditCode?: string;
    storeCreditAmount?: number;
    discounts?: Array<{
      type: 'percentage' | 'fixed' | 'bulk';
      value: number;
      description?: string;
      promoCode?: string;
      appliedAmount: number;
    }>;
    discountTotal?: number;
    payments?: Array<{
      method: 'cash' | 'card' | 'credit' | 'giftcard';
      amount: number;
      reference?: string;
    }>;
    notes?: string;
  };
  items: Array<SaleLine & { productName: string }>;
};

async function requireAdmin(sessionProof: string) {
  const { auth, mysql } = initializeMysqlServer();
  if (!sessionProof) throw new Error('Authentication token is missing.');
  const decoded = await auth.verifySessionProof(sessionProof);
  const roleDoc = await mysql.collection('roles_admin').doc(decoded.uid).get();
  if (!roleDoc.exists) throw new Error('Only administrators can perform this action.');
  const profile = await mysql.collection('users').doc(decoded.uid).get();
  return {
    mysql,
    actor: { uid: decoded.uid, name: decoded.name, email: decoded.email } as Actor,
    shopId: profile.data()?.shopId || null,
    isSuperAdmin: profile.data()?.role === 'super administrator',
  };
}

function assertBillingActive(shop: Record<string, any>) {
  const explicitExpiry = shop.billingExpiresAt?.toDate?.() || shop.billingExpiresAt;
  const createdAt = shop.createdAt?.toDate?.() || shop.createdAt;
  const expiresAt = explicitExpiry || (createdAt ? new Date(new Date(createdAt).getFullYear(), new Date(createdAt).getMonth() + 1, 1) : null);
  if (shop.billingStatus !== 'active' || (expiresAt && new Date(expiresAt) <= new Date())) {
    throw new Error('Monthly payment is due. Please pay the monthly fee to continue using the POS.');
  }
}

function stockStatus(stock: number, threshold: number) {
  return stock > threshold ? 'In Stock' : stock > 0 ? 'Low Stock' : 'Out of Stock';
}

export async function createSaleAction(payload: CreateSalePayload) {
  try {
    const { auth, mysql } = initializeMysqlServer();
    if (!payload.sessionProof) throw new Error('Authentication token is missing.');
    const decoded = await auth.verifySessionProof(payload.sessionProof);
    const profileSnapshot = await mysql.collection('users').doc(decoded.uid).get();
    if (!profileSnapshot.exists) throw new Error('Your user profile was not found.');
    const profile = profileSnapshot.data()!;
    if (profile.role !== 'shop owner' && profile.role !== 'sales') {
      throw new Error('Your account is not authorized to make sales.');
    }
    if (!payload.items.length) throw new Error('The sale must contain at least one item.');
    if (profile.role === 'sales' && payload.sale.discounts?.some((discount) => !discount.promoCode?.trim())) {
      throw new Error('Manual discounts require shop-owner approval. Use an approved promo code or ask a manager.');
    }
    for (const discount of payload.sale.discounts || []) {
      if (!discount.promoCode) continue;
      const discountSnapshot = await mysql.collection('discounts')
        .where('shopId', '==', profile.shopId)
        .where('promoCode', '==', discount.promoCode.trim())
        .where('isActive', '==', true)
        .limit(1)
        .get();
      if (discountSnapshot.empty) throw new Error('One of the submitted promo codes is invalid or inactive.');
      const configured = discountSnapshot.docs[0].data();
      if (configured.type !== discount.type || Number(configured.value) !== Number(discount.value)) throw new Error('The submitted promotion no longer matches the configured discount.');
      const now = new Date();
      const startDate = configured.startDate?.toDate?.() || configured.startDate;
      const endDate = configured.endDate?.toDate?.() || configured.endDate;
      if ((startDate && new Date(startDate) > now) || (endDate && new Date(endDate) < now)) throw new Error('One of the submitted promotions is outside its active dates.');
    }
    if ((payload.sale.paymentMethod === 'card' || payload.sale.payments?.some((payment) => payment.method === 'card')) && !payload.sale.paymentReference?.trim() && !payload.sale.payments?.some((payment) => payment.method === 'card' && payment.reference?.trim())) {
      throw new Error('Enter the card terminal approval reference before completing this sale.');
    }
    if (profile.shopId && payload.sale.shopId !== profile.shopId) {
      throw new Error('Sale shop does not match the signed-in user.');
    }
    if (profile.shopId) {
      const shopSnapshot = await mysql.collection('shops').doc(profile.shopId).get();
      if (!shopSnapshot.exists) throw new Error('Your shop account was not found.');
      assertBillingActive(shopSnapshot.data()!);
    }

    const productQuery = profile.shopId
      ? mysql.collection('products').where('shopId', '==', profile.shopId)
      : mysql.collection('products');
    const products = (await productQuery.get()).docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })) as Array<{
      id: string; name: string; sku: string; price: number; costPrice?: number; stock: number; threshold?: number; baseProductSku?: string; containedUnits?: number;
    }>;
    const groups = new Map<string, number>();
    let subtotal = 0;
    let costOfGoods = 0;
    for (const item of payload.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Sale quantities must be whole numbers greater than zero.');
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product) throw new Error(`Product ${item.productId} was not found.`);
      if ((product as { isArchived?: boolean }).isArchived) throw new Error(`${product.name} is archived and cannot be sold.`);
      subtotal += product.price * item.quantity;
      costOfGoods += (product.costPrice || 0) * item.quantity;
      const baseSku = product.baseProductSku || product.sku;
      groups.set(baseSku, (groups.get(baseSku) || 0) + item.quantity * (product.containedUnits || 1));
    }

    const saleId = payload.idempotencyKey
      ? `offline_${payload.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`
      : mysql.collection('sales').doc().id;
    const saleRef = mysql.collection('sales').doc(saleId);
    const taxRate = payload.sale.taxRate || 0;
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) throw new Error('Tax rate must be between 0% and 100%.');
    let discountTotal = 0;
    for (const discount of payload.sale.discounts || []) {
      if (!Number.isFinite(discount.value) || discount.value < 0) throw new Error('Invalid discount.');
      if (!Number.isFinite(discount.appliedAmount) || discount.appliedAmount < 0) throw new Error('Invalid discount amount.');
      if (discount.type === 'percentage') {
        if (discount.value > 100) throw new Error('Percentage discounts cannot exceed 100%.');
        discountTotal += subtotal * discount.value / 100;
      } else if (discount.type === 'fixed') {
        discountTotal += discount.value;
      } else {
        throw new Error('Bulk discounts must be configured server-side.');
      }
    }
    discountTotal = Math.min(subtotal, discountTotal);
    const discountEntries = payload.sale.discounts || [];
    const expectedDiscountTotal = Math.min(subtotal, discountEntries.reduce((sum, discount) => {
      return sum + (discount.type === 'percentage' ? subtotal * discount.value / 100 : discount.value);
    }, 0));
    const submittedDiscountTotal = discountEntries.reduce((sum, discount) => sum + discount.appliedAmount, 0);
    if (Math.abs(submittedDiscountTotal - expectedDiscountTotal) > 0.01) throw new Error('Discount amount is invalid.');
    const subtotalAfterDiscount = Math.max(0, subtotal - discountTotal);
    const tax = subtotalAfterDiscount * taxRate;
    const storeCreditAmount = payload.sale.storeCreditAmount || 0;
    const total = Math.max(0, subtotalAfterDiscount + tax - storeCreditAmount);
    const paymentsTotal = payload.sale.payments?.length
      ? payload.sale.payments.reduce((sum, payment) => sum + payment.amount, 0)
      : payload.sale.amountPaid;
    if (payload.sale.payments?.some((payment) => !Number.isFinite(payment.amount) || payment.amount < 0)) {
      throw new Error('Payment amounts must be valid positive numbers.');
    }
    if (!Number.isFinite(paymentsTotal) || paymentsTotal < total) throw new Error('Payment is less than the sale total.');
    const changeDue = Math.max(0, paymentsTotal - total);
    const cashTender = payload.sale.payments?.filter((payment) => payment.method === 'cash').reduce((sum, payment) => sum + payment.amount, 0) ?? (payload.sale.paymentMethod === 'cash' ? Math.max(0, payload.sale.amountPaid - changeDue) : 0);
    const saleToStore = {
      ...payload.sale,
      subtotal,
      taxRate,
      tax,
      total,
      discountTotal,
      amountPaid: paymentsTotal,
      changeDue,
      costOfGoods,
      grossProfit: total - costOfGoods,
    };
    await mysql.runTransaction(async (transaction) => {
      const existingSale = await transaction.get(saleRef);
      if (existingSale.exists) return;
      const reads = new Map<string, DocumentSnapshot>();
      for (const baseSku of groups.keys()) {
        const linked = products.filter((product) => product.sku === baseSku || product.baseProductSku === baseSku);
        const base = linked.find((product) => product.sku === baseSku) || linked[0];
        if (!base) throw new Error(`Base product ${baseSku} was not found.`);
        for (const product of linked) {
          const ref = mysql.collection('products').doc(product.id);
          reads.set(product.id, await transaction.get(ref));
        }
      }
      const customerSnapshot = saleToStore.customerId
        ? await transaction.get(mysql.collection('customers').doc(saleToStore.customerId))
        : null;
      const creditSnapshot = saleToStore.storeCreditCode
        ? await transaction.get(
          mysql.collection('store_credits').where('code', '==', saleToStore.storeCreditCode).limit(1)
        )
        : null;
      const drawerSnapshot = cashTender > 0
        ? await transaction.get(mysql.collection('cash_drawers').where('salespersonId', '==', decoded.uid))
        : null;
      const timestamp = Timestamp.now();
      for (const [baseSku, units] of groups) {
        const linked = products.filter((product) => product.sku === baseSku || product.baseProductSku === baseSku);
        const base = linked.find((product) => product.sku === baseSku) || linked[0];
        const baseSnapshot = reads.get(base.id);
        const available = baseSnapshot?.data()?.stock || 0;
        if (units > available) throw new Error(`Not enough stock for ${base.name}. Required: ${units}, available: ${available}.`);
        const newBaseStock = available - units;
        for (const product of linked) {
          const stock = product.id === base.id ? newBaseStock : Math.floor(newBaseStock / (product.containedUnits || 1));
          transaction.update(mysql.collection('products').doc(product.id), { stock, status: stockStatus(stock, product.threshold || 0) });
        }
      }
      // Update customer if provided
      if (saleToStore.customerId) {
        const customerRef = mysql.collection('customers').doc(saleToStore.customerId);
        const now = Timestamp.now();
        if (customerSnapshot?.exists) {
          const customerData = customerSnapshot.data()!;
          if (profile.shopId && customerData.shopId && customerData.shopId !== profile.shopId) {
            throw new Error('Customer does not belong to the signed-in shop.');
          }
          transaction.update(customerRef, {
            totalSpent: (customerData.totalSpent || 0) + saleToStore.total,
            visitCount: (customerData.visitCount || 0) + 1,
            lastVisit: now,
          });
        }
      }

      if (saleToStore.storeCreditCode || saleToStore.storeCreditAmount) {
        if (!saleToStore.storeCreditCode || !saleToStore.storeCreditAmount || saleToStore.storeCreditAmount <= 0 || saleToStore.storeCreditAmount > subtotalAfterDiscount + tax) {
          throw new Error('Store credit details are incomplete.');
        }
        if (!creditSnapshot || creditSnapshot.empty) throw new Error('Store credit code not found.');
        const creditDoc = creditSnapshot.docs[0];
        const credit = creditDoc.data();
        if (!credit.isActive) throw new Error('Store credit is no longer active.');
        const expiresAt = credit.expiresAt?.toDate?.() || credit.expiresAt;
        if (expiresAt && expiresAt < new Date()) throw new Error('Store credit has expired.');
        if (credit.balance < saleToStore.storeCreditAmount) throw new Error('Insufficient store credit balance.');
        transaction.update(creditDoc.ref, {
          balance: credit.balance - saleToStore.storeCreditAmount,
          usageHistory: FieldValue.arrayUnion({
            saleId,
            amount: saleToStore.storeCreditAmount,
            date: timestamp,
          }),
        });
      }

      if (drawerSnapshot && !drawerSnapshot.empty) {
        const openDrawer = drawerSnapshot.docs.find((drawer) => drawer.data().status === 'open' && drawer.data().shopId === profile.shopId);
        if (openDrawer) {
          transaction.update(openDrawer.ref, { expectedTotal: (openDrawer.data().expectedTotal || 0) + cashTender, lastSaleAt: timestamp });
        }
      }

      transaction.set(saleRef, { id: saleId, ...saleToStore, createdAt: timestamp, salespersonId: decoded.uid, salespersonName: `${profile.name || ''} ${profile.surname || ''}`.trim() });
      payload.items.forEach((item) => {
        const itemRef = saleRef.collection('items').doc();
        const product = products.find((candidate) => candidate.id === item.productId)!;
        transaction.set(itemRef, {
          ...item,
          productName: product.name,
          price: product.price,
          saleId,
          shopId: profile.shopId,
          baseProductSku: product.baseProductSku || product.sku,
          containedUnits: product.containedUnits || 1,
          createdAt: timestamp,
        });
      });
    });
    await writeAuditEvent(mysql, {
      action: 'sale.completed',
      actorId: decoded.uid,
      actorName: `${profile.name || ''} ${profile.surname || ''}`.trim(),
      shopId: profile.shopId,
      entityType: 'sale',
      entityId: saleId,
      details: { total: saleToStore.total, paymentMethod: saleToStore.paymentMethod, offline: Boolean(payload.idempotencyKey) },
    });
    return { success: true, saleId };
  } catch (error: any) {
    console.error('Failed to create sale:', error);
    return { success: false, error: error.message || 'Unable to complete sale.' };
  }
}

async function reverseInventory(
  transaction: Transaction,
  mysql: MysqlStore,
  items: SaleLine[],
  type: 'void' | 'return',
  actor: Actor,
  reason: string,
  referenceId: string,
  shopId: string | null
) {
  const productQuery = shopId
    ? mysql.collection('products').where('shopId', '==', shopId)
    : mysql.collection('products');
  const productSnapshots = await productQuery.get();
  const products = productSnapshots.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  })) as Array<{
    id: string;
    sku: string;
    baseProductSku?: string;
    containedUnits?: number;
    stock: number;
    threshold?: number;
  }>;
  const unitsByBaseSku = new Map<string, number>();

  for (const item of items) {
    const product = products.find((candidate) => candidate.id === item.productId);
    const baseSku = item.baseProductSku || product?.baseProductSku || product?.sku;
    if (!baseSku) throw new Error(`Product ${item.productId} has no inventory base SKU.`);
    const units = item.quantity * (item.containedUnits || product?.containedUnits || 1);
    unitsByBaseSku.set(baseSku, (unitsByBaseSku.get(baseSku) || 0) + units);
  }

  const updates: Array<{ ref: DocumentReference; stock: number; threshold: number }> = [];
  for (const [baseSku, units] of unitsByBaseSku) {
    const linkedProducts = products.filter(
      (product) => product.sku === baseSku || product.baseProductSku === baseSku
    );
    const baseProduct = linkedProducts.find((product) => product.sku === baseSku) || linkedProducts[0];
    if (!baseProduct) throw new Error(`Base product ${baseSku} was not found.`);

    const baseRef = mysql.collection('products').doc(baseProduct.id);
    const baseSnapshot = await transaction.get(baseRef);
    if (!baseSnapshot.exists) throw new Error(`Base product ${baseSku} was not found.`);
    const newBaseStock = (baseSnapshot.data()?.stock || 0) + units;

    for (const product of linkedProducts) {
      const ref = mysql.collection('products').doc(product.id);
      const snapshot = product.id === baseProduct.id ? baseSnapshot : await transaction.get(ref);
      if (!snapshot.exists) throw new Error(`Product ${product.id} was not found.`);
      const stock = product.id === baseProduct.id
        ? newBaseStock
        : Math.floor(newBaseStock / (product.containedUnits || 1));
      updates.push({ ref, stock, threshold: product.threshold || 0 });
    }
  }

  updates.forEach(({ ref, stock, threshold }) =>
    transaction.update(ref, { stock, status: stockStatus(stock, threshold) })
  );
  const movementRef = mysql.collection('inventory_transactions').doc();
  transaction.set(movementRef, {
    type,
    referenceId,
    reason,
    lines: items,
    createdAt: Timestamp.now(),
    createdBy: actor,
  });
  return movementRef.id;
}

async function restoreStoreCredit(
  transaction: Transaction,
  mysql: MysqlStore,
  sale: Record<string, any>,
  amount: number
) : Promise<{ ref: DocumentReference; amount: number; balance: number } | null> {
  const originalAmount = sale.storeCreditAmount || 0;
  const alreadyRestored = sale.storeCreditRestoredAmount || 0;
  const restoreAmount = Math.min(amount, Math.max(0, originalAmount - alreadyRestored));
  if (!sale.storeCreditCode || restoreAmount <= 0) return null;

  const creditsSnapshot = await transaction.get(
    mysql.collection('store_credits').where('code', '==', sale.storeCreditCode).limit(1)
  );
  if (creditsSnapshot.empty) throw new Error('Store credit used by this sale was not found.');
  const creditDoc = creditsSnapshot.docs[0];
  const credit = creditDoc.data();
  return { ref: creditDoc.ref, amount: restoreAmount, balance: credit.balance || 0 };
}

function applyStoreCreditRestoration(
  transaction: Transaction,
  restoration: { ref: DocumentReference; amount: number; balance: number } | null,
  referenceId: string
) {
  if (!restoration) return;
  transaction.update(restoration.ref, {
    balance: restoration.balance + restoration.amount,
    usageHistory: FieldValue.arrayUnion({
      saleId: referenceId,
      amount: -restoration.amount,
      date: Timestamp.now(),
      type: 'restored',
    }),
  });
}

export async function voidSaleAction(payload: { saleId: string; sessionProof: string; reason: string }) {
  try {
    const { mysql, actor, shopId, isSuperAdmin } = await requireAdmin(payload.sessionProof);
    if (!payload.reason?.trim()) throw new Error('A reason is required to void a sale.');
    const saleRef = mysql.collection('sales').doc(payload.saleId);
    let auditShopId: string | null = null;
    const movementId = await mysql.runTransaction(async (transaction) => {
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists) throw new Error('Sale not found.');
      const sale = saleSnapshot.data()!;
      if (!isSuperAdmin && (!shopId || sale.shopId !== shopId)) throw new Error('This sale does not belong to your shop.');
      auditShopId = sale.shopId || null;
      if (sale.status === 'voided') throw new Error('Sale has already been voided.');
      if ((sale.returnedTotal || 0) > 0) throw new Error('A sale with returns cannot be voided.');
      const itemSnapshots = await transaction.get(saleRef.collection('items'));
      const items = itemSnapshots.docs.map((item) => item.data()) as SaleLine[];
      const creditRestoration = await restoreStoreCredit(transaction, mysql, sale, sale.storeCreditAmount || 0);
      const id = await reverseInventory(transaction, mysql, items, 'void', actor, payload.reason.trim(), payload.saleId, sale.shopId || shopId);
      applyStoreCreditRestoration(transaction, creditRestoration, payload.saleId);
      transaction.update(saleRef, {
        status: 'voided',
        voidedAt: Timestamp.now(),
        voidedBy: actor,
        voidReason: payload.reason.trim(),
        reversalTransactionId: id,
        storeCreditRestoredAmount: creditRestoration?.amount || 0,
      });
      return id;
    });
    await writeAuditEvent(mysql, {
      action: 'sale.voided',
      actorId: actor.uid,
      actorName: actor.name,
      shopId: auditShopId,
      entityType: 'sale',
      entityId: payload.saleId,
      details: { reason: payload.reason.trim(), transactionId: movementId },
    });
    return { success: true, transactionId: movementId };
  } catch (error: any) {
    console.error('Failed to void sale:', error);
    return { success: false, error: error.message || 'Unable to void sale.' };
  }
}

export async function returnSaleAction(payload: {
  saleId: string;
  sessionProof: string;
  reason: string;
  refundMethod: 'cash' | 'card';
  items: Array<{ itemId: string; quantity: number }>;
}) {
  try {
    const { mysql, actor, shopId, isSuperAdmin } = await requireAdmin(payload.sessionProof);
    if (!payload.reason?.trim()) throw new Error('A reason is required for the return.');
    const saleRef = mysql.collection('sales').doc(payload.saleId);
    let auditShopId: string | null = null;
    await mysql.runTransaction(async (transaction) => {
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists) throw new Error('Sale not found.');
      const sale = saleSnapshot.data()!;
      if (!isSuperAdmin && (!shopId || sale.shopId !== shopId)) throw new Error('This sale does not belong to your shop.');
      auditShopId = sale.shopId || null;
      if (sale.status === 'voided') throw new Error('Voided sales cannot be returned.');
      const selected = payload.items.filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
      if (!selected.length) throw new Error('Select at least one item to return.');
      const itemSnapshots = await transaction.get(saleRef.collection('items'));
      const itemMap = new Map(itemSnapshots.docs.map((item) => [item.id, { ref: item.ref, data: item.data() as SaleLine & { returnedQuantity?: number } }]));
      const lines: SaleLine[] = [];
      const itemUpdates: Array<{ ref: DocumentReference; returnedQuantity: number }> = [];
      let refundAmount = 0;
      for (const selectedItem of selected) {
        const stored = itemMap.get(selectedItem.itemId);
        if (!stored) throw new Error('A selected sale item no longer exists.');
        const available = stored.data.quantity - (stored.data.returnedQuantity || 0);
        if (selectedItem.quantity > available) throw new Error('Return quantity exceeds the quantity sold.');
        lines.push({ ...stored.data, quantity: selectedItem.quantity });
        refundAmount += selectedItem.quantity * stored.data.price;
        itemUpdates.push({ ref: stored.ref, returnedQuantity: (stored.data.returnedQuantity || 0) + selectedItem.quantity });
      }
      const returnRef = saleRef.collection('returns').doc();
      const refundWithTax = sale.subtotal > 0 ? refundAmount * (sale.total + (sale.storeCreditAmount || 0)) / sale.subtotal : refundAmount;
      const creditRestoration = await restoreStoreCredit(
        transaction,
        mysql,
        sale,
        sale.storeCreditAmount ? refundWithTax * sale.storeCreditAmount / (sale.total + sale.storeCreditAmount) : 0
      );
      const movementId = await reverseInventory(transaction, mysql, lines, 'return', actor, payload.reason.trim(), payload.saleId, sale.shopId || shopId);
      itemUpdates.forEach(({ ref, returnedQuantity }) => transaction.update(ref, { returnedQuantity }));
      applyStoreCreditRestoration(transaction, creditRestoration, `${payload.saleId}:${returnRef.id}`);
      transaction.set(returnRef, {
        id: returnRef.id,
        saleId: payload.saleId,
        items: lines,
        refundAmount,
        refundMethod: payload.refundMethod,
        reason: payload.reason.trim(),
        createdAt: Timestamp.now(),
        createdBy: actor,
        inventoryTransactionId: movementId,
        storeCreditRestoredAmount: creditRestoration?.amount || 0,
      });
      const returnedTotal = (sale.returnedTotal || 0) + refundWithTax;
      transaction.update(saleRef, {
        returnedTotal,
        status: returnedTotal >= sale.total ? 'refunded' : 'partially_refunded',
        lastRefundAmount: refundWithTax,
        storeCreditRestoredAmount: (sale.storeCreditRestoredAmount || 0) + (creditRestoration?.amount || 0),
      });
    });
    await writeAuditEvent(mysql, {
      action: 'sale.returned',
      actorId: actor.uid,
      actorName: actor.name,
      shopId: auditShopId,
      entityType: 'sale',
      entityId: payload.saleId,
      details: { reason: payload.reason.trim(), refundMethod: payload.refundMethod, itemCount: payload.items.length },
    });
    return { success: true };
  } catch (error: any) {
    console.error('Failed to return sale:', error);
    return { success: false, error: error.message || 'Unable to process return.' };
  }
}
