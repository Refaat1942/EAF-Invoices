#!/usr/bin/env node
/**
 * Regression tests for public/js/api-client.js
 * Run: node scripts/test-api-client.js
 */

const {
  ApiClientError,
  classifyHttpStatus,
  sanitizeUserMessage,
  parseApiResponse,
  apiFetch,
  apiJson,
} = require('../public/js/api-client');

const { requestLogMiddleware, safeRequestPath } = require('../middleware/requestLog');

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertEq(a, e, msg) {
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertIncludes(text, needle, msg) {
  if (!String(text).includes(needle)) {
    console.error(`FAIL ${msg}: "${text}" does not include "${needle}"`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertNotIncludes(text, needle, msg) {
  if (String(text).toLowerCase().includes(String(needle).toLowerCase())) {
    console.error(`FAIL ${msg}: "${text}" includes forbidden "${needle}"`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function mockResponse({ status = 200, body = '', contentType = 'application/json', ok } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => text,
  };
}

// --- classifyHttpStatus ---
assertEq(classifyHttpStatus(401, null).category, 'auth', '401 category auth');
assertIncludes(classifyHttpStatus(401, null).message, 'انتهت الجلسة', '401 Arabic session message');

assertEq(classifyHttpStatus(403, null).category, 'forbidden', '403 category forbidden');
assertIncludes(classifyHttpStatus(403, null).message, 'صلاحية', '403 Arabic permission message');

assertEq(classifyHttpStatus(404, null).category, 'not_found', '404 category not_found');
assertIncludes(classifyHttpStatus(404, null).message, 'غير موجود', '404 Arabic not found');

assertEq(classifyHttpStatus(409, null).category, 'conflict', '409 category conflict');
assertIncludes(classifyHttpStatus(409, null).message, 'تعارض', '409 Arabic conflict');

assertEq(classifyHttpStatus(422, null).category, 'validation', '422 category validation');
assertIncludes(classifyHttpStatus(422, null).message, 'غير صالحة', '422 Arabic validation');

assertEq(classifyHttpStatus(500, null).category, 'server', '500 category server');
assertIncludes(classifyHttpStatus(500, null).message, 'الخادم', '500 Arabic server error');

// --- sanitizeUserMessage ---
const networkMsg = sanitizeUserMessage('TypeError: Failed to fetch');
assertNotIncludes(networkMsg, 'Failed to fetch', 'sanitize hides raw Failed to fetch');
assertIncludes(networkMsg, 'الاتصال', 'sanitize network Arabic');

const jsonMsg = sanitizeUserMessage('Unexpected token < in JSON at position 0');
assertNotIncludes(jsonMsg, 'Unexpected token', 'sanitize hides JSON parse detail');
assertIncludes(jsonMsg, 'رد الخادم', 'sanitize invalid JSON Arabic');

// --- parseApiResponse success ---
(async () => {
  const data = await parseApiResponse(mockResponse({ status: 200, body: { ok: true } }));
  assertEq(data.ok, true, 'parseApiResponse returns JSON on success');

  // --- HTTP errors preserve failure semantics ---
  for (const [status, category] of [
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation'],
    [500, 'server'],
  ]) {
    try {
      await parseApiResponse(
        mockResponse({ status, body: { error: `server-${status}` }, contentType: 'application/json' })
      );
      console.error(`FAIL ${status} should throw`);
      process.exit(1);
    } catch (err) {
      assert(err instanceof ApiClientError, `${status} throws ApiClientError`);
      assertEq(err.status, status, `${status} preserves status`);
      assertEq(err.category, category, `${status} preserves category`);
      assertIncludes(err.message, `server-${status}`, `${status} uses server message when present`);
    }
  }

  // --- non-JSON error body (session HTML) ---
  try {
    await parseApiResponse(
      mockResponse({
        status: 401,
        body: '<html><body>Login</body></html>',
        contentType: 'text/html',
      })
    );
    console.error('FAIL HTML 401 should throw');
    process.exit(1);
  } catch (err) {
    assert(err instanceof ApiClientError, 'HTML 401 throws ApiClientError');
    assertEq(err.status, 401, 'HTML 401 status');
    assertNotIncludes(err.message, 'Login', 'HTML body not shown to user');
    assertIncludes(err.message, 'انتهت الجلسة', 'HTML 401 Arabic fallback');
  }

  // --- invalid JSON on success path ---
  try {
    await parseApiResponse(
      mockResponse({ status: 200, body: '{not-json', contentType: 'application/json' })
    );
    console.error('FAIL invalid JSON should throw');
    process.exit(1);
  } catch (err) {
    assertEq(err.category, 'invalid_json', 'invalid JSON category');
    assertNotIncludes(err.message, 'not-json', 'invalid JSON hides parser detail');
  }

  // --- network failure via apiFetch ---
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await apiFetch('/api/test');
    console.error('FAIL network should throw');
    process.exit(1);
  } catch (err) {
    assert(err instanceof ApiClientError, 'network throws ApiClientError');
    assertEq(err.category, 'network', 'network category');
    assertNotIncludes(err.message, 'Failed to fetch', 'network hides raw message');
    assertIncludes(err.message, 'الاتصال', 'network Arabic message');
  }

  // --- apiJson end-to-end error ---
  global.fetch = async () =>
    mockResponse({ status: 503, body: { error: 'down' }, contentType: 'application/json' });

  try {
    await apiJson('/api/down');
    console.error('FAIL apiJson 503 should throw');
    process.exit(1);
  } catch (err) {
    assertEq(err.status, 503, 'apiJson preserves 503 status');
    assertEq(err.category, 'server', 'apiJson 503 server category');
  }

  // --- Daily Entry init failure user message (sections load) ---
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  let dailyUserMessage = '';
  try {
    await apiJson('/api/daily-charges/sections?with_services=1');
  } catch (err) {
    dailyUserMessage = sanitizeUserMessage(err.message);
  }
  assertNotIncludes(
    dailyUserMessage,
    'Failed to fetch',
    'Daily sections load failure never shows raw Failed to fetch'
  );
  assertIncludes(dailyUserMessage, 'الاتصال', 'Daily sections load shows connection Arabic');

  // --- request log middleware ---
  assertEq(safeRequestPath('/api/foo?secret=1'), '/api/foo', 'safeRequestPath strips query');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  const req = {
    method: 'GET',
    originalUrl: '/api/daily-charges/sections',
    headers: {},
  };
  const res = {
    statusCode: 500,
    setHeader: () => {},
    on: (event, fn) => {
      if (event === 'finish') res._finish = fn;
    },
  };
  requestLogMiddleware(req, res, () => {});
  assert(req.requestId, 'requestId assigned');
  res._finish();
  console.log = originalLog;

  const logLine = logs.find((l) => l.includes('[http]'));
  assert(logLine, 'request log emitted');
  assertIncludes(logLine, 'GET', 'log includes method');
  assertIncludes(logLine, '/api/daily-charges/sections', 'log includes path');
  assertIncludes(logLine, 'status=500', 'log includes status');
  assertIncludes(logLine, 'category=server_error', 'log includes category');
  assertIncludes(logLine, `id=${req.requestId}`, 'log includes request id');
  assertNotIncludes(logLine, 'DATABASE_URL', 'log does not leak secrets');

  console.log('All api-client tests passed.');
})();
