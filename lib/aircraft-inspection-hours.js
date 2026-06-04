'use strict';

/** Current tach reading used for 100-hr inspections, AD hour limits, etc. */
function getInspectionHours(aircraft) {
  if (!aircraft) return null;
  const raw = aircraft.current_tach ?? aircraft.total_tach_hours;
  if (raw == null || raw === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Hours remaining until a tach-based due point (negative = overdue). */
function hoursUntilDue(aircraft, dueAt) {
  if (dueAt == null || dueAt === '') return null;
  const due = parseFloat(dueAt);
  if (!Number.isFinite(due)) return null;
  const current = getInspectionHours(aircraft);
  if (current == null) return null;
  return due - current;
}

module.exports = { getInspectionHours, hoursUntilDue };
