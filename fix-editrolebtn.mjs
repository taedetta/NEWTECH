import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

console.log('Current line 8744:');
console.log(line);
console.log('');

// The broken part: + u.role + '," + (!!u.is_instructor
// We want:          + u.role + '\/, ' + (!!u.is_instructor

// In the file, the exact string '," + (  is: single-quote, comma, double-quote, space, plus, space, open-paren
// We want to replace it with: '\/, (  = single-quote, backslash, single-quote, comma, space, open-paren

// Also need to fix: + (!!u.is_instructor ? 'true' : 'false') + ')
const bad = "+ u.role + ',\" + (!!u.is_instructor ? 'true' : 'false') + ')";
const good = "+ u.role + '\\', ' + (!!u.is_instructor ? 'true' : 'false') + ')'";

console.log('Searching for bad:', JSON.stringify(bad));
console.log('Replacing with:', JSON.stringify(good));
console.log('');

if (line.includes(bad)) {
  const newLine = line.replace(bad, good);
  console.log('Replacement done!');
  console.log('New line (from u.role):');
  const roleIdx = newLine.indexOf('+ u.role +');
  console.log(newLine.substring(roleIdx, roleIdx + 120));

  // Verify JS syntax
  try {
    new Function(newLine);
    console.log('JS syntax: PASS');
  } catch(e) {
    console.log('JS syntax: FAIL -', e.message);
  }

  lines[8743] = newLine;
  writeFileSync('public/app.html', lines.join('\n'));
  console.log('File written!');
} else {
  console.log('Pattern not found!');

  // Check what's in the file
  const roleIdx = line.indexOf('+ u.role +');
  if (roleIdx >= 0) {
    const ctx = line.substring(roleIdx, roleIdx + 150);
    console.log('File has:', JSON.stringify(ctx));
  }
}