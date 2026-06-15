'use strict';

const EMAIL_TYPES = {
  booking_confirmation: 'booking_confirmation',
  booking_cancelled: 'booking_cancelled',
  preflight_reminder: 'preflight_reminder',
  flight_completed: 'flight_completed',
  instructor_briefing: 'instructor_briefing',
  endorsement_expiry: 'endorsement_expiry',
  maintenance_alert: 'maintenance_alert',
  password_reset: 'password_reset',
  account_approved: 'account_approved',
  account_rejected: 'account_rejected',
  signup_pending: 'signup_pending',
  account_invite: 'account_invite',
  profile_change: 'profile_change',
  welcome: 'welcome',
};

const TYPE_LABELS = {
  booking_confirmation: 'Booking confirmations',
  booking_cancelled: 'Booking cancellations',
  preflight_reminder: 'Pre-flight reminders (24 hours before)',
  flight_completed: 'Flight completed summaries',
  instructor_briefing: 'Daily instructor briefing',
  endorsement_expiry: 'Endorsement expiry alerts',
  maintenance_alert: 'Aircraft maintenance / grounding alerts',
  password_reset: 'Password reset links',
  account_approved: 'Account approved notifications',
  account_rejected: 'Account rejected notifications',
  signup_pending: 'Signup / pending approval notices',
  account_invite: 'Account invitation emails',
  profile_change: 'Profile update confirmations (email or phone changes)',
  welcome: 'Welcome emails',
};

const TYPE_CATEGORIES = [
  {
    id: 'flights',
    label: 'Flights & Scheduling',
    types: ['booking_confirmation', 'booking_cancelled', 'preflight_reminder', 'flight_completed'],
  },
  {
    id: 'training',
    label: 'Training & Endorsements',
    types: ['endorsement_expiry', 'instructor_briefing'],
  },
  {
    id: 'account',
    label: 'Account & Profile',
    types: ['password_reset', 'profile_change', 'signup_pending', 'account_approved', 'account_rejected', 'account_invite', 'welcome'],
  },
  {
    id: 'operations',
    label: 'Operations & Maintenance',
    types: ['maintenance_alert'],
  },
];

module.exports = {
  EMAIL_TYPES,
  TYPE_LABELS,
  TYPE_CATEGORIES,
};
