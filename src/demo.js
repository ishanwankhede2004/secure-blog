'use strict';
// Demo content. Used by `npm run seed` and, when SEED_DEMO=1, automatically on
// start-up whenever the blog is empty. That second use matters on hosts whose
// disk is wiped on every restart (such as Render's free tier): the site never
// comes back blank.

const { hashPassword } = require('./security');
const { validateNewPassword } = require('./validate');

const DEMO_POSTS = [
  ['Why we hash passwords, not encrypt them', 'Encryption can be reversed by anyone holding the key. A password hash cannot be reversed at all: the server only checks whether the hash of what you typed matches the stored hash.\n\nGood hashes such as scrypt are deliberately slow and memory-hungry, which makes guessing billions of passwords per second impractical.'],
  ['SQL injection in plain English', 'SQL injection happens when user input is glued into a query string, so a clever input becomes part of the command itself.\n\nThe fix is simple: send the query and the values separately using prepared statements. The database then treats input strictly as data.'],
  ['Cross-site scripting: the stored kind', 'If a blog prints your comment without escaping it, a comment containing a script tag runs in every visitor\'s browser.\n\nEscaping output by default means a script tag is shown as harmless text instead of being executed.'],
  ['What is a CSRF token?', 'A malicious page can make your browser send a request to a site where you are logged in. A CSRF token is a secret value only the real site\'s forms contain, so forged requests are rejected.\n\nCombined with SameSite cookies it closes the door on this whole class of attack.'],
  ['Roles: admins and editors', 'Not everyone should be able to do everything. Editors can write posts and manage their own; admins can manage every post and every user.\n\nChecking the role on the server for every request is what makes this real, hiding a button is not security.'],
  ['Pagination keeps pages fast', 'Loading every post on one page gets slower with each new article. Pagination loads a small slice at a time using LIMIT and OFFSET.\n\nIt also makes long archives easier for readers to browse on a phone.'],
  ['Designing for small screens first', 'Start with the phone layout: one column, large tap targets, readable text. Then add rules for wider screens.\n\nThis mobile-first approach tends to produce simpler, faster pages for everyone.'],
  ['Rate limiting stops brute force', 'An attacker trying thousands of passwords needs thousands of attempts. Limiting login attempts per address makes that unrealistic.\n\nThe limit resets after a successful login so normal users are never affected.'],
  ['Security headers worth having', 'A strict Content-Security-Policy tells the browser which resources a page may load. X-Content-Type-Options stops MIME sniffing, and frame-ancestors prevents clickjacking.\n\nThey cost nothing and add a second line of defence.'],
  ['Sessions, cookies and logging out', 'After login the server hands the browser a random session token in an HttpOnly cookie, so page scripts cannot read it.\n\nOn logout the server deletes the session, so a stolen cookie stops working immediately.'],
  ['Validating input on the server', 'Browser checks are a convenience, not protection: anyone can send a request without a browser. Every length, format and role must be checked again on the server.\n\nReject what is invalid and clean what is kept.'],
  ['Why error messages stay vague', 'A login form that says "wrong password" confirms that the username exists. Saying "invalid username or password" gives an attacker nothing.\n\nThe same idea applies to server errors: log the details privately and show visitors a generic message.'],
  ['Backups are part of security', 'Security is not only about keeping people out. If data is lost or damaged, a recent backup is how you recover.\n\nCopy the database file on a schedule and test restoring it at least once.'],
  ['Testing the unhappy paths', 'Anyone can test that login works with a correct password. The valuable tests try the wrong password, a forged form, a script in a title and a user opening a page they should not see.\n\nAutomate them so they run on every change.'],
];

// Inserts the sample posts, staggered over past days so the archive looks natural.
function insertDemoPosts(store, { adminId, editorId }) {
  const stamp = store.db.prepare(
    "UPDATE posts SET created_at = datetime('now', ?), updated_at = datetime('now', ?) WHERE id = ?",
  );
  DEMO_POSTS.forEach(([title, body], i) => {
    const authorId = editorId && i % 3 === 0 ? editorId : adminId;
    const id = store.createPost({ title, body, authorId });
    const offset = `-${(DEMO_POSTS.length - i) * 2} days`;
    stamp.run(offset, offset, id);
  });
  return DEMO_POSTS.length;
}

// Start-up hook for SEED_DEMO=1: only acts on an empty blog, so it can never
// overwrite real content on a host with a persistent disk.
async function seedDemoContent(store, config, log = console.log) {
  if (store.countPosts('') > 0) return 0;

  const admin = store.getUserByUsername(config.adminUsername)
    || store.listUsers().find((u) => u.role === 'admin');
  if (!admin) return 0;

  let editorId = null;
  if (config.editorPassword) {
    const existing = store.getUserByUsername('editor');
    if (existing) {
      editorId = existing.id;
    } else {
      const check = validateNewPassword(config.editorPassword, 'editor');
      if (check.error) {
        log(`EDITOR_PASSWORD ignored: ${check.error}`);
      } else {
        editorId = store.createUser({
          username: 'editor',
          role: 'editor',
          passwordHash: await hashPassword(config.editorPassword, config.scryptN),
        });
      }
    }
  }

  const added = insertDemoPosts(store, { adminId: admin.id, editorId });
  log(`Demo content restored: ${added} posts${editorId ? ' and an "editor" account' : ''}.`);
  return added;
}

module.exports = { DEMO_POSTS, insertDemoPosts, seedDemoContent };
