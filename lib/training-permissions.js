'use strict';

function canReassignEnrollmentInstructor(user, enrollment) {
  if (!user || !enrollment) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (user.role !== 'instructor') return false;

  const assignedInstructorId = enrollment.instructor_id == null
    ? null
    : parseInt(enrollment.instructor_id, 10);
  return assignedInstructorId != null && assignedInstructorId === parseInt(user.id, 10);
}

module.exports = {
  canReassignEnrollmentInstructor,
};
