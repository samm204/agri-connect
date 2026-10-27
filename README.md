
# 🌱 AgriConnect

## Connecting Farmers, Buyers, and Agricultural Products

AgriConnect is a web application designed to connect farmers with customers by making agricultural products easier to discover and access. The platform aims to improve communication between farmers and buyers and simplify the process of finding agricultural products online.

## 🚀 Features

- **Product Listing:** Display available agricultural products.
- **Product Search:** Help users find specific products.
- **Shopping Cart and Orders:** Buyers can place orders for available farmer listings. Payment and delivery are arranged directly with the farmer; no online payment is processed.
- **Farmer Listings:** Farmers can add produce and review their listings and incoming orders.
- **User Registration:** Support user account creation.
- **Responsive Design:** Provide a user-friendly interface across different screen sizes.
- **Backend Integration:** Connect the frontend to the server and database.

## 🛠️ Technologies Used

- HTML5 – Structure of the web pages.
- CSS3 – Styling and responsive design.
- JavaScript – User interactions and functionality.
- Node.js – Backend runtime environment.
- Express.js – Backend web framework.
- MySQL – Database management.

## 📁 Project Structure

```text
Agriconnect-backend/
├── Public/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── database.js
├── schema.sql
├── server.js
└── package.json
```

## ⚙️ Installation and Setup

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
```

### 2. Open the project folder

```bash
cd AgriConnect
```

### 3. Install backend dependencies

```bash
cd Agriconnect-backend
npm install
```

### 4. Configure the database

- Start your MySQL or MariaDB server.
- Create the database named by `DB_NAME` (defaults to `agriconnect`).
- Import `schema.sql` into that database. It creates the user, category, produce, order, and order-item tables and seeds example categories.
- Configure `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and a private `JWT_SECRET` in `.env`. Never commit `.env`.

### 5. Start the backend server

```bash
npm start
```

Use the start command defined in your `package.json`. If no start script exists, use the appropriate command for your backend entry file.

### 6. Open the application

Visit `http://localhost:3000` so the static frontend and `/api` requests use the same Express server. Do not open the HTML file directly from disk.

Orders are saved with `Placed` status and reduce available produce stock. The farmer can see incoming orders and the buyer's email in their dashboard. Payment and delivery must be arranged outside the application.

## 🔐 Security

- Keep database credentials private.
- Never upload passwords, API keys, or `.env` files to GitHub.
- Validate user input on the backend.
- Use secure authentication and authorization where required.

## 🎯 Project Objectives

- Connect farmers with potential buyers.
- Improve access to agricultural products.
- Simplify product discovery and management.
- Provide a convenient online agricultural marketplace.

## 👨‍💻 Author

**Keith Arizi**

## 📌 Project Status

Under development.

## 📄 License

This project is currently developed for educational purposes.
