'use strict';

function canEditHistoricalBooking(user, booking) {
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && user.id === booking.instructor_id;
}

module.exports = {
  canEditHistoricalBooking,
};
