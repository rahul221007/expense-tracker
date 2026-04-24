'use strict';

const app = require('./server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Expense tracker listening on http://localhost:${PORT}`);
});
