import { readFileSync, writeFileSync } from 'fs';

const fs = require('fs');
const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

// Show current state
const roleIdx = line.indexOf('+ u.role +');
if (roleIdx < 0) { console.log('u.role not found!'); process.exit(1); }
console.log('Current line from u.role:');
console.log(JSON.stringify(line.substring(roleIdx, roleIdx + 120)));

// The file has: + u.role + '," + (!!u.is_instructor
// We want:      + u.role + '\"," + (!!u.is_instructor

// Check what the patterns look like in this script
const testBad = "+ u.role + '\",\" + (!!u.is_instructor";
const testGood = "+ u.role + '\", \" + (!!u.is_instructor";

console.log('\ntestBad:', JSON.stringify(testBad));
console.log('testGood:', JSON.stringify(testGood));

// What does the file actually have?
const filePart = line.substring(roleIdx, roleIdx + 50);
console.log('\nFile part:', JSON.stringify(filePart));

// The fix
const bad = "\"\"," + \" + (!!u.is_instructor\";
const good = "\"\"," + \" + (!!u.is_instructor\";
// No wait - let me think differently.
// file has: ',  + (
// We want:  '\/,  + (
// So: '," + (  ->  '\/,  + (

const bad2 = "'\",  + (!!u.is_instructor";
const good2 = "'\",\" + (!!u.is_instructor";

console.log('\nbad2:', JSON.stringify(bad2));
console.log('good2:', JSON.stringify(good2));
console.log('file match:', filePart.includes(bad2) ? 'YES' : 'NO');

// Hmm, let me just do a direct string replacement
const broken = "'\",\" + (!!u.is_instructor";
const fixed = "'\",\" + (!!u.is_instructor";

if (line.includes(broken)) {
  console.log('\nFound broken pattern!');
  const newLine = line.replace(broken, fixed);
  lines[8743] = newLine;
  writeFileSync('public/app.html', lines.join('\n'));
  console.log('Fixed!');
} else {
  console.log('\nBroken pattern not found, checking alternate...');
  // Try different variations
  const alt1 = "'\"," + \" + (!!u.is_instructor\";
  const alt2 = "'\",  + (!!u.is_instructor\";
  console.log('alt1 in line:', line.includes(alt1) ? 'YES' : 'NO');
  console.log('alt2 in line:', line.includes(alt2) ? 'YES' : 'NO');

  // Just do a simple replacement of the specific characters
  // The file has: + u.role + '," + (!!u.is_instructor
  // We need:      + u.role + '\", " + (!!u.is_instructor
  // That's: replace '," + (  with  '\", " + (
  const simpleBad = "'\",\" + (";
  const simpleGood = "'\",\" + (";

  if (line.includes(simpleBad)) {
    console.log('\nFound simple broken pattern!');
    const newLine = line.replace(simpleBad, simpleGood);
    try {
      new Function(newLine);
      console.log('JS syntax: PASS');
      lines[8743] = newLine;
      writeFileSync('public/app.html', lines.join('\n'));
      console.log('File written!');
    } catch(e) {
      console.log('JS syntax: FAIL -', e.message);
    }
  } else {
    console.log('No pattern matched!');
    console.log('File part:', JSON.stringify(filePart));
    // Try character-by-character comparison
    for (let i = 0; i < Math.min(30, filePart.length); i++) {
      console.log(i, JSON.stringify(filePart[i]), filePart.charCodeAt(i));
    }
  }
}