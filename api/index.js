// api/index.js
const app = require("../Server");  // re-use your existing Express app
module.exports = app;              // Vercel will invoke this as a handler
