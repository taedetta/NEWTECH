/**
 * New Tech Aviation — Email Templates
 * All transactional emails sent by FlightSlate on behalf of New Tech Aviation.
 * No Polsia branding appears here — these are fully white-labeled.
 */

const LOGO_URL = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png';
const APP_URL = process.env.APP_URL || 'https://www.newtechaviation.com';
const ADMIN_NOTIFICATION_EMAILS = [
  'blankthe97@gmail.com',
  'art@3vaflight.com',
  'evaughntaemw@gmail.com',
];
const { sendMail } = require('./lib/mailer');

/**
 * Send an email via SMTP (Brevo, Gmail, etc.).
 */
async function sendEmail(to, subject, html, text) {
  try {
    return await sendMail({ to, subject, html, text });
  } catch (err) {
    console.error('[email] sendEmail error:', err.message);
    return false;
  }
}

/**
 * Shared HTML wrapper — New Tech Aviation header + footer.
 * No Polsia branding anywhere.
 */
function wrapEmailHtml(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Tech Aviation</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#080E1A;padding:28px 40px;text-align:center;">
              <img src="${LOGO_URL}" alt="New Tech Aviation" style="height:52px;max-width:220px;object-fit:contain;">
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;color:#1a202c;font-size:15px;line-height:1.7;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#64748b;font-weight:600;">New Tech Aviation</p>
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">New Dublin Airport (KPSK) · Dublin, Virginia</p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                <a href="${APP_URL}" style="color:#0EA5E9;text-decoration:none;">${APP_URL.replace('https://', '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Pending approval — sent to the new user immediately after signup.
 */
function pendingApprovalEmail({ name, role }) {
  const roleLabel = roleDisplayLabel(role);
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Account Created — Pending Approval ✈️</h2>
    <p style="margin:0 0 16px;">Hi ${escEmailHtml(name)},</p>
    <p style="margin:0 0 20px;">Thank you for signing up with New Tech Aviation! Your <strong>${roleLabel}</strong> account has been created and is now <strong>pending approval</strong> by our team.</p>
    <p style="margin:0 0 20px;">You'll receive another email once your account is reviewed and approved. After that, you can sign in and start scheduling flights.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Status</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#d97706;">Pending Approval</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Role</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(roleLabel)}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Questions? Reply to this email and we'll get back to you.</p>
  `);
  const text = `Hi ${name},\n\nThank you for signing up with New Tech Aviation! Your ${roleLabel} account is pending approval.\n\nYou'll receive another email once your account is approved and you can sign in at ${APP_URL}/app\n\nQuestions? Reply to this email.`;
  return { subject: 'Account Pending Approval — New Tech Aviation', html, text };
}

/**
 * Admin notification — sent when a new user signs up and needs approval.
 * Goes to admin/owner inbox, not the new user.
 */
function adminApprovalNotificationEmail({ userName, userEmail, userRole, signupDate }) {
  const roleDisplay = roleDisplayLabel(userRole);
  const dateStr = new Date(signupDate).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">New User Pending Approval ✈️</h2>
    <p style="margin:0 0 20px;">A new account has been created and requires your review before they can access the scheduling platform.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Name</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(userName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Email</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(userEmail)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Role</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(roleDisplay)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Signed Up</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(dateStr)}</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Review Pending Approvals →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Log in to approve or reject this account from the Approvals section.</p>
  `);
  const text = `New User Pending Approval\n\nName: ${userName}\nEmail: ${userEmail}\nRole: ${roleDisplay}\nSigned Up: ${dateStr}\n\nLog in to approve or reject: ${APP_URL}/app`;
  return { subject: `New Account Pending Approval — ${userName}`, html, text };
}

/**
 * Welcome email — sent AFTER approval when account is activated.
 */
function welcomeEmail({ name, email, role }) {
  const roleLabel = roleDisplayLabel(role);
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Welcome to New Tech Aviation, ${escEmailHtml(name)}! ✈️</h2>
    <p style="margin:0 0 16px;">Your account has been approved and activated as a <strong>${roleLabel}</strong>. You're all set to log in and start scheduling flights.</p>
    <p style="margin:0 0 24px;color:#64748b;">Your login email is <strong>${escEmailHtml(email)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Sign In to Your Account →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">If you have any questions, reply to this email and we'll get right back to you.</p>
  `);
  const text = `Welcome to New Tech Aviation, ${name}!\n\nYour account has been approved as a ${roleLabel}.\nLogin at: ${APP_URL}/app\nEmail: ${email}\n\nQuestions? Just reply to this email.`;
  return { subject: `Welcome to New Tech Aviation, ${name}!`, html, text };
}

/**
 * Approval confirmation — sent when admin/owner approves a pending user.
 */
function approvalConfirmationEmail({ name, role, approvedBy }) {
  const roleLabel = roleDisplayLabel(role);
  const approverLine = approvedBy
    ? `Your account was reviewed and approved by <strong>${escEmailHtml(approvedBy)}</strong> at New Tech Aviation.`
    : 'Your account has been approved by <strong>New Tech Aviation</strong>.';
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Your Account Has Been Approved! ✈️</h2>
    <p style="margin:0 0 16px;">Hi ${escEmailHtml(name)},</p>
    <p style="margin:0 0 20px;">Great news — ${approverLine} Your <strong>${roleLabel}</strong> account is now active.</p>
    <p style="margin:0 0 24px;">You can now log in, schedule flights, and manage your bookings.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Sign In to Your Account →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">If you have any questions, reply to this email and we'll get right back to you.</p>
  `);
  const text = `Hi ${name},\n\nYour New Tech Aviation account has been approved${approvedBy ? ` by ${approvedBy}` : ''}! Your ${roleLabel} account is now active.\n\nLogin at: ${APP_URL}/app\n\nQuestions? Just reply to this email.`;
  return { subject: `Account Approved — New Tech Aviation`, html, text };
}

/**
 * Rejection email — sent when admin/owner rejects a pending user.
 */
function rejectionEmail({ name }) {
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Account Application Declined</h2>
    <p style="margin:0 0 16px;">Hi ${escEmailHtml(name)},</p>
    <p style="margin:0 0 20px;">Thank you for your interest in New Tech Aviation. After review, we are unable to approve your account application at this time.</p>
    <p style="margin:0 0 24px;">If you have questions or believe this was in error, please reply to this email and we'll get back to you as soon as possible.</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">— New Tech Aviation</p>
  `);
  const text = `Hi ${name},\n\nThank you for your interest in New Tech Aviation. After review, we are unable to approve your account application at this time.\n\nIf you have questions, reply to this email.\n\n— New Tech Aviation`;
  return { subject: `Your Account Application — New Tech Aviation`, html, text };
}

/** Map database role to human-readable label */
function roleDisplayLabel(role) {
  const labels = {
    student: 'Student Pilot',
    instructor: 'Instructor (CFI)',
    admin: 'Admin',
    owner: 'Owner',
    maintenance: 'Maintenance',
    renter: 'Renter',
  };
  return labels[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Forgot password email — contains the reset link.
 */
function passwordResetEmail({ name, resetUrl }) {
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Reset Your Password</h2>
    <p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 24px;">We received a request to reset your New Tech Aviation password. Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${resetUrl}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Reset My Password →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;font-size:13px;color:#64748b;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:13px;color:#0EA5E9;word-break:break-all;">${resetUrl}</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
  `);
  const text = `Hi ${name},\n\nReset your New Tech Aviation password here:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`;
  return { subject: 'Reset your New Tech Aviation password', html, text };
}

/**
 * Invite email — sent when an owner/instructor creates an account for someone.
 */
function inviteEmail({ name, email, password, role, invitedByName }) {
  const roleLabel = roleDisplayLabel(role);
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">You've been added to New Tech Aviation ✈️</h2>
    <p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 24px;">${invitedByName ? `<strong>${invitedByName}</strong> has` : 'You have been'} added you to the New Tech Aviation scheduling platform as a <strong>${roleLabel}</strong>. Here are your login credentials:</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:80px;">Email</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${email}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Password</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${password}</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Sign In Now →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">You can change your password after logging in. If you have any questions, reply to this email.</p>
  `);
  const text = `Hi ${name},\n\nYou've been added to New Tech Aviation as ${roleLabel}.\n\nLogin at: ${APP_URL}/app\nEmail: ${email}\nPassword: ${password}\n\nYou can change your password after logging in.`;
  return { subject: `You've been added to New Tech Aviation`, html, text };
}

/**
 * Booking confirmation email — sent to student and instructor when a flight is booked.
 */
function bookingConfirmationEmail({ recipientName, studentName, instructorName, aircraftTailNumber, startTime, endTime, isStudent }) {
  const dateStr = new Date(startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const startStr = new Date(startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const endStr = new Date(endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Flight Booking Confirmed ✅</h2>
    <p style="margin:0 0 24px;">Hi ${recipientName}, your flight has been scheduled. Here are the details:</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Date</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Time</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${startStr} – ${endStr}</td>
      </tr>
      ${aircraftTailNumber ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${aircraftTailNumber}</td>
      </tr>` : ''}
      ${studentName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Student</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${studentName}</td>
      </tr>` : ''}
      ${instructorName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Instructor</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${instructorName}</td>
      </tr>` : ''}
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View Schedule →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Need to cancel or reschedule? Log in to manage your bookings.</p>
  `);
  const text = `Flight Booking Confirmed — New Tech Aviation\n\nDate: ${dateStr}\nTime: ${startStr} – ${endStr}\n${aircraftTailNumber ? `Aircraft: ${aircraftTailNumber}\n` : ''}${studentName ? `Student: ${studentName}\n` : ''}${instructorName ? `Instructor: ${instructorName}\n` : ''}\nView schedule: ${APP_URL}/app`;
  return { subject: `Flight Confirmed — ${dateStr} | New Tech Aviation`, html, text };
}

/**
 * Pre-flight reminder — sent to student 24hr before a confirmed flight.
 * Also sent to instructor if one is assigned.
 */
function preflightReminderEmailStudent({ recipientName, flightDate, flightTime, tailNumber, makeModel, instructorName, flightType, manageUrl }) {
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Your Flight is Tomorrow! ✈️</h2>
    <p style="margin:0 0 24px;">Hi ${escEmailHtml(recipientName)}, this is a reminder that your flight is scheduled for tomorrow. Please review the details below and confirm your aircraft is ready.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Date</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightDate)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Time</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightTime)}</td>
      </tr>
      ${tailNumber ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(tailNumber)} — ${escEmailHtml(makeModel || '')}</td>
      </tr>` : ''}
      ${instructorName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Instructor</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(instructorName)}</td>
      </tr>` : ''}
      ${flightType ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Flight Type</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightType)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Location</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">New Dublin Airport (KPSK) · Dublin, Virginia</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${manageUrl}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Manage Booking →</a>
        </td>
      </tr>
    </table>

    <div style="background:#FFF7ED;border-left:4px solid #D97706;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
      <p style="margin:0;color:#92400E;font-size:13px;">
        <strong>Need to cancel or reschedule?</strong> Log in anytime to manage your bookings.
      </p>
    </div>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Log in to view your schedule: ${APP_URL}/app</p>
  `);
  const text = `Hi ${recipientName},

Your flight is scheduled for tomorrow:
  Date: ${flightDate}
  Time: ${flightTime}
  ${tailNumber ? `Aircraft: ${tailNumber} — ${makeModel || ''}` : ''}
  ${instructorName ? `Instructor: ${instructorName}` : ''}
  ${flightType ? `Flight Type: ${flightType}` : ''}
  Location: New Dublin Airport (KPSK)

Manage your booking: ${manageUrl}

Need to cancel? Log in anytime to manage your bookings.

— New Tech Aviation`;

  return { subject: `Reminder: Flight scheduled tomorrow at ${flightTime}`, html, text };
}

/**
 * Pre-flight reminder — sent to instructor 24hr before a confirmed flight.
 */
function preflightReminderEmailInstructor({ recipientName, flightDate, flightTime, tailNumber, makeModel, studentName, flightType, manageUrl }) {
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#080E1A;">Flight Reminder — Tomorrow ✈️</h2>
    <p style="margin:0 0 24px;">Hi ${escEmailHtml(recipientName)}, this is a reminder that you have a flight scheduled for tomorrow.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Date</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightDate)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Time</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightTime)}</td>
      </tr>
      ${tailNumber ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(tailNumber)} — ${escEmailHtml(makeModel || '')}</td>
      </tr>` : ''}
      ${studentName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Student</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(studentName)}</td>
      </tr>` : ''}
      ${flightType ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Flight Type</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(flightType)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Location</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">New Dublin Airport (KPSK) · Dublin, Virginia</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${manageUrl}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Manage Booking →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Log in to view your schedule: ${APP_URL}/app</p>
  `);
  const text = `Hi ${recipientName},

You have a flight scheduled for tomorrow:
  Date: ${flightDate}
  Time: ${flightTime}
  ${tailNumber ? `Aircraft: ${tailNumber} — ${makeModel || ''}` : ''}
  ${studentName ? `Student: ${studentName}` : ''}
  ${flightType ? `Flight Type: ${flightType}` : ''}
  Location: New Dublin Airport (KPSK)

Manage your booking: ${manageUrl}

— New Tech Aviation`;

  return { subject: `Reminder: Flight scheduled tomorrow at ${flightTime}`, html, text };
}

/**
 * Flight completed notification — sent to student (and instructor if assigned)
 * after a flight booking is marked completed.
 */
function flightCompletedEmail({ recipientName, studentName, instructorName, tailNumber, makeModel, flightDate, startTime, endTime, hobbsHours, tachHours, completedBy, completedByRole, dualInstructionHours }) {
  const dateStr = new Date(flightDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const startStr = new Date(startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const endStr = new Date(endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const hobbsStr = hobbsHours != null ? `${parseFloat(hobbsHours).toFixed(1)} hrs` : null;
  const tachStr = tachHours != null ? `${parseFloat(tachHours).toFixed(1)} hrs` : null;
  const completedByLabel = completedByRole ? completedByRole.charAt(0).toUpperCase() + completedByRole.slice(1) : 'User';

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#16A34A;">Flight Completed ✅</h2>
    <p style="margin:0 0 24px;">Hi ${escEmailHtml(recipientName)}, your flight has been recorded. Here are the details:</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Status</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#16A34A;">Completed</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Date</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Time</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${startStr} – ${endStr}</td>
      </tr>
      ${tailNumber ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(tailNumber)}${makeModel ? ` — ${escEmailHtml(makeModel)}` : ''}</td>
      </tr>` : ''}
      ${studentName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Student</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(studentName)}</td>
      </tr>` : ''}
      ${instructorName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Instructor</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(instructorName)}</td>
      </tr>` : ''}
      ${hobbsStr ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Hobbs Hours</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${hobbsStr}</td>
      </tr>` : ''}
      ${tachStr ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Tach Hours</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${tachStr}</td>
      </tr>` : ''}
      ${dualInstructionHours && parseFloat(dualInstructionHours) > 0 ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Dual Instruction</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${parseFloat(dualInstructionHours).toFixed(1)} hrs</td>
      </tr>` : ''}
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Recorded By</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(completedBy)} (${completedByLabel})</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View Schedule →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Questions about your flight? Reply to this email and your instructor will get back to you.</p>
  `);

  const text = `Flight Completed\n\nDate: ${dateStr}\nTime: ${startStr} – ${endStr}\n${tailNumber ? `Aircraft: ${tailNumber}${makeModel ? ` — ${makeModel}` : ''}\n` : ''}${studentName ? `Student: ${studentName}\n` : ''}${instructorName ? `Instructor: ${instructorName}\n` : ''}${hobbsStr ? `Hobbs Hours: ${hobbsStr}\n` : ''}${tachStr ? `Tach Hours: ${tachStr}\n` : ''}${dualInstructionHours && parseFloat(dualInstructionHours) > 0 ? `Dual Instruction: ${parseFloat(dualInstructionHours).toFixed(1)} hrs\n` : ''}Recorded By: ${completedBy} (${completedByLabel})\n\nView schedule: ${APP_URL}/app`;

  return { subject: `Flight Completed — ${dateStr}`, html, text };
}

/**
 * Flight cancelled notification — sent to student (and instructor if assigned)
 * after a flight booking is cancelled.
 */
function flightCancelledEmail({ recipientName, studentName, instructorName, tailNumber, makeModel, flightDate, startTime, endTime, cancelledBy, cancelledByRole, cancellationReason }) {
  const dateStr = new Date(flightDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const startStr = new Date(startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const endStr = new Date(endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const cancelledByLabel = cancelledByRole ? cancelledByRole.charAt(0).toUpperCase() + cancelledByRole.slice(1) : 'User';

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#DC2626;">Flight Cancelled ❌</h2>
    <p style="margin:0 0 24px;">Hi ${escEmailHtml(recipientName)}, your scheduled flight has been cancelled. Here are the details:</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin:0 0 28px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;width:120px;">Status</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#DC2626;">Cancelled</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Date</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Time</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${startStr} – ${endStr}</td>
      </tr>
      ${tailNumber ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(tailNumber)}${makeModel ? ` — ${escEmailHtml(makeModel)}` : ''}</td>
      </tr>` : ''}
      ${studentName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Student</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(studentName)}</td>
      </tr>` : ''}
      ${instructorName ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Instructor</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(instructorName)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Cancelled By</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(cancelledBy)} (${cancelledByLabel})</td>
      </tr>
      ${cancellationReason ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Reason</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a202c;">${escEmailHtml(cancellationReason)}</td>
      </tr>` : ''}
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View Schedule →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Need to reschedule? Log in to book a new time.</p>
  `);

  const text = `Flight Cancelled\n\nDate: ${dateStr}\nTime: ${startStr} – ${endStr}\n${tailNumber ? `Aircraft: ${tailNumber}${makeModel ? ` — ${makeModel}` : ''}\n` : ''}${studentName ? `Student: ${studentName}\n` : ''}${instructorName ? `Instructor: ${instructorName}\n` : ''}Cancelled By: ${cancelledBy} (${cancelledByLabel})${cancellationReason ? `\nReason: ${cancellationReason}` : ''}\n\nView schedule: ${APP_URL}/app`;

  return { subject: `Flight Cancelled — ${dateStr} | New Tech Aviation`, html, text };
}

/**
 * Grounding squawk notification — sent to all admin/owner/instructor users
 * when a squawk with severity "grounding" is created or changed to grounding.
 */
function groundingSquawkEmail({ recipientName, tailNumber, makeModel, description, reporterName, reportedAt, expectedDowntime }) {
  const dateStr = new Date(reportedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const downtimeStr = expectedDowntime || 'Unknown / TBD';

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#DC2626;">&#9888; Aircraft Grounded: ${escEmailHtml(tailNumber)}</h2>
    <p style="margin:0 0 20px;color:#374151;">A grounding squawk has been reported. This aircraft <strong>must not fly</strong> until the issue is resolved.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:20px;margin:0 0 24px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#6B7280;width:140px;vertical-align:top;">Aircraft</td>
        <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;">${escEmailHtml(tailNumber)}${makeModel ? ` — ${escEmailHtml(makeModel)}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#6B7280;vertical-align:top;">Issue</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;">${escEmailHtml(description)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#6B7280;">Reported By</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;">${escEmailHtml(reporterName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#6B7280;">Date Reported</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#6B7280;">Est. Downtime</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:${expectedDowntime ? '#DC2626' : '#6B7280'};">${escEmailHtml(downtimeStr)}</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#0EA5E9;border-radius:7px;padding:13px 28px;">
          <a href="${APP_URL}/app" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View Maintenance Log →</a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Log in to review and update the squawk status once the issue has been resolved.</p>
  `);

  const text = `AIRCRAFT GROUNDED: ${tailNumber}\n\nA grounding squawk has been submitted. This aircraft must not fly.\n\nAircraft: ${tailNumber}${makeModel ? ` — ${makeModel}` : ''}\nIssue: ${description}\nReported By: ${reporterName}\nDate: ${dateStr}\nEst. Downtime: ${downtimeStr}\n\nLog in to review: ${APP_URL}/app`;

  return {
    subject: `[GROUNDED] ${tailNumber} — Grounding Squawk Reported`,
    html,
    text,
  };
}

/** Minimal HTML escaping for use inside email template strings */
function escEmailHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendEmail,
  ADMIN_NOTIFICATION_EMAILS,
  welcomeEmail,
  passwordResetEmail,
  inviteEmail,
  bookingConfirmationEmail,
  groundingSquawkEmail,
  adminApprovalNotificationEmail,
  pendingApprovalEmail,
  approvalConfirmationEmail,
  rejectionEmail,
  preflightReminderEmailStudent,
  preflightReminderEmailInstructor,
  flightCompletedEmail,
  flightCancelledEmail,
};
