# Payment Integration

## Shop setup

Shop owners configure a payment method under **Settings > Payment Setup**. The POS stores the provider name, merchant reference, terminal name, currency, and enabled state. Secret keys are never entered into the browser or stored in a shop document.

## Current checkout behavior

For a physical card machine, the cashier completes the payment on the machine and enters the approval or receipt reference into the POS. The sale stores that reference and the receipt prints it. This supports any South African machine that does not provide an integration API, including bank-issued terminals, Yoco, and iKhokha.

## Provider integration requirements

An automatic integrated payment flow requires a provider-specific agreement and credentials:

- **Stripe Terminal:** Stripe account, Terminal reader, location, connection token endpoint, and server-side payment-intent confirmation.
- **PayFast:** PayFast merchant ID, merchant key, passphrase, return/cancel URLs, and ITN/webhook verification. PayFast is primarily an online checkout gateway, not a universal countertop terminal connector.
- **Paystack:** Paystack public key, secret key, webhook signature verification, and supported merchant settlement configuration. Availability must be confirmed for the shop's country and account.
- **Yoco, iKhokha, SnapScan, or bank terminals:** written API/SDK access from the provider. The exact device model, pairing method, transaction API, callback format, and certification requirements vary by provider.

The application should only enable automatic approval after a provider adapter has been implemented and its webhook or terminal callback has been verified server-side. A UI selection alone must never mark a card payment as approved.

## Production secrets

Provider secrets belong in a server secret manager or deployment environment, never in MySQL shop settings and never in client-side code. Each adapter must implement idempotency, timeout handling, cancellation, webhook signature verification, settlement reconciliation, and a provider transaction ID on the sale.

## PayFast POS subscription setup

Set these server-side environment variables before enabling **Settings > Billing**:

```env
NEXT_PUBLIC_APP_URL=https://your-pos-domain.example
PAYFAST_MERCHANT_ID=your_payfast_merchant_id
PAYFAST_MERCHANT_KEY=your_payfast_merchant_key
PAYFAST_PASSPHRASE=your_payfast_passphrase
PAYFAST_BASE_URL=https://sandbox.payfast.co.za
POS_MONTHLY_FEE_ZAR=550.00
```

Use the PayFast sandbox first. Configure the PayFast ITN/webhook URL as `https://your-pos-domain.example/api/billing/payfast/webhook`. Before going live, switch `PAYFAST_BASE_URL` to `https://www.payfast.co.za`, use live credentials, and verify the production webhook over HTTPS.
