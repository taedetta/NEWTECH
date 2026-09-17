'use strict';

const { inferLessonType } = require('./lesson-types');
const { calendarDateFromDate } = require('./school-timezone');

function isBillingManagerRole(role) {
  return ['owner', 'admin'].includes(role);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : calendarDateFromDate(d);
}

function bookingLocalDate(booking) {
  return dateOnly(booking?.start_time);
}

function buildFlightHistorySyncPatch({ role, booking, body, submittedBy }) {
  const patch = {
    hobbs_start: body.hobbs_start,
    hobbs_end: body.hobbs_end,
    tach_start: body.tach_start,
    tach_end: body.tach_end,
    dual_instruction_hours: body.dual_instruction_hours,
    submitted_by: submittedBy,
  };

  const requestedDate = dateOnly(body.flight_date);
  if (requestedDate && requestedDate !== bookingLocalDate(booking)) {
    patch.flight_date = requestedDate;
  }

  if (isBillingManagerRole(role)) {
    if (body.lesson_type !== undefined && body.lesson_type !== '' && body.lesson_type !== null) {
      patch.lesson_type = inferLessonType(body.lesson_type, booking);
    }
    if (body.aircraft_charge_amount !== undefined) {
      patch.aircraft_charge_amount = body.aircraft_charge_amount;
    }
    if (body.instruction_charge_amount !== undefined) {
      patch.instruction_charge_amount = body.instruction_charge_amount;
    }
  }

  return patch;
}

module.exports = {
  buildFlightHistorySyncPatch,
  dateOnly,
  isBillingManagerRole,
};
