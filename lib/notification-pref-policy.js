'use strict';

const { OPTIONAL_EMAIL_TYPES } = require('./email-types');

function mutablePreferenceColumns(prefColumns) {
  return prefColumns.filter((column) => column === 'email_all_off' || OPTIONAL_EMAIL_TYPES.includes(column));
}

module.exports = {
  mutablePreferenceColumns,
};
