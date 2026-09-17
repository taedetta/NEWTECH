'use strict';

function canManageInstructorHourRates(role) {
  return ['owner', 'admin'].includes(role);
}

function resolveInstructorHoursRates({ role, row, body }) {
  const canManageRates = canManageInstructorHourRates(role);
  return {
    aircraftRate: canManageRates && body.aircraft_rate !== undefined
      ? parseFloat(body.aircraft_rate)
      : row.aircraft_rate,
    instructorRate: canManageRates && body.instructor_rate !== undefined
      ? parseFloat(body.instructor_rate)
      : row.instructor_rate,
  };
}

module.exports = {
  canManageInstructorHourRates,
  resolveInstructorHoursRates,
};
