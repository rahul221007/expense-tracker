/**
 * /expenses route handlers.
 *
 * POST /expenses  — create an expense (idempotent via idempotency_key)
 * GET  /expenses  — list expenses with optional ?category= and ?sort=date_desc
 */

'use strict';

const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a user-supplied decimal string/number to an integer in paise.
 * ₹100.50 → 10050.  Rounds half-up to handle float representation noise.
 * Returns NaN if the input cannot be parsed as a finite positive number.
 */
function toPaise(value) {
  const n = parseFloat(value);
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/**
 * Convert integer paise back to a two-decimal string for API responses.
 * 10050 → "100.50"
 */
function fromPaise(paise) {
  return (paise / 100).toFixed(2);
}

/** ISO 8601 date string: YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate and normalise a raw POST body into a safe object.
 * Returns { data } on success or { errors: string[] } on failure.
 */
function validateExpenseBody(body) {
  const errors = [];

  const { idempotency_key, amount, category, description, date } = body;

  if (!idempotency_key || typeof idempotency_key !== 'string' || !idempotency_key.trim()) {
    errors.push('idempotency_key is required');
  }

  const paise = toPaise(amount);
  if (amount === undefined || amount === null || amount === '') {
    errors.push('amount is required');
  } else if (isNaN(paise)) {
    errors.push('amount must be a valid number');
  } else if (paise <= 0) {
    errors.push('amount must be greater than zero');
  }

  if (!category || typeof category !== 'string' || !category.trim()) {
    errors.push('category is required');
  }

  if (!description || typeof description !== 'string' || !description.trim()) {
    errors.push('description is required');
  }

  if (!date) {
    errors.push('date is required');
  } else if (!DATE_RE.test(date)) {
    errors.push('date must be in YYYY-MM-DD format');
  }

  if (errors.length > 0) return { errors };

  return {
    data: {
      idempotency_key: idempotency_key.trim(),
      amount: paise,
      category: category.trim(),
      description: description.trim(),
      date,
    },
  };
}

/** Serialise a raw DB row for API output (converts paise → decimal string). */
function serializeExpense(row) {
  return {
    id: row.id,
    idempotency_key: row.idempotency_key,
    amount: fromPaise(row.amount),
    category: row.category,
    description: row.description,
    date: row.date,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// POST /expenses
// ---------------------------------------------------------------------------

router.post('/', (req, res, next) => {
  try {
    const result = validateExpenseBody(req.body);
    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }

    const db = getDb();
    const { idempotency_key, amount, category, description, date } = result.data;

    // Attempt the insert. If the idempotency_key already exists the UNIQUE
    // constraint fires — we catch that and return the existing record instead
    // of creating a duplicate.  This makes the endpoint safe to retry without
    // any client-side coordination beyond preserving the same key.
    let expense;
    let status = 201;

    try {
      const insert = db.prepare(`
        INSERT INTO expenses (idempotency_key, amount, category, description, date)
        VALUES (?, ?, ?, ?, ?)
      `);
      insert.run(idempotency_key, amount, category, description, date);
      expense = db.prepare('SELECT * FROM expenses WHERE idempotency_key = ?').get(idempotency_key);
    } catch (err) {
      // SQLITE_CONSTRAINT_UNIQUE — duplicate idempotency key
      if (err.code === 'ERR_SQLITE_ERROR' && err.message.includes('UNIQUE constraint failed')) {
        expense = db.prepare('SELECT * FROM expenses WHERE idempotency_key = ?').get(idempotency_key);
        status = 200;
      } else {
        throw err;
      }
    }

    return res.status(status).json(serializeExpense(expense));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /expenses
// ---------------------------------------------------------------------------

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { category, sort } = req.query;

    let sql = 'SELECT * FROM expenses';
    const params = [];

    if (category && category.trim()) {
      sql += ' WHERE category = ?';
      params.push(category.trim());
    }

    // Default sort is date descending; only supported explicit sort is date_desc.
    // created_at is used as tiebreaker so entries on the same date have a stable order.
    if (sort === 'date_desc' || !sort) {
      sql += ' ORDER BY date DESC, created_at DESC';
    } else {
      sql += ' ORDER BY date DESC, created_at DESC';
    }

    const rows = db.prepare(sql).all(...params);
    const expenses = rows.map(serializeExpense);

    // Sum in integer arithmetic to avoid floating-point accumulation errors.
    const totalPaise = rows.reduce((sum, r) => sum + r.amount, 0);

    return res.json({
      expenses,
      total: fromPaise(totalPaise),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /expenses/categories
// Returns the sorted list of distinct categories that have been used.
// The frontend uses this to build the filter dropdown dynamically so the
// user only sees categories that actually exist.
// ---------------------------------------------------------------------------

router.get('/categories', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT DISTINCT category FROM expenses ORDER BY category COLLATE NOCASE ASC"
    ).all();
    return res.json({ categories: rows.map(r => r.category) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
