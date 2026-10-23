# All In One POS

The POS uses MySQL for application data, account credentials, and login sessions.
# MySQL configuration

The deployment requires `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and
`DB_NAME` environment variables. TLS certificate validation is enabled by
default. For a private certificate authority, provide its PEM contents through
`DB_SSL_CA` (newlines may be encoded as `\n`). Do not commit database
credentials or private keys.

To route database operations through the dedicated LXC 105 POS gateway, set
`DB_GATEWAY_URL=https://pos-db-api.allinonesolution.uk` and `DB_GATEWAY_TOKEN`
in the Vercel project's production environment. Deploy the POS gateway service
and its SQL allowlist before enabling these variables. Keep the token in
deployment secrets; leave the gateway URL empty to retain direct MySQL
connectivity.

To initialize the existing super administrator, temporarily set
`MYSQL_SUPER_ADMIN_PASSWORD` to a new password of at least 10 characters and run
`npm run create:super-admin`; remove the variable after success. The first
sign-in requires setting a new permanent password. Existing external-provider
passwords are not portable to MySQL, so an administrator must set initial
passwords for other existing accounts.
