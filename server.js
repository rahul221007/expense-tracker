/**
 * Express application entry point.
 *
 * The app is exported without calling .listen() so that supertest can
 * wrap it directly in integration tests without binding a real port.
 * index.js (or `npm start`) is responsible for calling .listen().
 */

'use strict';

const express = require('express');
const path = require('path');

const expensesRouter = require('./routes/expenses');

const app = express();

app.use(express.json());

// Serve the Vanilla JS frontend from public/
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/expenses', expensesRouter);

// 404 handler for unknown API paths
app.use((req, res, next) => {
  if (req.path.startsWith('/expenses') || req.accepts('html')) {
    return next();
  }
  res.status(404).json({ error: 'Not found' });
});

// Central error handler — never leaks stack traces to the client
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

module.exports = app;
