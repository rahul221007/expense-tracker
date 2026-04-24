'use strict';

/**
 * Integration tests for the /expenses API.
 *
 * Each test gets a fresh in-memory SQLite database via jest.resetModules()
 * + process.env.DB_PATH = ':memory:'.  Resetting the module registry forces
 * db.js to create a new singleton for the next require(), giving us full
 * isolation without any test-specific hooks in production code.
 */

const request = require('supertest');

// Helper: build a valid expense payload.
function makeExpense(overrides = {}) {
  return {
    idempotency_key: `key-${Math.random()}`,
    amount: '100.00',
    category: 'Food',
    description: 'Test expense',
    date: '2024-04-15',
    ...overrides,
  };
}

// app and db are re-required fresh in beforeEach.
let app;
let db;

beforeEach(() => {
  jest.resetModules();
  process.env.DB_PATH = ':memory:';
  // Require after resetModules so each suite gets a pristine DB singleton.
  app = require('../server');
  db = require('../db').getDb();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// POST /expenses
// ---------------------------------------------------------------------------

describe('POST /expenses', () => {
  test('creates an expense and returns 201 with correct fields', async () => {
    const payload = makeExpense({ amount: '250.75', category: 'Transport' });

    const res = await request(app).post('/expenses').send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      idempotency_key: payload.idempotency_key,
      amount: '250.75',
      category: 'Transport',
      description: payload.description,
      date: '2024-04-15',
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.created_at).toBeDefined();
  });

  test('duplicate idempotency_key returns 200 with the same record — no duplicate row', async () => {
    const payload = makeExpense();

    const first = await request(app).post('/expenses').send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/expenses').send(payload);
    expect(second.status).toBe(200);

    // Same record returned
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.amount).toBe(first.body.amount);

    // Exactly one row in the database
    const row = db.prepare('SELECT COUNT(*) as n FROM expenses').get();
    expect(row.n).toBe(1);
  });

  test('different idempotency_key creates a new record even with identical data', async () => {
    const base = { amount: '50.00', category: 'Food', description: 'Lunch', date: '2024-04-15' };

    await request(app).post('/expenses').send({ ...base, idempotency_key: 'key-A' });
    await request(app).post('/expenses').send({ ...base, idempotency_key: 'key-B' });

    const row = db.prepare('SELECT COUNT(*) as n FROM expenses').get();
    expect(row.n).toBe(2);
  });

  test('returns 400 when amount is missing', async () => {
    const payload = makeExpense();
    delete payload.amount;

    const res = await request(app).post('/expenses').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('amount')]));
  });

  test('returns 400 when amount is negative', async () => {
    const res = await request(app).post('/expenses').send(makeExpense({ amount: '-10' }));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('greater than zero')])
    );
  });

  test('returns 400 when amount is zero', async () => {
    const res = await request(app).post('/expenses').send(makeExpense({ amount: '0' }));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('greater than zero')])
    );
  });

  test('returns 400 when date is missing', async () => {
    const payload = makeExpense();
    delete payload.date;

    const res = await request(app).post('/expenses').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('date')]));
  });

  test('returns 400 when date format is invalid', async () => {
    const res = await request(app)
      .post('/expenses')
      .send(makeExpense({ date: '15-04-2024' }));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('YYYY-MM-DD')])
    );
  });

  test('returns 400 when idempotency_key is missing', async () => {
    const payload = makeExpense();
    delete payload.idempotency_key;

    const res = await request(app).post('/expenses').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('idempotency_key')])
    );
  });

  test('returns 400 when category is missing', async () => {
    const payload = makeExpense();
    delete payload.category;

    const res = await request(app).post('/expenses').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('category')])
    );
  });

  test('stores money as integer paise — ₹100.50 stored as 10050, returned as "100.50"', async () => {
    const res = await request(app)
      .post('/expenses')
      .send(makeExpense({ amount: '100.50' }));

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe('100.50');

    // Verify the raw DB value is integer paise, not a float
    const row = db.prepare('SELECT amount FROM expenses WHERE id = ?').get(res.body.id);
    expect(row.amount).toBe(10050);
    expect(Number.isInteger(row.amount)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /expenses
// ---------------------------------------------------------------------------

describe('GET /expenses', () => {
  beforeEach(async () => {
    // Seed three expenses across two categories and two dates.
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'g1', amount: '50.00', category: 'Food', date: '2024-04-01' }));
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'g2', amount: '200.00', category: 'Transport', date: '2024-04-03' }));
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'g3', amount: '75.00', category: 'Food', date: '2024-04-02' }));
  });

  test('returns all expenses', async () => {
    const res = await request(app).get('/expenses');

    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(3);
  });

  test('filters by category', async () => {
    const res = await request(app).get('/expenses?category=Food');

    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(2);
    expect(res.body.expenses.every(e => e.category === 'Food')).toBe(true);
  });

  test('unknown category returns empty list — not an error', async () => {
    const res = await request(app).get('/expenses?category=Nonexistent');

    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(0);
    expect(res.body.total).toBe('0.00');
  });

  test('sort=date_desc returns expenses newest first', async () => {
    const res = await request(app).get('/expenses?sort=date_desc');

    expect(res.status).toBe(200);
    const dates = res.body.expenses.map(e => e.date);
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
    expect(dates).toEqual(sorted);
  });

  test('default order (no sort param) is also newest first', async () => {
    const res = await request(app).get('/expenses');

    const dates = res.body.expenses.map(e => e.date);
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
    expect(dates).toEqual(sorted);
  });

  test('total is the correct sum of all visible expenses', async () => {
    const res = await request(app).get('/expenses');

    // 50 + 200 + 75 = 325
    expect(res.body.total).toBe('325.00');
  });

  test('total is recalculated after category filter', async () => {
    const res = await request(app).get('/expenses?category=Food');

    // 50 + 75 = 125
    expect(res.body.total).toBe('125.00');
  });
});

// ---------------------------------------------------------------------------
// GET /expenses/categories
// ---------------------------------------------------------------------------

describe('GET /expenses/categories', () => {
  test('returns distinct categories in alphabetical order', async () => {
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'c1', category: 'Transport' }));
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'c2', category: 'Food' }));
    await request(app)
      .post('/expenses')
      .send(makeExpense({ idempotency_key: 'c3', category: 'Food' }));

    const res = await request(app).get('/expenses/categories');

    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(['Food', 'Transport']);
  });

  test('returns empty array when no expenses exist', async () => {
    const res = await request(app).get('/expenses/categories');

    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });
});
