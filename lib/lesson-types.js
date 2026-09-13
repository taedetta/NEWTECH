'use strict';

function isDiscoveryLessonType(lessonType) {
  if (!lessonType) return false;
  const s = String(lessonType).trim();
  return /^discovery(\s*flight)?$/i.test(s) || /^discovery\s+/i.test(s);
}

/** Default lesson label when bookings.lesson_type is null (needed for charge math). */
function inferLessonType(lessonType, booking) {
  const s = lessonType != null ? String(lessonType).trim() : '';
  if (s) return s;
  if (!booking) return '';
  const bt = booking.booking_type || '';
  if (bt === 'student_solo' || bt === 'renter_solo') return 'Solo';
  if (booking.instructor_id || bt === 'dual' || bt === 'instructor_solo') return 'Dual Instruction';
  return 'Dual Instruction';
}

module.exports = {
  inferLessonType,
  isDiscoveryLessonType,
};
