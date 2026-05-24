import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

console.log('Current u.role context:');
const roleIdx = line.indexOf('+ u.role +');
if (roleIdx >= 0) {
  console.log(JSON.stringify(line.substring(roleIdx, roleIdx + 100)));
}
console.log('');

// The file has: + u.role + '," + (!!u.is_instructor ? 'true' : 'false') + ')">...
// We need:      + u.role + '\"," + (!!u.is_instructor ? 'true' : 'false') + ')">...

// bad = match the broken ',  + (!!u pattern
// good = what to replace it with: '\/,  + (!!u.is_instructor

// In the file: '," + (
// We want:      '\",  + (

// In a double-quoted string:
// \" = backslash character (no escape)
// So: '," + (!!u = single-quote, comma, space, double-quote, space, plus, space, open-paren

const bad = "+ u.role + '\",  + (!!u.is_instructor";
const good = "+ u.role + '\"," + (!!u.is_instructor";

console.log('Looking for bad:', JSON.stringify(bad));
console.log('Will replace with good:', JSON.stringify(good));
console.log('');

if (line.includes(bad)) {
  const newLine = line.replace(bad, good);
  console.log('Pattern matched and replaced!');

  // Verify JS syntax of the full line
  try {
    new Function(newLine);
    console.log('JS syntax: PASS');
  } catch(e) {
    console.log('JS syntax: FAIL -', e.message);
    console.log('New line:', newLine.substring(roleIdx, roleIdx + 80));
  }

  lines[8743] = newLine;
  writeFileSync('public/app.html', lines.join('\n'));
  console.log('File written!');
} else {
  console.log('Pattern not found!');
  // Show what's actually there
  const idx = line.indexOf('!!u.is_instructor');
  if (idx >= 0) {
    console.log('Around !!u.is_instructor:', JSON.stringify(line.substring(idx - 40, idx + 80)));
  }
}