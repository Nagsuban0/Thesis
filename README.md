# School Document Request System

Students and alumni request school documents with a click. Every request goes straight to the **registrar**, who reviews, approves, prepares, and releases it. The **admin** controls the registrar accounts and can override any request.

- **Backend:** Node.js (no external dependencies) + built-in SQLite (`node:sqlite`)
- **Frontend:** React + Vite + React Router

## Requirements

- Node.js **22.13 or newer**

## Run it

Open two terminals.

```bash
# 1) Backend  ->  http://localhost:4000
cd backend
npm start
```

```bash
# 2) Frontend  ->  http://localhost:5173
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Default admin account

| Email | Password |
|---|---|
| `admin@example.com` | `Admin@123` |

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first run to use different credentials. Students register themselves; the admin creates registrar accounts.

### Sample accounts (optional)

```bash
cd backend
npm run seed:demo
```

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin@123` |
| Registrar | `registrar@example.com` | `Registrar@123` |
| Student | `student@example.com` | `Student@123` |
| Alumni | `alumni@example.com` | `Student@123` |

This also adds a few sample requests in different statuses. It is safe to run more than once. Do not use these passwords in production.

If you ran the earlier version, your existing database is upgraded automatically (nothing is deleted). To start completely fresh, delete the `backend/data` folder.

## How it works

```
Student clicks Request  ->  Pending (goes straight to the Registrar dashboard)
Registrar reviews       ->  Approved          (or Rejected, with a reason)
Registrar               ->  Processing -> Ready for release -> Released
```

The student gets a notification (bell in the sidebar) on every status change, including the rejection reason and whether the document is ready for pick-up or delivery.

| Role | Can do |
|---|---|
| **Student / alumni** | Click **Request** on a document (Good Moral Certificate, Diploma, TOR, Certificate of Enrollment, Certificate of Graduation, Certificate of Grades, Honorable Dismissal), track progress, read notifications, cancel while still pending. One active request per document at a time. |
| **Registrar** | Sees all new requests on the dashboard, approves or rejects (reason required), then marks Processing, Ready for release, and Released. |
| **Admin** | Creates, deactivates, and resets passwords of **registrar accounts**. Can **override** any request (do everything the registrar can). Manages the documents offered (name, fee, days, visibility) and student accounts. |

## Configuration (backend environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `JWT_SECRET` | dev-only value | **Set this in production** |
| `DB_PATH` | `backend/data/docreq.sqlite` | SQLite file location |
| `CORS_ORIGIN` | `*` | Allowed origin (set to your frontend URL in production) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | see above | First admin account |

## API summary

| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | public |
| GET / PATCH | `/api/auth/me` | logged in |
| GET | `/api/document-types` | logged in |
| GET / POST | `/api/requests` | student |
| GET | `/api/requests/:id` | owner or staff |
| POST | `/api/requests/:id/cancel` | owner (pending only) |
| GET | `/api/admin/stats`, `/api/admin/requests?status=&q=` | admin, registrar |
| PATCH | `/api/admin/requests/:id` | registrar, admin |
| GET | `/api/notifications` | logged in |
| POST | `/api/notifications/read` | logged in |
| GET / POST / PATCH / DELETE | `/api/admin/document-types` | admin |
| GET / PATCH | `/api/admin/users` | admin |
| POST | `/api/admin/registrars` | admin |

## Production build

```bash
cd frontend && npm run build   # outputs frontend/dist
```

Serve `frontend/dist` with any static host and route `/api` to the backend.
