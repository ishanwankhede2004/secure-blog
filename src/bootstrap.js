'use strict';
// First-run setup: if the database has no users, create the initial admin.

const crypto = require('node:crypto');
const { hashPassword } = require('./security');
const { validateNewPassword } = require('./validate');

async function ensureAdmin(store, config, log = console.log) {
  if (store.countUsers() > 0) return false;

  const username = config.adminUsername;
  let password = config.adminPassword;
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  } else {
    const check = validateNewPassword(password, username);
    if (check.error) throw new Error(`ADMIN_PASSWORD rejected: ${check.error}`);
  }

  store.createUser({
    username,
    passwordHash: await hashPassword(password, config.scryptN),
    role: 'admin',
  });

  if (generated) {
    log(`First run: created admin "${username}" with a generated password:\n\n    ${password}\n\n` +
        'Log in and change it on the Account page. Set ADMIN_PASSWORD to choose your own next time.');
  } else {
    log(`First run: created admin "${username}" using ADMIN_PASSWORD.`);
  }
  return true;
}

module.exports = { ensureAdmin };
