require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { randomBytes, scrypt: scryptCallback } = require('node:crypto');
const { promisify } = require('node:util');
const { createMysqlPool, readMysqlRecord, writeMysqlRecord } = require('./mysql-support.cjs');

const scrypt = promisify(scryptCallback);
const expectedSuperAdminEmail = 'jeff@gmail.com';
const password = process.env.MYSQL_SUPER_ADMIN_PASSWORD;

if (!password || password.length < 10) {
  throw new Error('Set MYSQL_SUPER_ADMIN_PASSWORD to a password of at least 10 characters.');
}

async function main() {
  const pool = createMysqlPool(1);
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS auth_login_attempts (
        attempt_key char(64) NOT NULL PRIMARY KEY,
        failed_attempts int unsigned NOT NULL DEFAULT 0,
        window_started_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY idx_auth_login_window (window_started_at)
      ) ENGINE=InnoDB`,
    );
    const [roles] = await connection.execute(
      "SELECT path FROM app_records WHERE path LIKE 'roles_super_admin/%'",
    );
    if (roles.length !== 1) {
      throw new Error(`Expected one existing super administrator role, found ${roles.length}.`);
    }
    const userId = roles[0].path.slice('roles_super_admin/'.length);
    const profilePath = `users/${userId}`;
    const profile = await readMysqlRecord(connection, profilePath);
    if (!profile?.email) throw new Error('The existing super administrator profile has no email address.');

    const email = String(profile.email).trim().toLowerCase();
    if (email !== expectedSuperAdminEmail) {
      throw new Error('The existing super administrator role is not assigned to the requested account.');
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
      await writeMysqlRecord(connection, profilePath, {
        role: 'super administrator',
        hiddenFromUserList: true,
        mustChangePassword: true,
      });
      await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
      await writeMysqlRecord(connection, `roles_admin/${userId}`, {});
      await writeMysqlRecord(connection, `roles_super_admin/${userId}`, {});
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log('MySQL super administrator credentials are configured. Sign in with the existing account email and change this password after the first login.');
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Unable to configure MySQL super administrator:', error.message);
  process.exitCode = 1;
});
