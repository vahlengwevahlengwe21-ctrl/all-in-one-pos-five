require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { randomBytes, randomUUID, scrypt: scryptCallback } = require('node:crypto');
const { promisify } = require('node:util');
const { createMysqlPool, readMysqlRecord, writeMysqlRecord } = require('./mysql-support.cjs');

const scrypt = promisify(scryptCallback);
const bootstrapLockName = 'all-in-one-pos-super-admin-bootstrap';
const email = String(process.env.MYSQL_SUPER_ADMIN_EMAIL || 'jeff@gmail.com').trim().toLowerCase();
const password = process.env.MYSQL_SUPER_ADMIN_PASSWORD;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Set MYSQL_SUPER_ADMIN_EMAIL to a valid email address.');
}
if (!password || password.length < 10) {
  throw new Error('Set MYSQL_SUPER_ADMIN_PASSWORD to a password of at least 10 characters.');
}

async function main() {
  const pool = createMysqlPool(1);
  const connection = await pool.getConnection();
  let hasBootstrapLock = false;
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [bootstrapLockName]);
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error('Unable to acquire the super administrator setup lock.');
    }
    hasBootstrapLock = true;

    const [roles] = await connection.execute(
      "SELECT path FROM app_records WHERE path LIKE 'roles_super_admin/%'",
    );
    let userId;
    let profilePath;
    const isFirstSetup = roles.length === 0;

    if (isFirstSetup) {
      const [[recordCount]] = await connection.execute('SELECT COUNT(*) AS count FROM app_records');
      const [[credentialCount]] = await connection.execute('SELECT COUNT(*) AS count FROM user_credentials');
      if (Number(recordCount.count) !== 0 || Number(credentialCount.count) !== 0) {
        throw new Error('Refusing first-admin setup because the database already contains application data.');
      }
      userId = randomUUID();
      profilePath = `users/${userId}`;
    } else {
      if (roles.length !== 1) {
        throw new Error(`Expected at most one existing super administrator role, found ${roles.length}.`);
      }
      userId = roles[0].path.slice('roles_super_admin/'.length);
      profilePath = `users/${userId}`;
      const profile = await readMysqlRecord(connection, profilePath);
      if (!profile?.email) throw new Error('The existing super administrator profile has no email address.');
      if (String(profile.email).trim().toLowerCase() !== email) {
        throw new Error('The existing super administrator role is not assigned to the requested account.');
      }
    }

    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');

    await connection.beginTransaction();
    try {
      await connection.execute(
        `INSERT INTO user_credentials (user_id, email, password_hash, password_salt)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash), password_salt = VALUES(password_salt)`,
        [userId, email, hash, salt],
      );
      const profile = {
        ...(isFirstSetup ? {
          id: userId,
          name: email.split('@')[0],
          surname: '',
          email,
        } : {}),
        role: 'super administrator',
        hiddenFromUserList: true,
        mustChangePassword: true,
      };
      await writeMysqlRecord(connection, profilePath, profile, !isFirstSetup);
      await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
      await writeMysqlRecord(connection, `roles_admin/${userId}`, {});
      await writeMysqlRecord(connection, `roles_super_admin/${userId}`, {});
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(isFirstSetup
      ? 'Initial MySQL super administrator created. Sign in and change this password immediately.'
      : 'MySQL super administrator credentials are configured. Sign in and change this password immediately.');
  } finally {
    if (hasBootstrapLock) {
      await connection.execute('SELECT RELEASE_LOCK(?)', [bootstrapLockName]);
    }
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Unable to configure MySQL super administrator:', error.message);
  process.exitCode = 1;
});
