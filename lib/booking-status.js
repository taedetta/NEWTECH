'use strict';

function bookingStatusBlocksSchedule(status) {
  return status !== 'cancelled' && status !== 'completed';
}

module.exports = { bookingStatusBlocksSchedule };
