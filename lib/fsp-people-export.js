'use strict';

/**
 * Flight Schedule Pro — People Import export
 * Column order matches FSP "People Import Template" (Data tab, updated 2025-09-22).
 * @see https://support.flightschedulepro.com/en/articles/11498473-importing-users
 */
const XLSX = require('xlsx');

/** Exact header row from FSP People Import Template → Data sheet */
const FSP_COLUMNS = [
  'FSP People guid',
  'Status',
  'First Name',
  'Middle Name',
  'Last Name',
  'Suffix',
  'Legal First',
  'Legal Middle Name',
  'Legal Last',
  'Legal Suffix',
  'Address Line 1',
  'Address Line 2',
  'City',
  'State/Province',
  'Zip/Postal Code',
  'Country Code',
  'Email',
  'Send Email Invite',
  'Phone',
  'Role',
  'Location',
  'Default Location',
  'Add to Group',
  'Company Name',
  'External ID',
  'Date of Birth',
  'Gender',
  'Balance',
  'Note',
  'Internal Note?',
  'Instructor',
  'Mechanic',
  'Last Flight',
  'Labels',
];

function splitPersonName(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return { first: '', middle: '', last: '' };
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0], middle: '', last: parts[0] };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(' '),
    last: parts[parts.length - 1],
  };
}

/**
 * Map FlightSlate role → FSP Role column (comma-separated, must match FSP settings).
 * Staff/Student/Instructor/Renter are common FSP role names.
 */
function mapFspRoles(user) {
  const roles = [];
  const role = user.role;
  const isInstr = !!user.is_instructor || role === 'instructor';

  if (role === 'student') roles.push('Student');
  else if (role === 'renter') roles.push('Renter');
  else if (role === 'instructor') roles.push('Instructor');
  else if (role === 'maintenance') roles.push('Mechanic');
  else if (role === 'admin') {
    if (isInstr) roles.push('Instructor');
    roles.push('Staff');
  } else if (role === 'owner') {
    if (isInstr) roles.push('Instructor');
    roles.push('Staff');
  } else {
    roles.push('Student');
  }

  return [...new Set(roles)].join(',');
}

function formatPhone(phone) {
  if (!phone) return '';
  return String(phone).trim().slice(0, 50);
}

function buildFspRow(user, options) {
  const { location, defaultLocation, companyName } = options;
  const { first, middle, last } = splitPersonName(user.name);
  const isInstr = !!user.is_instructor || user.role === 'instructor';
  const isMech = user.role === 'maintenance';

  const row = Object.fromEntries(FSP_COLUMNS.map(c => [c, '']));

  row['Status'] = 'Active';
  row['First Name'] = first.slice(0, 50);
  row['Middle Name'] = middle.slice(0, 50);
  row['Last Name'] = last.slice(0, 50);
  row['Legal First'] = first.slice(0, 50);
  row['Legal Last'] = last.slice(0, 50);
  if (middle) row['Legal Middle Name'] = middle.slice(0, 50);
  row['Email'] = user.email ? String(user.email).trim().slice(0, 64) : '';
  row['Send Email Invite'] = 'No';
  row['Phone'] = formatPhone(user.phone_number);
  row['Role'] = mapFspRoles(user);
  row['Location'] = location;
  if (defaultLocation) row['Default Location'] = defaultLocation;
  if (companyName) row['Company Name'] = companyName.slice(0, 100);
  row['External ID'] = `flightslate-${user.id}`.slice(0, 50);
  row['Note'] = 'Exported from FlightSlate'.slice(0, 1000);
  row['Instructor'] = isInstr ? 'Yes' : 'No';
  row['Mechanic'] = isMech ? 'Yes' : 'No';

  return FSP_COLUMNS.map(col => row[col] ?? '');
}

function buildFspWorkbook(users, options) {
  const rows = [FSP_COLUMNS, ...users.map(u => buildFspRow(u, options))];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildFspCsv(users, options) {
  const escape = (val) => {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    FSP_COLUMNS.map(escape).join(','),
    ...users.map(u => buildFspRow(u, options).map(escape).join(',')),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

module.exports = {
  FSP_COLUMNS,
  splitPersonName,
  mapFspRoles,
  buildFspRow,
  buildFspWorkbook,
  buildFspCsv,
};
