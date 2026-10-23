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

Run `npm run db:check` to test the configured connection. Existing user profiles
were migrated to MySQL, but passwords from the previous identity provider cannot
be transferred. To initialize
the existing super administrator, temporarily set `MYSQL_SUPER_ADMIN_PASSWORD`
in `.env.local` to a new password of at least 10 characters and run
`npm run create:super-admin`. Remove that variable after the script succeeds.
The first sign-in requires choosing a new permanent password. Other existing
users need an administrator to set an initial password on their user profile;
new accounts are created with an initial password set by their administrator.
Use a secure channel to share initial passwords.

Keep the MySQL connection variables configured on every deployment.

To get started, take a look at src/app/page.tsx.
