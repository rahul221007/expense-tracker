/**
 * Expense Tracker — frontend logic
 *
 * Retry safety:
 *   A UUID v4 idempotency_key is generated when the page loads (and after each
 *   successful submission).  The key is stored in the hidden form field so that
 *   every retry of the same submission sends the same key, and the server
 *   returns the existing record rather than creating a duplicate.
 *
 * Money display:
 *   The API always returns amounts as decimal strings (e.g. "100.50").
 *   We format them for display using Intl.NumberFormat so the ₹ symbol and
 *   decimal separator are correct for the user's locale.
 */

'use strict';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Generate a RFC 4122 UUID v4 using the browser's secure random source. */
function generateUUID() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

function formatMoney(decimalStr) {
  return inrFmt.format(parseFloat(decimalStr));
}

/** Show an alert element with a message; hide it if message is falsy. */
function setAlert(el, message, type = 'error') {
  el.textContent = message || '';
  el.className = `alert alert--${type}`;
  el.hidden = !message;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const form          = document.getElementById('expense-form');
const keyInput      = document.getElementById('idempotency-key');
const amountInput   = document.getElementById('amount');
const dateInput     = document.getElementById('date');
const categoryInput = document.getElementById('category');
const descInput     = document.getElementById('description');
const submitBtn     = document.getElementById('submit-btn');
const formError     = document.getElementById('form-error');

const filterCategory = document.getElementById('filter-category');
const sortOrder      = document.getElementById('sort-order');
const clearFiltersBtn= document.getElementById('clear-filters');

const totalDisplay   = document.getElementById('total-display');
const listLoading    = document.getElementById('list-loading');
const listStatus     = document.getElementById('list-status');
const tbody          = document.getElementById('expense-tbody');
const emptyState     = document.getElementById('empty-state');
const expenseTable   = document.getElementById('expense-table');

const summarySection = document.getElementById('summary-section');
const summaryTbody   = document.getElementById('summary-tbody');
const catSuggestions = document.getElementById('category-suggestions');

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Seed a fresh idempotency key on page load. */
function resetIdempotencyKey() {
  keyInput.value = generateUUID();
}

/** Set today's date as the default in the date picker. */
function setDefaultDate() {
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function createExpense(payload) {
  const res = await fetch('/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    // data.errors is an array from our validation layer
    const msg = Array.isArray(data.errors) ? data.errors.join('. ') : (data.error || 'Unexpected error');
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchExpenses(category, sort) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (sort)     params.set('sort', sort);

  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/expenses${query}`);
  if (!res.ok) throw new Error('Failed to load expenses');
  return res.json();
}

async function fetchCategories() {
  const res = await fetch('/expenses/categories');
  if (!res.ok) return [];
  const data = await res.json();
  return data.categories || [];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderExpenses({ expenses, total }) {
  // Table rows
  tbody.innerHTML = '';
  expenses.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escHtml(e.category)}</td>
      <td>${escHtml(e.description)}</td>
      <td class="amount">${formatMoney(e.amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  const hasRows = expenses.length > 0;
  emptyState.hidden    = hasRows;
  expenseTable.hidden  = !hasRows;
  totalDisplay.textContent = `Total: ${formatMoney(total)}`;

  // Per-category summary from the currently visible list
  renderSummary(expenses);
}

function renderSummary(expenses) {
  if (!expenses.length) {
    summarySection.hidden = true;
    return;
  }

  // Aggregate in integer paise to avoid float accumulation
  const byCategory = {};
  expenses.forEach(e => {
    const paise = Math.round(parseFloat(e.amount) * 100);
    byCategory[e.category] = (byCategory[e.category] || 0) + paise;
  });

  summaryTbody.innerHTML = '';
  Object.keys(byCategory)
    .sort((a, b) => a.localeCompare(b))
    .forEach(cat => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(cat)}</td>
        <td class="amount">${formatMoney((byCategory[cat] / 100).toFixed(2))}</td>
      `;
      summaryTbody.appendChild(tr);
    });

  summarySection.hidden = false;
}

async function refreshCategoryFilter(selectedValue) {
  const categories = await fetchCategories();

  // Rebuild the filter dropdown, preserving the current selection
  const current = selectedValue ?? filterCategory.value;
  filterCategory.innerHTML = '<option value="">All categories</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === current) opt.selected = true;
    filterCategory.appendChild(opt);
  });

  // Rebuild the datalist for the form input
  catSuggestions.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    catSuggestions.appendChild(opt);
  });
}

/** Escape text before inserting into innerHTML to prevent XSS. */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Load / refresh
// ---------------------------------------------------------------------------

async function loadExpenses() {
  listLoading.hidden = false;
  setAlert(listStatus, '');

  try {
    const category = filterCategory.value;
    const sort     = sortOrder.value;
    const data     = await fetchExpenses(category, sort);
    renderExpenses(data);
  } catch (err) {
    setAlert(listStatus, 'Could not load expenses. Please refresh.', 'error');
    console.error(err);
  } finally {
    listLoading.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setAlert(formError, '');

  // Client-side validation before hitting the network
  const amount = parseFloat(amountInput.value);
  if (!amountInput.value || isNaN(amount) || amount <= 0) {
    setAlert(formError, 'Please enter a valid amount greater than 0.');
    amountInput.focus();
    return;
  }
  if (!dateInput.value) {
    setAlert(formError, 'Please select a date.');
    dateInput.focus();
    return;
  }
  if (!categoryInput.value.trim()) {
    setAlert(formError, 'Please enter a category.');
    categoryInput.focus();
    return;
  }
  if (!descInput.value.trim()) {
    setAlert(formError, 'Please enter a description.');
    descInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    await createExpense({
      idempotency_key: keyInput.value,
      amount: amountInput.value,
      category: categoryInput.value.trim(),
      description: descInput.value.trim(),
      date: dateInput.value,
    });

    // Only reset the key after a confirmed success — retries keep the same key
    resetIdempotencyKey();
    form.reset();
    setDefaultDate();

    // Refresh both the list and the category dropdown
    await Promise.all([loadExpenses(), refreshCategoryFilter()]);
  } catch (err) {
    // Network errors, 400 validation errors, or 500s all surface here.
    // The idempotency_key is intentionally preserved so the user can retry.
    setAlert(formError, err.message || 'Failed to save expense. Please try again.');
    console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add Expense';
  }
});

// ---------------------------------------------------------------------------
// Filter / sort controls
// ---------------------------------------------------------------------------

filterCategory.addEventListener('change', loadExpenses);
sortOrder.addEventListener('change', loadExpenses);

clearFiltersBtn.addEventListener('click', () => {
  filterCategory.value = '';
  sortOrder.value = 'date_desc';
  loadExpenses();
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

resetIdempotencyKey();
setDefaultDate();

// Load categories then expenses on page load
refreshCategoryFilter().then(loadExpenses);
