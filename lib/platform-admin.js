'use strict';

/** Platform operator account — full owner-level access, displayed as Admin/Instructor only. */
function getPlatformAdminEmail() {
  return (process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'evaughntaemw@gmail.com').toLowerCase();
}

function isPlatformAdminEmail(email) {
  return !!email && email.toLowerCase() === getPlatformAdminEmail();
}

function isPlatformAdminUser(user) {
  if (!user) return false;
  return isPlatformAdminEmail(user.email);
}

module.exports = { getPlatformAdminEmail, isPlatformAdminEmail, isPlatformAdminUser };
