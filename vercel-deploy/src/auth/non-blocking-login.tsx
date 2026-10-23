'use client';

export async function initiateEmailSignIn(email: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
  window.dispatchEvent(new Event('mysql-auth-changed'));
  return result;
}

export async function initiateSignOut() {
  const response = await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Unable to sign out.');
  window.dispatchEvent(new Event('mysql-auth-changed'));
}
