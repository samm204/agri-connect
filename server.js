
require("dotenv").config();

const express = require("express");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.send("Welcome to AgriConnect!");
});

app.get("/api/health", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            status: "success",
            message: "AgriConnect backend and database connected!"
        });
    } catch (error) {
        console.error(error.message);

        res.status(500).json({
            status: "error",
            message: "Database connection failed."
        });
    }
});

const bcrypt = require("bcryptjs");

// Register a new user
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Validate required fields
        if (!name || !email || !password || !role) {
            return res.status(400).json({
                message: "Please fill in all required fields."
            });
        }

        if (!["farmer", "buyer"].includes(role)) {
            return res.status(400).json({
                message: "Choose Farmer or Buyer."
            });
        }

        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({
                message: "Password must contain 8 to 72 characters."
            });
        }

        // Hash the password before saving it
        const passwordHash = await bcrypt.hash(password, 12);

        // Save the account in MariaDB
        const [result] = await db.execute(
            `INSERT INTO Users
             (name, email, password_hash, role)
             VALUES (?, ?, ?, ?)`,
            [
                name.trim(),
                email.trim().toLowerCase(),
                passwordHash,
                role
            ]
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
            message: "Registration failed. Check your database and server."
        });
    }
});

app.listen(PORT, () => {
    console.log(`AgriConnect running at http://localhost:${PORT}`);
});
