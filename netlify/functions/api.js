const serverless = require('serverless-http');
const app = require('../../server/index');

// Netlify Functions serverless handler for Express
module.exports.handler = serverless(app);
