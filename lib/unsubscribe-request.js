'use strict';

const { REQUIRED_EMAIL_TYPES } = require('./email-types');
const { verifyUnsubscribeToken } = require('./unsubscribe-token');

function normalizeUnsubscribeRequest(query) {
  const token = query.token;
  if (!token) {
    return {
      errorStatus: 400,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return {
      errorStatus: 400,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  const rawType = query.type == null ? verified.type : String(query.type).trim();
  if (rawType !== verified.type) {
    return {
      errorStatus: 400,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  if (verified.type !== 'all' && REQUIRED_EMAIL_TYPES.has(verified.type)) {
    return {
      errorStatus: 400,
      title: 'Required email',
      message: 'This email type is required for account security and cannot be disabled.',
    };
  }

  return { userId: verified.userId, type: verified.type, token };
}

module.exports = {
  normalizeUnsubscribeRequest,
};
