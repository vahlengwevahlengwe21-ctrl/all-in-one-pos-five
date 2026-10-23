
'use server';

import { initializeMysqlServer } from '@/lib/mysql-auth-server';

function isProtectedSuperAdmin(role?: string) {
  return role === 'super administrator';
}

async function requireAdmin(sessionProof: string) {
  const { auth, mysql } = initializeMysqlServer();
  if (!sessionProof) throw new Error('Authentication token is missing.');
  const decoded = await auth.verifySessionProof(sessionProof);
  const role = await mysql.collection('roles_admin').doc(decoded.uid).get();
  if (!role.exists) throw new Error('Only shop owners and the super administrator can manage users.');
  return { auth, mysql };
}

interface CreateUserPayload {
  email: string;
  name: string;
  surname: string;
  role: 'shop owner' | 'sales';
  displayName?: string;
  sessionProof: string;
  shopId?: string;
  password: string;
}

export async function createUserAction(
  payload: CreateUserPayload
): Promise<{ success: boolean; uid?: string; error?: string }> {
  try {
    const { auth: adminAuth, mysql } = await requireAdmin(payload.sessionProof);
    const decoded = await adminAuth.verifySessionProof(payload.sessionProof);
    const creatorProfile = await mysql.collection('users').doc(decoded.uid).get();
    const creatorData = creatorProfile.data();
    const shopId = creatorData?.role === 'shop owner' ? creatorData.shopId : payload.shopId;
    if (creatorData?.role === 'shop owner' && (!shopId || payload.shopId !== shopId)) {
      throw new Error('Shop owners can only add users to their own shop.');
    }
    if (shopId) {
      const shop = await mysql.collection('shops').doc(shopId).get();
      const maxUsersAllowed = shop.data()?.maxUsersAllowed;
      if (!shop.exists || !Number.isInteger(maxUsersAllowed) || maxUsersAllowed < 1) {
        throw new Error('Shop subscription is not configured.');
      }
      const users = await mysql.collection('users').where('shopId', '==', shopId).get();
      if (users.size >= maxUsersAllowed) {
        throw new Error(`This shop has reached its limit of ${maxUsersAllowed} user accounts.`);
      }
    }
    const userRecord = await adminAuth.createUser({
      email: payload.email,
      displayName: payload.displayName,
      password: payload.password,
    });

    try {
      const now = new Date();
      const profileRef = mysql.collection('users').doc(userRecord.uid);
      const roleRef = mysql.collection('roles_admin').doc(userRecord.uid);
      await mysql.runTransaction(async (transaction) => {
        transaction.create(profileRef, {
          id: userRecord.uid,
          name: payload.name.trim(),
          surname: payload.surname.trim(),
          email: payload.email.trim().toLowerCase(),
          role: payload.role,
          shopId: shopId || null,
          mustChangePassword: true,
          createdAt: now,
        });
        if (payload.role === 'shop owner') {
          transaction.set(roleRef, { shopId: shopId || null, createdAt: now });
        }
      });
    } catch (profileError) {
      await adminAuth.deleteUser(userRecord.uid).catch(() => undefined);
      throw profileError;
    }
    return { success: true, uid: userRecord.uid };
  } catch (error: any) {
    console.error('Failed to create user:', error);
    let errorMessage = 'An unexpected error occurred during user creation.';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'A user with this email address already exists.';
    } else if (error.code === 'auth/invalid-password') {
      errorMessage = 'The password must contain at least 10 characters.';
    } else if (error.code === 'auth/invalid-phone-number') {
        errorMessage = 'The phone number must be a valid E.164 standard compliant identifier (e.g., +11234567890).';
    } else if (error.message) {
        errorMessage = error.message;
    }
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function deleteUserAction(
  payload: { userId: string; sessionProof: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { auth: adminAuth, mysql: adminMysql } = await requireAdmin(payload.sessionProof);
    const { userId } = payload;

    await adminAuth.getUser(userId);
    const targetProfile = await adminMysql.collection('users').doc(userId).get();
    if (isProtectedSuperAdmin(targetProfile.data()?.role)) {
      throw new Error('The protected super administrator cannot be deleted.');
    }
    
    await adminAuth.deleteUser(userId);
    const userDocRef = adminMysql.collection('users').doc(userId);
    await userDocRef.delete();

    const adminRoleDocRef = adminMysql.collection('roles_admin').doc(userId);
    await adminRoleDocRef.delete();

    return { success: true };
  } catch (error: any) {
    console.error('Failed to delete user:', error);
    // Provide a more generic error message to the client for security.
    return {
      success: false,
      error: 'An error occurred while deleting the user. This may be due to insufficient permissions.',
    };
  }
}


interface UpdateUserPayload {
  userId: string;
  sessionProof: string;
  name: string;
  surname: string;
  role: 'shop owner' | 'super administrator' | 'sales';
  password?: string;
}

export async function updateUserAction(
  payload: UpdateUserPayload
): Promise<{ success: boolean; error?: string }> {
  const { userId, name, surname, role } = payload;

  try {
    const { auth: adminAuth, mysql: adminMysql } = await requireAdmin(payload.sessionProof);
    if (role === 'super administrator') {
      throw new Error('Only the protected super administrator account may have this role.');
    }

    await adminAuth.getUser(userId);
    const targetProfile = await adminMysql.collection('users').doc(userId).get();
    if (isProtectedSuperAdmin(targetProfile.data()?.role)) {
      throw new Error('The protected super administrator cannot be changed.');
    }
    
    const userDocRef = adminMysql.collection('users').doc(userId);
    const adminRoleDocRef = adminMysql.collection('roles_admin').doc(userId);

    if (payload.password !== undefined && payload.password.length < 10) {
      throw new Error('Password must contain at least 10 characters.');
    }
    await adminAuth.updateUser(userId, {
      displayName: `${name} ${surname}`,
      ...(payload.password ? { password: payload.password, revokeSessions: true } : {}),
    });

    await userDocRef.update({
      name,
      surname,
      role,
      ...(payload.password ? { mustChangePassword: true } : {}),
    });

    // Manage admin role in the roles_admin collection
    if (role === 'shop owner') {
      // Add user to admin roles if not already there
      await adminRoleDocRef.set({});
    } else {
      // Remove user from admin roles if they exist
      await adminRoleDocRef.delete();
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to update user:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred during user update.',
    };
  }
}

export async function completePasswordSetupAction(payload: {
  sessionProof: string;
  password: string;
}) {
  try {
    const { auth, mysql } = initializeMysqlServer();
    if (!payload.sessionProof) throw new Error('Authentication token is missing.');
    const decoded = await auth.verifySessionProof(payload.sessionProof);
    if (payload.password.length < 10) throw new Error('Password must contain at least 10 characters.');
    await auth.updateUser(decoded.uid, { password: payload.password });
    await mysql.collection('users').doc(decoded.uid).update({ mustChangePassword: false });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to update password.' };
  }
}
