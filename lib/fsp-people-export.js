'use strict';

/**
 * Flight Schedule Pro — People Import export
 * Column order matches FSP "People Import Template" (Data tab, updated 2025-09-22).
 * @see https://support.flightschedulepro.com/en/articles/11498473-importing-users
 */
const { ZipArchive } = require('archiver');

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

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const sheetRows = rows.map((row, rIdx) => {
    const cells = row.map((value, cIdx) => {
      const ref = `${columnName(cIdx)}${rIdx + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function zipEntries(entries) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, content] of entries) {
      archive.append(content, { name });
    }
    archive.finalize().catch(reject);
  });
}

async function buildFspWorkbook(users, options) {
  const rows = [FSP_COLUMNS, ...users.map(u => buildFspRow(u, options))];
  return zipEntries([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
    ['xl/worksheets/sheet1.xml', worksheetXml(rows)],
  ]);
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
