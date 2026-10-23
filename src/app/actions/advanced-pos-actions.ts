'use server';

import { initializeMysqlServer } from '@/lib/mysql-auth-server';
import { FieldValue, Timestamp } from '@/lib/mysql-store';
import { writeAuditEvent } from '@/lib/audit';

async function requireAuth(sessionProof: string) {
  const { auth, mysql } = initializeMysqlServer();
  try {
    const decodedToken = await auth.verifySessionProof(sessionProof);
    const profile = await mysql.collection('users').doc(decodedToken.uid).get();
    return { uid: decodedToken.uid, email: decodedToken.email, shopId: profile.data()?.shopId || null, role: profile.data()?.role };
  } catch (error) {
    throw new Error('Unauthorized: Invalid or expired token');
  }
}

function requireManager(user: { role?: string }) {
  if (user.role !== 'shop owner' && user.role !== 'super administrator') throw new Error('Only a shop owner can perform this action.');
}

export async function applyStockCountAction(payload: { sessionProof: string; items: Array<{ productId: string; actualCount: number }> }) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);
  if (!payload.items.length) throw new Error('No stock count items were supplied.');
  if (payload.items.some((item) => !Number.isInteger(item.actualCount) || item.actualCount < 0)) throw new Error('Stock counts must be non-negative whole numbers.');
  const uniqueItems = new Map(payload.items.map((item) => [item.productId, item.actualCount]));
  const changes: Array<{ productId: string; before: number; after: number; variance: number }> = [];
  await mysql.runTransaction(async (transaction) => {
    const productSnapshots = await Promise.all(Array.from(uniqueItems.keys()).map((productId) => transaction.get(mysql.collection('products').doc(productId))));
    productSnapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.data()?.shopId !== user.shopId) throw new Error('A stock-count product does not belong to this shop.');
      const before = Number(snapshot.data()?.stock || 0);
      const after = uniqueItems.get(snapshot.id)!;
      changes.push({ productId: snapshot.id, before, after, variance: after - before });
      const threshold = Number(snapshot.data()?.threshold || 0);
      transaction.update(snapshot.ref, { stock: after, status: after > threshold ? 'In Stock' : after > 0 ? 'Low Stock' : 'Out of Stock' });
    });
    const movementRef = mysql.collection('inventory_transactions').doc();
    transaction.set(movementRef, { type: 'stock_count', shopId: user.shopId, lines: changes, createdAt: Timestamp.now(), createdBy: { uid: user.uid, email: user.email || null } });
  });
  await writeAuditEvent(mysql, { action: 'inventory.stock_count_applied', actorId: user.uid, actorName: user.email, shopId: user.shopId, entityType: 'inventory', entityId: 'stock-count', details: { itemCount: changes.length, changedItems: changes.filter((change) => change.variance !== 0).length } });
  return { success: true, updatedCount: changes.length };
}

// ============== CUSTOMER MANAGEMENT ==============

export async function createCustomerAction(payload: {
  sessionProof: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  if (user.role !== 'shop owner' && user.role !== 'sales' && user.role !== 'super administrator') throw new Error('Your account cannot create customers.');

  try {
    const customersRef = mysql.collection('customers');
    const userProfile = await mysql.collection('users').doc(user.uid).get();
    const docRef = await customersRef.add({
      name: payload.name,
      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.address || null,
      loyaltyPoints: 0,
      totalSpent: 0,
      visitCount: 0,
      notes: payload.notes || null,
      createdAt: Timestamp.now(),
      shopId: userProfile.data()?.shopId || null,
    });

    return { success: true, customerId: docRef.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateCustomerAction(payload: {
  sessionProof: string;
  customerId: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    const customerRef = mysql.collection('customers').doc(payload.customerId);
    const customerSnapshot = await customerRef.get();
    if (!customerSnapshot.exists || customerSnapshot.data()?.shopId !== user.shopId) throw new Error('Customer does not belong to this shop.');
    const updates: any = {};
    if (payload.name) updates.name = payload.name;
    if (payload.phone !== undefined) updates.phone = payload.phone || null;
    if (payload.email !== undefined) updates.email = payload.email || null;
    if (payload.address !== undefined) updates.address = payload.address || null;
    if (payload.notes !== undefined) updates.notes = payload.notes || null;

    await customerRef.update(updates);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function addLoyaltyPointsAction(payload: {
  sessionProof: string;
  customerId: string;
  points: number;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);

  try {
    const customerRef = mysql.collection('customers').doc(payload.customerId);
    const customerSnapshot = await customerRef.get();
    if (!customerSnapshot.exists || customerSnapshot.data()?.shopId !== user.shopId) throw new Error('Customer does not belong to this shop.');
    if (!Number.isInteger(payload.points) || payload.points <= 0) throw new Error('Loyalty points must be a positive whole number.');
    await customerRef.update({
      loyaltyPoints: FieldValue.increment(payload.points),
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============== FAVORITES MANAGEMENT ==============

export async function addFavoriteAction(payload: {
  sessionProof: string;
  productId: string;
  productName: string;
  productSku: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    const favoritesRef = mysql.collection(`users/${user.uid}/favorites`);
    
    // Check if already favorited
    const existing = await favoritesRef.where('productId', '==', payload.productId).get();
    if (!existing.empty) {
      return { success: true, message: 'Already favorited' };
    }

    await favoritesRef.add({
      productId: payload.productId,
      productName: payload.productName,
      productSku: payload.productSku,
      addedAt: Timestamp.now(),
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function removeFavoriteAction(payload: {
  sessionProof: string;
  productId: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    const favoritesRef = mysql.collection(`users/${user.uid}/favorites`);
    const docs = await favoritesRef.where('productId', '==', payload.productId).get();
    
    for (const doc of docs.docs) {
      await doc.ref.delete();
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============== CASH DRAWER MANAGEMENT ==============

export async function openCashDrawerAction(payload: {
  sessionProof: string;
  openingBalance: number;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    if (!Number.isFinite(payload.openingBalance) || payload.openingBalance < 0) throw new Error('Opening balance must be a valid non-negative amount.');
    // Get user profile for name
    const userDoc = await mysql.collection('users').doc(user.uid).get();
    const userData = userDoc.data();
    const salespersonName = userData ? `${userData.name} ${userData.surname}` : 'Unknown';

    const drawerRef = await mysql.collection('cash_drawers').add({
      salespersonId: user.uid,
      salespersonName,
      shopId: user.shopId,
      openingBalance: payload.openingBalance,
      status: 'open',
      openedAt: Timestamp.now(),
    });

    return { success: true, drawerId: drawerRef.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function closeCashDrawerAction(payload: {
  sessionProof: string;
  drawerId: string;
  closingBalance: number;
  notes?: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    if (!Number.isFinite(payload.closingBalance) || payload.closingBalance < 0) throw new Error('Closing balance must be a valid non-negative amount.');
    const drawerRef = mysql.collection('cash_drawers').doc(payload.drawerId);
    const drawerSnap = await drawerRef.get();
    const drawer = drawerSnap.data();

    if (!drawer) throw new Error('Cash drawer not found');
    if (drawer.shopId !== user.shopId) throw new Error('Cash drawer does not belong to this shop.');
    if (drawer.salespersonId !== user.uid && user.role !== 'shop owner' && user.role !== 'super administrator') throw new Error('You can only close your own cash drawer.');

    const expectedTotal = drawer.openingBalance + (drawer.expectedTotal || 0);
    const discrepancy = payload.closingBalance - expectedTotal;

    await drawerRef.update({
      closingBalance: payload.closingBalance,
      expectedTotal,
      discrepancy,
      status: 'closed',
      closedAt: Timestamp.now(),
      notes: payload.notes || null,
    });

    return { success: true, discrepancy };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============== DISCOUNT APPLICATION ==============

export async function createDiscountAction(payload: {
  sessionProof: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed' | 'bulk';
  value: number;
  bulkMinQty?: number;
  promoCode?: string;
  applicableProducts?: string[];
  applicableCategories?: string[];
  startDate?: Date;
  endDate?: Date;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);

  try {
    if (!payload.name.trim()) throw new Error('Discount name is required.');
    if (!Number.isFinite(payload.value) || payload.value < 0 || (payload.type === 'percentage' && payload.value > 100)) throw new Error('Discount value is invalid.');
    if (payload.type === 'bulk' && (!Number.isInteger(payload.bulkMinQty) || (payload.bulkMinQty || 0) < 1)) throw new Error('Bulk discounts require a valid minimum quantity.');
    const discountRef = await mysql.collection('discounts').add({
      name: payload.name,
      description: payload.description || null,
      type: payload.type,
      value: payload.value,
      bulkMinQty: payload.bulkMinQty || null,
      promoCode: payload.promoCode || null,
      applicableProducts: payload.applicableProducts || [],
      applicableCategories: payload.applicableCategories || [],
      startDate: payload.startDate ? Timestamp.fromDate(payload.startDate) : null,
      endDate: payload.endDate ? Timestamp.fromDate(payload.endDate) : null,
      isActive: true,
      shopId: user.shopId,
      createdAt: Timestamp.now(),
    });

    return { success: true, discountId: discountRef.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function validatePromoCodeAction(payload: {
  sessionProof: string;
  promoCode: string;
  subtotal: number;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    const discountsSnap = await mysql
      .collection('discounts')
      .where('promoCode', '==', payload.promoCode)
      .where('shopId', '==', user.shopId)
      .where('isActive', '==', true)
      .get();

    if (discountsSnap.empty) {
      return { success: false, error: 'Invalid promo code' };
    }

    const discount = discountsSnap.docs[0].data();
    let discountAmount = 0;

    if (discount.type === 'percentage') {
      discountAmount = (payload.subtotal * discount.value) / 100;
    } else if (discount.type === 'fixed') {
      discountAmount = discount.value;
    }

    return {
      success: true,
      discount: {
        id: discountsSnap.docs[0].id,
        name: discount.name,
        type: discount.type,
        value: discount.value,
        discountAmount: Math.min(discountAmount, payload.subtotal),
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============== STORE CREDIT ==============

export async function createStoreCreditAction(payload: {
  sessionProof: string;
  customerId?: string;
  initialAmount: number;
  type: 'store_credit' | 'gift_card';
  expiresAt?: Date;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);

  try {
    if (!Number.isFinite(payload.initialAmount) || payload.initialAmount <= 0) throw new Error('Credit amount must be greater than zero.');
    // Generate unique code
    const code = `SC-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const creditRef = await mysql.collection('store_credits').add({
      code,
      customerId: payload.customerId || null,
      balance: payload.initialAmount,
      initialAmount: payload.initialAmount,
      type: payload.type,
      isActive: true,
      createdAt: Timestamp.now(),
      expiresAt: payload.expiresAt ? Timestamp.fromDate(payload.expiresAt) : null,
      usageHistory: [],
      shopId: user.shopId,
    });

    return { success: true, creditId: creditRef.id, code };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function validateStoreCreditAction(payload: {
  sessionProof: string;
  code: string;
  amount: number;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);

  try {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('Credit redemption amount must be greater than zero.');
    const creditsSnap = await mysql
      .collection('store_credits')
      .where('code', '==', payload.code)
      .where('shopId', '==', user.shopId)
      .limit(1)
      .get();

    if (creditsSnap.empty) {
      return { success: false, error: 'Store credit code not found' };
    }

    const creditDoc = creditsSnap.docs[0];
    const credit = creditDoc.data();

    if (!credit.isActive) {
      return { success: false, error: 'Store credit is no longer active' };
    }

    if (credit.balance < payload.amount) {
      return { success: false, error: `Insufficient balance. Available: R${credit.balance.toFixed(2)}` };
    }

    return { success: true, newBalance: credit.balance - payload.amount };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============== LAYAWAY ==============

export async function createLayawayAction(payload: {
  sessionProof: string;
  customerId: string;
  customerName: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }>;
  scheduledPickupDate?: Date;
  notes?: string;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);

  try {
    if (!payload.customerId || !payload.items.length) throw new Error('A customer and at least one layaway item are required.');
    if (payload.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.price) || item.price < 0)) throw new Error('Layaway item values are invalid.');
    const totalAmount = payload.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const layawayRef = await mysql.collection('layaways').add({
      customerId: payload.customerId,
      customerName: payload.customerName,
      items: payload.items,
      totalAmount,
      paidAmount: 0,
      remainingAmount: totalAmount,
      status: 'pending',
      createdAt: Timestamp.now(),
      scheduledPickupDate: payload.scheduledPickupDate ? Timestamp.fromDate(payload.scheduledPickupDate) : null,
      notes: payload.notes || null,
      payments: [],
      shopId: user.shopId,
    });

    return { success: true, layawayId: layawayRef.id, totalAmount };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function makeLayawayPaymentAction(payload: {
  sessionProof: string;
  layawayId: string;
  paymentAmount: number;
}) {
  const { mysql } = initializeMysqlServer();
  const user = await requireAuth(payload.sessionProof);
  requireManager(user);

  try {
    if (!Number.isFinite(payload.paymentAmount) || payload.paymentAmount <= 0) throw new Error('Layaway payment must be greater than zero.');
    const layawayRef = mysql.collection('layaways').doc(payload.layawayId);
    const layawaySnap = await layawayRef.get();
    const layaway = layawaySnap.data();

    if (!layaway) throw new Error('Layaway not found');
    if (layaway.shopId !== user.shopId) throw new Error('Layaway does not belong to this shop.');
    if (payload.paymentAmount > layaway.remainingAmount) throw new Error('Payment exceeds the remaining layaway balance.');

    const newPaidAmount = layaway.paidAmount + payload.paymentAmount;
    const newRemainingAmount = layaway.totalAmount - newPaidAmount;
    const newStatus = newRemainingAmount <= 0 ? 'completed' : 'pending';

    await layawayRef.update({
      paidAmount: newPaidAmount,
      remainingAmount: Math.max(0, newRemainingAmount),
      status: newStatus,
      payments: FieldValue.arrayUnion({
        amount: payload.paymentAmount,
        date: Timestamp.now(),
      }),
    });

    return {
      success: true,
      paidAmount: newPaidAmount,
      remainingAmount: Math.max(0, newRemainingAmount),
      status: newStatus,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
