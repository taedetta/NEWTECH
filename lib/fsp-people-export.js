'use strict';

/**
 * Flight Schedule Pro — People Import export
 * Column order matches FSP "People Import Template" (Data tab, updated 2025-09-22).
 * @see https://support.flightschedulepro.com/en/articles/11498473-importing-users
 */
const zlib = require('zlib');

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
  return buildMinimalXlsx(rows);
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

function xmlEscape(value) {
  return String(value ?? '')
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

function buildWorksheetXml(rows) {
  const lastColumn = rows[0]?.length ? columnName(rows[0].length - 1) : 'A';
  const dimension = `A1:${lastColumn}${Math.max(rows.length, 1)}`;
  const rowXml = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowNumber}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${rowXml}</sheetData></worksheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function buildZip(files) {
  const { dosTime, dosDate } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const compressed = zlib.deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildMinimalXlsx(rows) {
  return buildZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: buildWorksheetXml(rows),
    },
  ]);
}

module.exports = {
  FSP_COLUMNS,
  splitPersonName,
  mapFspRoles,
  buildFspRow,
  buildFspWorkbook,
  buildFspCsv,
};
