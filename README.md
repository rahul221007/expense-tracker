# Expense Tracker

A minimal full-stack personal finance tool.  
**Stack:** Node.js · Express · `node:sqlite` (built-in) · Vanilla JS

---

## Running locally

```bash
npm install
npm start          # http://localhost:3000
# or
npm run dev        # restarts on file changes (Node 18+)
```

```bash
npm test           # Jest + Supertest — 20 integration tests
```

Requires **Node.js ≥ 22.5.0** (for the built-in `node:sqlite` module).

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/expenses` | Create an expense |
| `GET`  | `/expenses` | List expenses (`?category=`, `?sort=date_desc`) |
| `GET`  | `/expenses/categories` | Distinct categories (for filter dropdown) |

### POST /expenses — request body

```json
{
  "idempotency_key": "uuid-v4",
  "amount":          "100.50",
  "category":        "Food",
  "description":     "Lunch with team",
  "date":            "2024-04-15"
}
```

Returns `201` on create, `200` if the key was already used (idempotent retry).

---

## Key design decisions

### Persistence: `node:sqlite` (built-in)

Node.js 22.5+ ships SQLite as a first-party built-in module.  
Choosing it means **zero native compilation**, no `node-gyp`, no extra
packages — just `require('node:sqlite')`.  The synchronous API is identical
in style to `better-sqlite3`, keeps route handlers straightforward, and
avoids async complexity for what is essentially a local single-process server.

Trade-off: it is currently marked *experimental* in Node.js. For a long-lived
production service I would use `better-sqlite3` (stable, widely tested) once
the Xcode / compiler environment is reliably available.

### Money: integer paise (not REAL / float)

Floating-point cannot represent all decimal fractions exactly.
`0.1 + 0.2 === 0.30000000000000004` in IEEE 754.  Storing currency as a
`REAL` column would silently corrupt values over repeated reads and writes.

The fix: store amounts as `INTEGER` paise (₹1 = 100 paise).
`Math.round(amount * 100)` on input, `(paise / 100).toFixed(2)` on output.
The same principle applies in the frontend summary: paise are accumulated as
integers before converting back to a display string.

A `CHECK (amount > 0)` constraint in the schema enforces this at the storage
layer independently of application code.

### Idempotency: client-generated UUID key

Real-world users click submit twice, networks time out, pages reload mid-POST.
Without idempotency, every retry creates a duplicate expense.

Solution: the client generates a UUID v4 before the first submission and
stores it in a hidden form field.  The same key is sent on every retry.  The
backend has a `UNIQUE` constraint on `idempotency_key` — a duplicate insert
raises `UNIQUE constraint failed`, which is caught and resolved by returning
the existing record with HTTP 200 instead of 201.  No duplicates are created.

The frontend only generates a **new** key after a confirmed 201/200 response.
A network timeout means the old key is preserved, so the next attempt is safe.

### App export vs. `listen`

`server.js` exports the Express `app` without calling `.listen()`.
`index.js` is the only file that binds a port.  This lets `supertest` wrap
the app in integration tests without needing a real TCP port, which makes
tests fast and avoids port-collision flakiness in CI.

---

## Trade-offs made for the timebox

- **No authentication / user accounts** — the assignment is scoped to a single
  user tool; adding auth would triple the scope.
- **No pagination** — fine for a personal tracker with hundreds of rows,
  not for thousands. A `LIMIT / OFFSET` query and `Link` header would be the
  next step.
- **No DELETE / PATCH** — only the required read/write paths are implemented.
- **SQLite file on disk** — suitable for a single-process local deployment.
  A multi-instance deployment would need a shared database (Postgres, etc.).
- **`node:sqlite` is experimental** — accepted for this exercise; would use
  `better-sqlite3` in a stable production environment.
- **No HTTPS** — assumed to run behind a reverse proxy (nginx/Caddy) in
  production which handles TLS termination.

---

## What I would do next

1. Add pagination (`?page=` / `?cursor=`) to the list endpoint.
2. Add `DELETE /expenses/:id` and `PATCH /expenses/:id`.
3. Replace the experimental `node:sqlite` with `better-sqlite3` once the build
   environment is stable.
4. Add end-to-end tests with Playwright for the form submit / retry flows.
5. Deploy behind a process manager (PM2) with log rotation.
