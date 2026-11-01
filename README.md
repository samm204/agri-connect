# AgriConnect – Agribusiness Web Application

AgriConnect connects smallholder farmers directly with buyers (households, hotels, schools and exporters). Farmers list produce; buyers search, add to a cart and place orders; an administrator approves farmer accounts and moves orders through their lifecycle (Placed → Confirmed → Dispatched → Delivered). Each order has a printable/PDF receipt.

Built for the TVET CDACC *Create Web Applications* practical assessment (Software Development Level 5/6).

## Framework and stack

| Layer | Technology |
|---|---|
| Runtime / back end | **Node.js 22 (≥ 22.13)** with the built-in `http` module – no web framework and **no npm dependencies** |
| Database | SQLite through Node's built-in `node:sqlite` module |
| Front end | Plain HTML, CSS and JavaScript (served from `public/`) |
| Passwords / sessions | scrypt with random salt; random 256-bit session tokens in HttpOnly, SameSite=Strict cookies |

The homepage uses locally stored Unsplash photographs in `public/images/` for the farm hero and produce categories. Product listings can also use a farmer-provided photo URL.

## Environment variables

Configuration is read from the environment. **Never commit real values**; `.env` files are listed in `.gitignore`. A template is in `.env.example`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | Recommended | `development` | Set to `production` when hosted: turns on the `Secure` cookie flag and makes `ADMIN_PASSWORD` mandatory |
| `ADMIN_PASSWORD` | **Yes in production** | `Admin@1234` (development only) | Password for the seeded administrator `admin@agriconnect.co.ke`. Must be 8+ characters with a letter and a number. The app refuses to start in production without it |
| `PORT` | No | `3000` | Port to listen on (hosting platforms set this automatically) |
| `DATABASE_FILE` | No | `db/agriconnect.sqlite` | Path of the SQLite file |

## Setup – run locally

```bash
git clone <your-repo-url> agriconnect
cd agriconnect
node -v                  # must be v22.13 or newer
npm start                # no "npm install" needed: there are no dependencies
# open http://localhost:3000
```

On first start the database and demo data are created automatically.

| Demo account | Email | Password |
|---|---|---|
| Administrator | admin@agriconnect.co.ke | `Admin@1234` locally (or your `ADMIN_PASSWORD`) |
| Farmer (approved) | wanjiru@farm.co.ke | `Demo@1234` |
| Farmer (approved) | otieno@farm.co.ke | `Demo@1234` |
| Farmer (pending approval) | chebet@farm.co.ke | `Demo@1234` |
| Buyer | buyer@hotel.co.ke | `Demo@1234` |

The demo accounts are sample data for the assessment only.

## Setup – deploy (Render, free tier)

1. Push this repository to GitHub.
2. In Render: **New → Web Service → connect the GitHub repository** (or **New → Blueprint** to use `render.yaml`).
3. Build command: `npm install` · Start command: `npm start` · Health check path: `/health`.
4. Environment: `NODE_ENV=production`, `NODE_VERSION=22`, and a secret `ADMIN_PASSWORD`.
5. Deploy. Render issues an HTTPS certificate automatically.

> **Free-tier limitation:** Render's free web services have an ephemeral file system and sleep after 15 idle minutes, so the SQLite file is recreated (and demo data re-seeded) after a restart or redeploy. For permanent data, attach a persistent disk on a paid instance and set `DATABASE_FILE` to a path on that disk, or move to a managed database.

## Tests

```bash
npm test                                   # 81 API tests (functional + security)
node tests/ui-check.js ./out               # browser checks (needs Playwright + Chromium)
node tests/ui-security.js ./out            # XSS / accessibility checks in the browser
```

## Backup

```bash
npm run backup                             # writes backups/agriconnect-<timestamp>.sqlite
```

## Project layout

```
server.js            entry point
src/app.js           HTTP server, REST API, static files
src/db.js            database connection, seed data
src/security.js      hashing, validation, rate limiting
src/pdf.js           receipt PDF writer
db/schema.sql        tables
public/              HTML, CSS, JS front end
scripts/backup-db.js consistent database backup
tests/               automated tests
render.yaml          hosting blueprint
```

## API summary

`POST /api/register` · `POST /api/login` · `POST /api/logout` · `GET /api/me` · `GET /api/produce?search=&category=&location=` · `GET /api/produce/:id` · `POST|PUT|DELETE /api/produce` (farmer) · `POST /api/orders` (buyer) · `GET /api/orders` · `GET /api/orders/:id/receipt.pdf` · `PUT /api/orders/:id/status` (admin) · `GET /api/admin/users`, `PUT /api/admin/users/:id/approve` · `GET /health`

State-changing requests must send the header `X-Requested-With: AgriConnect`.

## Licence
MIT – academic project.
