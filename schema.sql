CREATE TABLE IF NOT EXISTS users (
    user_id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('farmer', 'buyer', 'admin') NOT NULL,
    location VARCHAR(150) DEFAULT NULL,
    PRIMARY KEY (user_id),
    UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
    category_id INT NOT NULL AUTO_INCREMENT,
    category_name VARCHAR(100) NOT NULL,
    PRIMARY KEY (category_id),
    UNIQUE KEY categories_name_unique (category_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO categories (category_name)
VALUES ('Vegetables'), ('Grains'), ('Fruits');

CREATE TABLE IF NOT EXISTS produce (
    produce_id INT NOT NULL AUTO_INCREMENT,
    farmer_id INT NOT NULL,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    photo VARCHAR(255) DEFAULT NULL,
    location VARCHAR(150) DEFAULT NULL,
    PRIMARY KEY (produce_id),
    KEY produce_farmer_idx (farmer_id),
    KEY produce_category_idx (category_id),
    CONSTRAINT produce_farmer_fk
        FOREIGN KEY (farmer_id) REFERENCES users (user_id),
    CONSTRAINT produce_category_fk
        FOREIGN KEY (category_id) REFERENCES categories (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
    order_id INT NOT NULL AUTO_INCREMENT,
    buyer_id INT NOT NULL,
    order_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status ENUM('Placed', 'Confirmed', 'Dispatched', 'Delivered')
        DEFAULT 'Placed',
    PRIMARY KEY (order_id),
    KEY orders_buyer_idx (buyer_id),
    CONSTRAINT orders_buyer_fk
        FOREIGN KEY (buyer_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    produce_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (order_item_id),
    KEY order_items_order_idx (order_id),
    KEY order_items_produce_idx (produce_id),
    CONSTRAINT order_items_order_fk
        FOREIGN KEY (order_id) REFERENCES orders (order_id),
    CONSTRAINT order_items_produce_fk
        FOREIGN KEY (produce_id) REFERENCES produce (produce_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
