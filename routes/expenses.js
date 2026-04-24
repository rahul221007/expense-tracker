/**
 * /expenses route handlers.
 *
 * POST /expenses  — create an expense (idempotent via idempotency_key)
 * GET  /expenses  — list expenses with optional ?category= and ?sort=date_desc
 */

'use strict';

const { Router } = require('express');

const router = Router();

// Placeholder — implemented in subsequent commits
router.get('/', (req, res) => res.json({ expenses: [], total: 0 }));

module.exports = router;
