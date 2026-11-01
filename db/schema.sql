-- AgriConnect database schema (SQLite)
-- Entities: Users, Categories, Produce, Orders, Order_Items

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,                       -- scrypt hash, never plain text
  role           TEXT    NOT NULL CHECK (role IN ('farmer','buyer','admin')),
  phone          TEXT,
  location       TEXT,
  farm_name      TEXT,                                   -- farmers only
  bio            TEXT,                                   -- farmer profile text
  approved       INTEGER NOT NULL DEFAULT 0,             -- farmers need admin approval
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  category_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  description    TEXT
);

CREATE TABLE IF NOT EXISTS produce (
  produce_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(category_id),
  name           TEXT    NOT NULL,
  description    TEXT,
  price          REAL    NOT NULL CHECK (price > 0),     -- KES per unit
  unit           TEXT    NOT NULL DEFAULT 'kg',
  quantity       INTEGER NOT NULL CHECK (quantity >= 0), -- stock available
  location       TEXT,
  photo_url      TEXT,
  approved       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  order_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id       INTEGER NOT NULL REFERENCES users(user_id),
  status         TEXT    NOT NULL DEFAULT 'Placed'
                 CHECK (status IN ('Placed','Confirmed','Dispatched','Delivered')),
  delivery_address TEXT  NOT NULL,
  total          REAL    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  item_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  produce_id     INTEGER NOT NULL REFERENCES produce(produce_id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price     REAL    NOT NULL                        -- price snapshot at order time
);

CREATE INDEX IF NOT EXISTS idx_produce_category ON produce(category_id);
CREATE INDEX IF NOT EXISTS idx_produce_farmer   ON produce(farmer_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer     ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_items_order      ON order_items(order_id);
