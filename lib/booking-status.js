'use strict';

function isHistoricalBookingStatus(status) {
  return status === 'completed' || status === 'cancelled';
}

function canEditHistoricalBooking(user, booking) {
  if (!isHistoricalBookingStatus(booking?.status)) return true;
  if (!user) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && booking.instructor_id === user.id;
}

module.exports = {
  isHistoricalBookingStatus,
  canEditHistoricalBooking,
};
