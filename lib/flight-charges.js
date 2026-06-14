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

module.exports = { DISCOVERY_FLAT_CHARGE, computeFlightCharges };
