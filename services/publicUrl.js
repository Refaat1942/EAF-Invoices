/**
 * Address printed inside invoice QR codes. A phone scanning the code cannot reach
 * "localhost" or the server's computer name, so when PUBLIC_APP_URL is configured (the
 * offline package writes the server's network address there) it is used instead of the
 * address the employee's browser happened to use.
 */
function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/\s]+/i.test(configured)) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function invoiceQrUrl(baseUrl, token) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/download/${token}`;
}

module.exports = { getPublicBaseUrl, invoiceQrUrl };
