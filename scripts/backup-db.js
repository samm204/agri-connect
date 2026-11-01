'use strict';
// Consistent online backup of the SQLite database (safe while the app is running).
// Usage: npm run backup [-- <destination-folder>]        Keeps the newest 14 backups.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const source = process.env.DATABASE_FILE || path.join(__dirname, '..', 'db', 'agriconnect.sqlite');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backups'));
if (!fs.existsSync(source)) { console.error(`Database not found: ${source}`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `agriconnect-${stamp}.sqlite`);
const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);   // consistent snapshot, no locking of readers
db.close();

// verify the backup opens and has data
const check = new DatabaseSync(target, { readOnly: true });
const users = check.prepare('SELECT COUNT(*) n FROM users').get().n;
const ok = check.prepare('PRAGMA integrity_check').get().integrity_check;
check.close();
console.log(`Backup written: ${target} (${users} users, integrity: ${ok})`);

const old = fs.readdirSync(dir).filter((f) => /^agriconnect-.*\.sqlite$/.test(f)).sort().reverse().slice(14);
old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
if (old.length) console.log(`Removed ${old.length} old backup(s).`);
