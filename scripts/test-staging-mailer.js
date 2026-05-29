'use strict';

const assert = require('assert');

async function main() {
  const savedEnv = { ...process.env };
  try {
    process.env.APP_ENV = 'staging';
    delete process.env.STAGING_EMAIL_SINK;
    delete process.env.ADMIN_NOTIFY_EMAIL;
    delete process.env.DATA_BACKUP_EMAIL;
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const { sendMail } = require('../lib/mailer');
    const ok = await sendMail({
      to: 'student@example.com',
      subject: 'Pre-reset backup',
      html: '<p>backup</p>',
      text: 'backup',
    });

    assert.strictEqual(ok, false, 'staging email without a sink must fail closed');
  } finally {
    process.env = savedEnv;
  }
}

main()
  .then(() => {
    console.log('staging mailer safety test passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
