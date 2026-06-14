'use strict';

const { isDiscoveryLessonType } = require('./booking-rules');

const DISCOVERY_FLAT_CHARGE = 185;

function computeFlightCharges({ lessonType, hobbsDelta, dualHrs, hourlyRate, instructorRate }) {
  if (isDiscoveryLessonType(lessonType)) {
    return {
      aircraftChargeAmount: DISCOVERY_FLAT_CHARGE,
      instructionChargeAmount: 0,
    };
  }
  const hobbs = parseFloat(hobbsDelta) || 0;
  const dual = parseFloat(dualHrs) || 0;
  const acRate = parseFloat(hourlyRate) || 0;
  const iRate = parseFloat(instructorRate) || 0;
  const aircraftChargeAmount = Math.round(hobbs * acRate * 100) / 100;
  const instructionChargeAmount = (dual > 0 && iRate)
    ? Math.round(dual * iRate * 100) / 100
    : 0;
  return { aircraftChargeAmount, instructionChargeAmount };
}

/** Discovery flights always bill flat $185 total — manual charge overrides are ignored. */
function resolveFlightCharges({
  lessonType,
  hobbsDelta,
  dualHrs,
  hourlyRate,
  instructorRate,
  aircraftChargeAmount,
  instructionChargeAmount,
}) {
  const computed = computeFlightCharges({ lessonType, hobbsDelta, dualHrs, hourlyRate, instructorRate });
  if (isDiscoveryLessonType(lessonType)) {
    return computed;
  }
  const acOverride = aircraftChargeAmount != null ? parseFloat(aircraftChargeAmount) : null;
  const instrOverride = instructionChargeAmount != null ? parseFloat(instructionChargeAmount) : null;
  return {
    aircraftChargeAmount: acOverride != null && !Number.isNaN(acOverride)
      ? acOverride
      : computed.aircraftChargeAmount,
    instructionChargeAmount: instrOverride != null && !Number.isNaN(instrOverride)
      ? instrOverride
      : computed.instructionChargeAmount,
  };
}

module.exports = { DISCOVERY_FLAT_CHARGE, computeFlightCharges, resolveFlightCharges };
