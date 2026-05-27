'use strict';

const { sendPushToUser, notifyUsers, notifyRoleUsers } = require('./push-notifications');

async function notifyBookingConfirmed(userIds, { tailNumber, startTime }) {
  const date = new Date(startTime).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return notifyUsers(userIds, {
    title: 'Flight booked',
    body: `${tailNumber} — ${date}`,
    link: '/app/schedule',
    notification_type: 'booking_confirmed',
    tag: 'booking',
  });
}

async function notifyBookingCancelled(userIds, { tailNumber, reason }) {
  return notifyUsers(userIds, {
    title: 'Flight cancelled',
    body: `${tailNumber}${reason ? ` — ${reason}` : ''}`,
    link: '/app/schedule',
    notification_type: 'booking_cancelled',
    tag: 'booking',
  });
}

async function notifyAircraftGrounded({ tailNumber, reason }) {
  return notifyRoleUsers(['owner', 'admin', 'instructor', 'maintenance'], {
    title: `${tailNumber} out of service`,
    body: reason || 'Aircraft grounded — check squawks',
    link: '/app/maintenance',
    notification_type: 'aircraft_grounded',
    tag: 'maintenance',
  });
}

async function notifyNewMessage(recipientId, { senderName, preview }) {
  return sendPushToUser(recipientId, {
    title: `Message from ${senderName}`,
    body: preview.slice(0, 120),
    link: '/app/messages',
    notification_type: 'message',
    tag: 'messages',
  });
}

async function notifyDocumentExpiring(userId, { docType, expiryDate }) {
  return sendPushToUser(userId, {
    title: 'Document expiring soon',
    body: `${docType} expires ${expiryDate}`,
    link: '/app/documents',
    notification_type: 'document_expiry',
  });
}

module.exports = {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyAircraftGrounded,
  notifyNewMessage,
  notifyDocumentExpiring,
};
