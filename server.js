
require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "Public")));

// Validate server configuration
if (!process.env.JWT_SECRET) {
    console.error("Warning: JWT_SECRET is missing from .env");
}

// Health check
app.get("/api/health", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            status: "success",
            message: "AgriConnect backend and database connected!"
        });
    } catch (error) {
        console.error("Health check error:", error.message);

        res.status(500).json({
            status: "error",
            message: "Database connection failed."
        });
    }
});

// Register a new user
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 100 ||
            typeof email !== "string" ||
            !email.trim() ||
            email.trim().length > 150 ||
            typeof password !== "string" ||
            !["farmer", "buyer"].includes(role)
        ) {
            return res.status(400).json({
                message: "Enter a valid name, email, password and role."
            });
        }

        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({
                message: "Password must contain 8 to 72 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.execute(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES (?, ?, ?, ?)`,
            [name.trim(), normalizedEmail, passwordHash, role]
        );

        res.status(201).json({
            message: "Registration successful!",
            user_id: result.insertId
        });
    } catch (error) {
        console.error("Registration error:", error.message);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This email is already registered."
            });
        }

        res.status(500).json({
            message: "Registration failed. Please check the server and database."
        });
    }
});

// Log in an existing user
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            !email.trim() ||
            typeof password !== "string" ||
            !password
        ) {
            return res.status(400).json({
                message: "Please enter your email and password."
            });
        }

        const [users] = await db.execute(
            `SELECT user_id, name, email, password_hash, role
             FROM users
             WHERE email = ?`,
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];
        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is missing from .env");

            return res.status(500).json({
                message: "Server authentication is not configured."
            });
        }

        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({
            message: "Login successful!",
            token,
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);

        res.status(500).json({
            message: "Login failed. Please try again."
        });
    }
});

// Authenticate requests using a valid JWT
async function authenticateUser(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                message: "Please log in first."
            });
        }

        if (!process.env.JWT_SECRET) {
            return res.status(500).json({
                message: "Server authentication is not configured."
            });
        }

        const token = authHeader.slice(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await db.execute(
            `SELECT user_id, name, role
             FROM users
             WHERE user_id = ?`,
            [decoded.user_id]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Your account could not be found. Please log in again."
            });
        }

        req.user = users[0];
        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError") {
            return res.status(401).json({
                message: "Your login session is invalid or expired. Please log in again."
            });
        }

        console.error("Authentication error:", error.message);

        res.status(500).json({
            message: "Could not verify your login session."
        });
    }
}

// Get available produce categories
app.get("/api/categories", async (req, res) => {
    try {
        const [categories] = await db.execute(
            `SELECT category_id, category_name
             FROM categories
             ORDER BY category_name`
        );

        res.json(categories);
    } catch (error) {
        console.error("Categories error:", error.message);

        res.status(500).json({
            message: "Could not load produce categories."
        });
    }
});

// Add produce: farmers only
app.post("/api/produce", authenticateUser, async (req, res) => {
    try {
        if (req.user.role !== "farmer") {
            return res.status(403).json({
                message: "Only registered farmers can add produce."
            });
        }

        const { name, price, quantity, category_id, location } = req.body;

        const productName =
            typeof name === "string" ? name.trim() : "";

        const productPrice = Number(price);
        const productQuantity = Number(quantity);
        const categoryId = Number(category_id);

        if (
            !productName ||
            productName.length > 100 ||
            price === "" ||
            price == null ||
            !Number.isFinite(productPrice) ||
            productPrice <= 0 ||
            quantity === "" ||
            quantity == null ||
            !Number.isSafeInteger(productQuantity) ||
            productQuantity < 1 ||
            category_id === "" ||
            category_id == null ||
            !Number.isSafeInteger(categoryId) ||
            categoryId < 1 ||
            (
                location != null &&
                (
                    typeof location !== "string" ||
                    location.trim().length > 150
                )
            )
        ) {
            return res.status(400).json({
                message: "Enter a valid name, price, quantity and category."
            });
        }

        const [categories] = await db.execute(
            "SELECT category_id FROM categories WHERE category_id = ?",
            [categoryId]
        );

        if (categories.length === 0) {
            return res.status(400).json({
                message: "Please select a valid produce category."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO produce
             (farmer_id, category_id, name, price, quantity, location)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.user_id,
                categoryId,
                productName,
                productPrice,
                productQuantity,
                typeof location === "string" && location.trim()
                    ? location.trim()
                    : null
            ]
        );

        res.status(201).json({
            message: "Produce added successfully!",
            produce_id: result.insertId
        });
    } catch (error) {
        console.error("Add produce error:", error.message);

        res.status(500).json({
            message: "Could not save produce. Please check the server and database."
        });
    }
});

// Browse produce that is currently in stock
app.get("/api/produce", async (req, res) => {
    try {
        const [products] = await db.execute(
            `SELECT p.produce_id, p.name, p.price, p.quantity, p.location,
                    c.category_name, u.name AS farmer_name
             FROM produce p
             JOIN categories c ON c.category_id = p.category_id
             JOIN users u ON u.user_id = p.farmer_id
             WHERE p.quantity > 0
             ORDER BY p.produce_id DESC`
        );

        res.json(products);
    } catch (error) {
        console.error("Produce catalogue error:", error.message);

        res.status(500).json({
            message: "Could not load available produce."
        });
    }
});

// Show the authenticated farmer their own listings
app.get("/api/my/produce", authenticateUser, async (req, res) => {
    if (req.user.role !== "farmer") {
        return res.status(403).json({
            message: "Only registered farmers can view their listings."
        });
    }

    try {
        const [products] = await db.execute(
            `SELECT p.produce_id, p.name, p.price, p.quantity, p.location,
                    c.category_name
             FROM produce p
             JOIN categories c ON c.category_id = p.category_id
             WHERE p.farmer_id = ?
             ORDER BY p.produce_id DESC`,
            [req.user.user_id]
        );

        res.json(products);
    } catch (error) {
        console.error("Farmer produce error:", error.message);

        res.status(500).json({
            message: "Could not load your produce listings."
        });
    }
});

// Show farmers orders that include their produce
app.get("/api/my/orders", authenticateUser, async (req, res) => {
    if (req.user.role !== "farmer") {
        return res.status(403).json({
            message: "Only registered farmers can view incoming orders."
        });
    }

    try {
        const [orders] = await db.execute(
            `SELECT o.order_id, o.order_date, o.status,
                    p.name AS product_name, oi.quantity, oi.unit_price,
                    u.name AS buyer_name, u.email AS buyer_email
             FROM order_items oi
             JOIN orders o ON o.order_id = oi.order_id
             JOIN produce p ON p.produce_id = oi.produce_id
             JOIN users u ON u.user_id = o.buyer_id
             WHERE p.farmer_id = ?
             ORDER BY o.order_date DESC, o.order_id DESC`,
            [req.user.user_id]
        );

        res.json(orders);
    } catch (error) {
        console.error("Farmer orders error:", error.message);

        res.status(500).json({
            message: "Could not load orders for your produce."
        });
    }
});

// Place a buyer order and reduce stock atomically
app.post("/api/orders", authenticateUser, async (req, res) => {
    if (req.user.role !== "buyer") {
        return res.status(403).json({
            message: "Only registered buyers can place orders."
        });
    }

    const items = req.body && req.body.items;

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({
            message: "Add between 1 and 50 produce items to your order."
        });
    }

    const quantities = new Map();

    for (const item of items) {
        const produceId = Number(item && item.produce_id);
        const quantity = Number(item && item.quantity);

        if (
            !Number.isSafeInteger(produceId) ||
            produceId < 1 ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1
        ) {
            return res.status(400).json({
                message: "Each order item needs a valid produce ID and quantity."
            });
        }

        const combinedQuantity = (quantities.get(produceId) || 0) + quantity;

        if (!Number.isSafeInteger(combinedQuantity)) {
            return res.status(400).json({
                message: "The requested quantity is too large."
            });
        }

        quantities.set(produceId, combinedQuantity);
    }

    let connection;
    let transactionStarted = false;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const products = [];
        let totalCents = 0;

        for (const [produceId, quantity] of [...quantities].sort(
            ([firstId], [secondId]) => firstId - secondId
        )) {
            const [rows] = await connection.execute(
                `SELECT produce_id, name, price, quantity
                 FROM produce
                 WHERE produce_id = ?
                 FOR UPDATE`,
                [produceId]
            );

            if (rows.length === 0) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(404).json({
                    message: "One of the selected products is no longer available."
                });
            }

            const product = rows[0];
            const unitPriceCents = Math.round(Number(product.price) * 100);

            if (
                !Number.isSafeInteger(unitPriceCents) ||
                unitPriceCents < 1 ||
                unitPriceCents > 9999999999
            ) {
                throw new Error(`Invalid stored price for produce ${produceId}.`);
            }

            if (product.quantity < quantity) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(409).json({
                    message: `${product.name} does not have enough stock. Available quantity: ${product.quantity}.`
                });
            }

            const lineTotalCents = unitPriceCents * quantity;
            totalCents += lineTotalCents;

            if (
                !Number.isSafeInteger(lineTotalCents) ||
                !Number.isSafeInteger(totalCents) ||
                totalCents > 9999999999
            ) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(400).json({
                    message: "Order total exceeds the supported amount."
                });
            }

            products.push({
                produceId,
                name: product.name,
                quantity,
                unitPrice: (unitPriceCents / 100).toFixed(2)
            });
        }

        const totalAmount = (totalCents / 100).toFixed(2);
        const [orderResult] = await connection.execute(
            `INSERT INTO orders (buyer_id, total_amount, status)
             VALUES (?, ?, 'Placed')`,
            [req.user.user_id, totalAmount]
        );

        for (const product of products) {
            await connection.execute(
                `UPDATE produce
                 SET quantity = quantity - ?
                 WHERE produce_id = ?`,
                [product.quantity, product.produceId]
            );

            await connection.execute(
                `INSERT INTO order_items
                 (order_id, produce_id, quantity, unit_price, subtotal)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    orderResult.insertId,
                    product.produceId,
                    product.quantity,
                    product.unitPrice,
                    (
                        Number(product.unitPrice) * product.quantity
                    ).toFixed(2)
                ]
            );
        }

        await connection.commit();
        transactionStarted = false;

        res.status(201).json({
            message: "Order placed. The farmer will contact you to arrange payment and delivery.",
            order_id: orderResult.insertId,
            total_amount: totalAmount,
            status: "Placed"
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Order rollback error:", rollbackError.message);
            }
        }

        console.error("Order creation error:", error.message);

        res.status(500).json({
            message: "Could not place the order. No payment was taken."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Handle malformed JSON requests
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({
            message: "Invalid JSON request body."
        });
    }

    next(error);
});

// Start the server
app.listen(PORT, () => {
    console.log(`AgriConnect running at http://localhost:${PORT}`);
});
