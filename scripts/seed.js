'use strict';
// Demo data for screenshots and demo videos:  npm run seed
// Creates an admin, an editor and 14 sample posts (3 pages at 6 per page).
// Passwords are random unless DEMO_PASSWORD is set, and are printed once.

const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createStore } = require('../src/db');
const { hashPassword } = require('../src/security');
const { insertDemoPosts } = require('../src/demo');

async function main() {
  const config = loadConfig();
  const store = createStore(config.dbFile);
  const password = process.env.DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');

  const ensure = async (username, role) => {
    const existing = store.getUserByUsername(username);
    if (existing) return { id: existing.id, created: false };
    const id = store.createUser({
      username, role, passwordHash: await hashPassword(password, config.scryptN),
    });
    return { id, created: true };
  };

  const admin = await ensure('admin', 'admin');
  const editor = await ensure('editor', 'editor');

  let added = 0;
  if (store.countPosts('') === 0) {
    added = insertDemoPosts(store, { adminId: admin.id, editorId: editor.id });
  }

  console.log(`Seed complete: ${added} posts added.`);
  if (admin.created || editor.created) {
    console.log('\nDemo logins (shown once):');
    if (admin.created) console.log(`  admin  / ${password}`);
    if (editor.created) console.log(`  editor / ${password}`);
  } else {
    console.log('Users already existed, so passwords were left unchanged.');
  }
  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
