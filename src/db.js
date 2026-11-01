'use strict';
// Database layer: SQLite via Node's built-in node:sqlite module (no external packages needed).
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { hashPassword, validatePassword } = require('./security');

const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, '..', 'db', 'agriconnect.sqlite');
const CATEGORIES = [
  ['Vegetables', 'Fresh vegetables and leafy greens'],
  ['Fruits', 'Seasonal fresh fruits'],
  ['Cereals', 'Maize, rice, wheat and other grains'],
  ['Poultry', 'Poultry products including eggs and chicken'],
];

function open(file = DB_FILE) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_migrations (
    migration TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  ensureCategories(db);
  activateExistingFarmers(db);
  seed(db);
  return db;
}

function activateExistingFarmers(db) {
  const migration = 'activate-farmers-without-approval';
  if (db.prepare('SELECT 1 FROM app_migrations WHERE migration = ?').get(migration)) return;
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET approved = 1 WHERE role = 'farmer' AND approved = 0").run();
    db.prepare('INSERT INTO app_migrations (migration) VALUES (?)').run(migration);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureCategories(db) {
  db.exec('BEGIN');
  try {
    const addCategory = db.prepare('INSERT OR IGNORE INTO categories (name,description) VALUES (?,?)');
    CATEGORIES.forEach((category) => addCategory.run(...category));
    const categoryId = (name) => db.prepare('SELECT category_id FROM categories WHERE name = ?').get(name).category_id;
    for (const [oldName, replacement] of [['Legumes', 'Cereals'], ['Tubers', 'Vegetables']]) {
      const old = db.prepare('SELECT category_id FROM categories WHERE name = ?').get(oldName);
      if (!old) continue;
      db.prepare('UPDATE produce SET category_id = ? WHERE category_id = ?').run(categoryId(replacement), old.category_id);
      db.prepare('DELETE FROM categories WHERE category_id = ?').run(old.category_id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  // Secrets come from the environment, never from source code. The fallback is for local development only.
  let adminPw = process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production') {
    const problem = !adminPw ? 'is not set' : /change-?me/i.test(adminPw) ? 'is still the placeholder from .env.example' : validatePassword(adminPw) && `is not strong enough (${validatePassword(adminPw)})`;
    if (problem) throw new Error(`ADMIN_PASSWORD ${problem}. Set a strong value in the hosting dashboard (see README).`);
  } else if (!adminPw) adminPw = 'Admin@1234';
  const demoPw = 'Demo@1234';
  const addUser = db.prepare(`INSERT INTO users
    (full_name,email,password_hash,role,phone,location,farm_name,bio,approved)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  addUser.run('System Administrator', 'admin@agriconnect.co.ke', hashPassword(adminPw), 'admin', '0700000000', 'Nairobi', null, null, 1);
  addUser.run('Wanjiru Kamau', 'wanjiru@farm.co.ke', hashPassword(demoPw), 'farmer', '0711000111', 'Kiambu', 'Wanjiru Greens',
    'Third-generation vegetable farmer supplying fresh greens and tomatoes to Nairobi.', 1);
  addUser.run('Otieno Odhiambo', 'otieno@farm.co.ke', hashPassword(demoPw), 'farmer', '0722000222', 'Kisumu', 'Lakeview Farm',
    'Fruit, cereal and poultry farmer near Lake Victoria.', 1);
  addUser.run('Chebet Rotich', 'chebet@farm.co.ke', hashPassword(demoPw), 'farmer', '0733000333', 'Nakuru', 'Rift Valley Dairy and Crops',
    'Mixed farm: maize, beans and potatoes.', 1);
  addUser.run('Grace Hotel Supplies', 'buyer@hotel.co.ke', hashPassword(demoPw), 'buyer', '0744000444', 'Nairobi', null, null, 1);

  const categoryId = (name) => db.prepare('SELECT category_id FROM categories WHERE name = ?').get(name).category_id;

  const addProduce = db.prepare(`INSERT INTO produce
    (farmer_id,category_id,name,description,price,unit,quantity,location) VALUES (?,?,?,?,?,?,?,?)`);
  addProduce.run(2, categoryId('Vegetables'), 'Tomatoes', 'Fresh vine-ripened tomatoes harvested daily.', 120, 'kg', 250, 'Kiambu');
  addProduce.run(2, categoryId('Vegetables'), 'Kale (Sukuma Wiki)', 'Tender kale, washed and bundled.', 40, 'bunch', 400, 'Kiambu');
  addProduce.run(2, categoryId('Vegetables'), 'Red Onions', 'Dry red onions, well cured.', 90, 'kg', 300, 'Kiambu');
  addProduce.run(3, categoryId('Fruits'), 'Avocados (Hass)', 'Creamy Hass avocados for export grade.', 25, 'piece', 1000, 'Kisumu');
  addProduce.run(3, categoryId('Fruits'), 'Mangoes', 'Sweet Apple mangoes.', 15, 'piece', 800, 'Kisumu');
  addProduce.run(3, categoryId('Cereals'), 'Maize (dry)', 'Dry shelled white maize.', 55, 'kg', 5000, 'Kisumu');
  addProduce.run(3, categoryId('Cereals'), 'Green Grams', 'Clean green grams (ndengu).', 150, 'kg', 600, 'Kisumu');
  addProduce.run(2, categoryId('Vegetables'), 'Irish Potatoes', 'Shangi variety potatoes.', 60, 'kg', 900, 'Kiambu');
  addProduce.run(3, categoryId('Poultry'), 'Free-range eggs', 'Fresh eggs from free-range hens.', 25, 'piece', 500, 'Kisumu');
}

module.exports = { open, DB_FILE };
