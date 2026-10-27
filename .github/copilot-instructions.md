# Copilot Instructions

## Project architecture

- This is a CommonJS Node.js application. `server.js` creates the Express app, serves the `Public/` directory at the site root, and defines the `/api` endpoints.
- The browser UI is `Public/index.html`, styled by `Public/style.css`, with form and interaction logic in `Public/script.js`. The client calls same-origin API URLs such as `/api/login` and `/api/categories`; keep HTML element IDs and the client selectors in sync.
- `database.js` creates a `mysql2/promise` connection pool using environment configuration. `schema.sql` defines the MySQL tables and seed categories used by accounts, farmer listings, and buyer orders.
- The API provides health, category and produce reads, account registration/login, farmer-only produce creation and order/listing views, and buyer-only order placement. Registration hashes passwords with `bcryptjs`; login issues a JWT; `authenticateUser` resolves the current user from the token.
- The frontend stores the login token and user in `sessionStorage`. Keep authenticated browser requests aligned with the server's bearer-token authorization contract.
- Checkout creates a `Placed` order and reserves the requested stock in a MySQL transaction. It does not process payment; buyer and farmer arrange payment and delivery directly.

## Configuration and data

- `server.js` reads `PORT` (default `3000`) and `JWT_SECRET`. `database.js` reads `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (defaults: `localhost`, `root`, empty password, and `agriconnect`).
- Local configuration belongs in `.env`, which is ignored by Git. Never read or include local secret values in changes or output.
- Keep database reads and writes parameterized with `db.execute`, and preserve the API's JSON response shapes and meaningful HTTP status codes when changing handlers.

## Build, test, and lint

- Install dependencies: `npm install`
- Start the server: `npm start`
- Start in Node watch mode: `npm run dev`
- Check server syntax: `node --check server.js`
- Check browser script syntax: `node --check Public\script.js`
- `package.json` does not define build, test, or lint scripts, and there is no test framework configured. Consequently, there is no single-test command; verify database-backed API changes against a running server with `schema.sql` loaded into the configured MySQL database.
