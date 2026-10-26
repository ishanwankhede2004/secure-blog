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

// Topic for each sample article; anything not listed is filed under Security.
const DEMO_CATEGORY = {
  'Roles: admins and editors': 'Web Development',
  'Pagination keeps pages fast': 'Web Development',
  'Designing for small screens first': 'Web Development',
  'Validating input on the server': 'Web Development',
  'Testing the unhappy paths': 'Ideas',
  'Backups are part of security': 'Ideas',
  'Why error messages stay vague': 'Ideas',
};

// Internship diary: one post per task, dated across the internship
// (25 May 2026 to 9 July 2026). Written as a factual record of what each task built.
const INTERNSHIP_START = Date.UTC(2026, 4, 25); // 25 May 2026
const DAY_MS = 24 * 60 * 60 * 1000;

const DIARY_POSTS = [
  {
    day: 0,
    title: 'Task 1: Setting up the project environment',
    body: 'The first task was to prepare everything the blog needs before writing any features. I set up a Node.js project with a clear folder layout: src for the application code, public for the stylesheet, scripts for helper tools and test for the automated tests.\n\nThe data lives in a SQLite database, which is a single file and needs no separate database server. The server has a small health page at /healthz so a hosting service can check that the app is running, and the code is kept in a GitHub repository.\n\nWhat I learned: a tidy structure and a working start-up command on day one make every later task easier, because new features have an obvious place to go.',
  },
  {
    day: 11,
    title: 'Task 2: Search, pagination and a mobile-friendly design',
    body: 'The second task made the blog usable with lots of posts. Search looks through both titles and post text and ignores capital letters, and special characters such as the percent sign are treated as ordinary text. Pagination shows six posts per page with Previous and Next links and page numbers, and the search word is kept when you move between pages.\n\nFor styling I designed for phones first: one column, large buttons that are easy to tap, readable text and a layout that adapts on wider screens. It also follows the visitor\'s light or dark setting.\n\nWhat I learned: a page that works well on a small screen is usually simpler and faster on every screen.',
  },
  {
    day: 22,
    title: 'Task 3: Login, roles and creating, editing and deleting posts',
    body: 'This task added accounts and the full create, read, update and delete cycle for posts. Passwords are never stored as typed: each one is turned into a salted scrypt hash, and login compares hashes. After login the server issues a random session token in a protected cookie, and logging out destroys it.\n\nThere are two roles. Editors can write posts and change or delete only their own. Admins can manage every post and also add users, change roles and reset passwords. There is no public sign-up, so only an admin can create accounts. The server checks the role on every request, because hiding a button is not real security.\n\nWhat I learned: permissions must be enforced on the server, not just in the page.',
  },
  {
    day: 34,
    title: 'Task 4: Making the blog secure',
    body: 'The fourth task protected the app against common attacks and bad input. Database queries use prepared statements, so input can never rewrite a query. Everything shown on a page is escaped, so a script typed into a title appears as plain text instead of running. Every form carries a secret token to stop forged requests, and logins are rate limited to slow down password guessing.\n\nThe server also checks the length and format of every field, strips unwanted control characters, sends strict security headers, and shows generic error messages that give nothing away. A set of automated tests tries these attacks on purpose and checks that they fail.\n\nWhat I learned: assume every input is hostile, and test the unhappy paths as carefully as the happy ones.',
  },
  {
    day: 45,
    title: 'Task 5: Building, testing and going live',
    body: 'The final task was to build, test and publish the finished project. The automated suite of 20 end-to-end tests covers login, roles, create, edit and delete, search, pagination and the security protections. I also wrote a check script that exercises a running copy of the site.\n\nThe app is hosted on Render straight from the GitHub repository and starts with a single command. The free plan sleeps when nobody visits and clears its database on restart, so the blog restores its sample posts and logins automatically each time it starts.\n\nWhat I learned: a project is only finished when it runs somewhere other than my own computer and I have tested it there.',
  },
];

const pad = (n) => String(n).padStart(2, '0');
function stampFor(dayOffset, hour) {
  const d = new Date(INTERNSHIP_START + dayOffset * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(hour)}:00:00`;
}

// Inserts the internship diary plus the sample articles. All 19 posts are dated
// inside the internship window so the blog reads as one timeline.
function insertDemoPosts(store, { adminId, editorId }) {
  const stamp = store.db.prepare('UPDATE posts SET created_at = ?, updated_at = ? WHERE id = ?');

  DIARY_POSTS.forEach(({ title, body, day }) => {
    const id = store.createPost({ title, body, category: 'Internship Diary', authorId: adminId });
    const when = stampFor(day, 10);
    stamp.run(when, when, id);
  });

  DEMO_POSTS.forEach(([title, body], i) => {
    const authorId = editorId && i % 3 === 0 ? editorId : adminId;
    const id = store.createPost({ title, body, category: DEMO_CATEGORY[title] || 'Security', authorId });
    const when = stampFor(1 + Math.round((i * 43) / (DEMO_POSTS.length - 1)), 15);
    stamp.run(when, when, id);
  });

  return DIARY_POSTS.length + DEMO_POSTS.length;
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

module.exports = { DEMO_POSTS, DIARY_POSTS, insertDemoPosts, seedDemoContent };
