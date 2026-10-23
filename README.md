# All In One POS

## MySQL application data

The application uses MySQL for POS data, account credentials, and expiring login
sessions. Passwords are stored as scrypt hashes; session tokens are held in
HttpOnly cookies and session hashes are stored in MySQL. Client data subscriptions
refresh from MySQL every five seconds.

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `.env.local`
for local development. `DB_SSL` defaults to enabled; set it to `false` only if
the MySQL server does not support TLS. If the server uses a private CA, set
`DB_SSL_CA` to its PEM certificate, with line breaks encoded as `\n`. Never
commit real database credentials or private keys.

Run `npm run db:check` to test the configured connection. For the public
Vercel deployment, bootstrap the first administrator through
`/setup-super-admin`. Set `MYSQL_SUPER_ADMIN_EMAIL` and a high-entropy
`MYSQL_SUPER_ADMIN_SETUP_TOKEN` as Vercel Production environment variables,
then deploy. Generate the token locally with
`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`.
Open the setup page over HTTPS and enter that token and the administrator's
password there; do not put either secret in a URL or chat. The endpoint requires
a same-origin request and refuses to proceed if a user, administrator role, or
setup marker already exists. After successful setup, remove
`MYSQL_SUPER_ADMIN_SETUP_TOKEN` from Vercel and redeploy.

The local `npm run create:super-admin` utility requires direct database
credentials that point to the intended database; verify `DB_NAME` before
running it. Passwords from a previous identity provider cannot be transferred.
Other accounts need an administrator to set initial passwords.

Keep the MySQL connection variables configured on every deployment.

## Optional database gateway

The Vercel-hosted POS can use a dedicated HTTPS database gateway on LXC 105.
The separate service uses the existing database gateway's connection settings,
but has its own token and port so it does not alter the current
`db-api.allinonesolution.uk` service. Its `/pos` API enforces a query-hash
allowlist and supports server-managed MySQL transactions.

Deploy the service from `scripts/pos-db-gateway.mjs`, the matching
`scripts/db-gateway-pos-routes.mjs`, and the generated
`scripts/db-gateway-pos-allowlist.json`. Generate the allowlist with
`npm run db:gateway-allowlist`. Use `deploy/pos-db-gateway.service` as the
systemd template and configure a separate `POS_DB_GATEWAY_TOKEN` secret for
that service. For safer secret storage, the gateway can instead verify
`POS_DB_GATEWAY_TOKEN_SHA256`, a 64-character SHA-256 digest of the bearer
token; configure either the raw token or its digest, not both.

Add a Cloudflare Tunnel published-application route for
`pos-db-api.allinonesolution.uk` to `http://172.17.0.1:8788`. Verify
`https://pos-db-api.allinonesolution.uk/healthz`, then set
`DB_GATEWAY_URL=https://pos-db-api.allinonesolution.uk` and
`DB_GATEWAY_TOKEN` in the Vercel project's production environment. The app
continues to be served by Vercel; `pos.allinonesolution.uk` is not used as its
deployment host. Keep the token secret and do not commit it. Leave
`DB_GATEWAY_URL` empty to use a direct MySQL connection.

For a fresh POS database, create an empty database and a dedicated account with
only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on that database.
Initialize its tables with `scripts/pos-fresh-schema.sql` using an administrator
connection. Configure the gateway to connect to the database's private IP and
set `DB_SSL_SERVERNAME` to the trusted certificate hostname when it differs
from that IP. Keep `DB_SSL_CA` validation enabled.

To get started, take a look at src/app/page.tsx.
