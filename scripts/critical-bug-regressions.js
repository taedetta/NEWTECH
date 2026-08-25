'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';

const profileRoutes = require('../routes/profile');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
} = require('../lib/notification-prefs');
const bookingHistory = require('../routes/booking-history')._test;
const instructorHours = require('../routes/instructor-hours')._test;

function requestStatus(app, method, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ method, port, path }, (res) => {
        res.resume();
        res.on('end', () => {
          server.close((err) => (err ? reject(err) : resolve(res.statusCode)));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      req.end();
    });
  });
}

async function testCfiProfileRouteFallsThroughProfileAlias() {
  const app = express();
  app.use('/api/users/me', profileRoutes);
  app.use('/api/users/me', (req, res, next) => {
    if (req.path === '/cfi-profile') return res.status(204).end();
    next();
  });

  assert.strictEqual(await requestStatus(app, 'GET', '/api/users/me/cfi-profile'), 204);
  assert.strictEqual(await requestStatus(app, 'PUT', '/api/users/me/cfi-profile'), 204);
}

function testPasswordResetCannotBePreferenceGated() {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);

  const catalogTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.password_reset), false);

  const html = '<html><body>Reset your password</body></html>';
  const text = 'Reset your password';
  const withFooter = appendUnsubscribeFooter(html, text, 123, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(withFooter, { html, text });
}

function testInstructorHistoryEditsCannotOverrideBilling() {
  const requested = {
    lesson_type: 'Discovery Flight',
    aircraft_charge_amount: 0,
    instruction_charge_amount: 0,
  };

  assert.deepStrictEqual(bookingHistory.flightBillingPatchForRole('instructor', requested), {});
  assert.deepStrictEqual(bookingHistory.flightBillingPatchForRole('admin', requested), requested);

  assert.strictEqual(
    bookingHistory.resolveGroundInstructionCharge(
      'instructor',
      0,
      { instructor_rate: 80, instruction_charge_amount: 80 },
      2
    ),
    160
  );
  assert.strictEqual(
    bookingHistory.resolveGroundInstructionCharge(
      'owner',
      0,
      { instructor_rate: 80, instruction_charge_amount: 80 },
      2
    ),
    0
  );
}

function testInstructorHoursRatesCannotOverrideBilling() {
  assert.strictEqual(instructorHours.resolveEditableRate('instructor', 1, 95), 95);
  assert.strictEqual(instructorHours.resolveEditableRate('admin', 1, 95), 1);
}

(async () => {
  testPasswordResetCannotBePreferenceGated();
  testInstructorHistoryEditsCannotOverrideBilling();
  testInstructorHoursRatesCannotOverrideBilling();
  await testCfiProfileRouteFallsThroughProfileAlias();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
