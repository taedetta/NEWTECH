import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

console.log('Line 8744 full:');
console.log(line);
console.log('---');

// Find the problematic area
const marker = "+ u.role +";
const idx = line.indexOf(marker);
if (idx < 0) {
  console.log("ERROR: u.role marker not found!");
  process.exit(1);
}

const before = line.substring(0, idx + marker.length);
const after = line.substring(idx + marker.length);

console.log('\nBefore u.role+:');
console.log(before);
console.log('\nAfter u.role+:');
console.log(after);
console.log('\nAfter (JSON):');
console.log(JSON.stringify(after.substring(0, 120)));

// Check what we need to replace
// The after part currently starts with: '," + (!!u.is_instructor ? 'true' : 'false') + '"\")">&#9998;</button>' : '';
// We need: '\/', (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';

const badStart = after.substring(0, 10);
console.log('\nFirst 10 chars after u.role+:', JSON.stringify(badStart));

// The fix: change '," + (!!u.is_instructor ... to '\/, (!!u.is_instructor ...
// (replace '," with '\/, and remove '"\\'\") part later)

// Build the corrected after
const oldPattern = after.substring(0, 30);
const newPattern = after.substring(0, 3) + '\\, ' + after.substring(5);
console.log('\nOld pattern (first 30):', JSON.stringify(oldPattern));
console.log('New pattern (first 30):', JSON.stringify(newPattern));

// Actually let's be more surgical. The issue is:
// after u.role+: '," + (!!u.is_instructor ? 'true' : 'false') + '"\")">&#9998;</button>' : '';
// We need:   ', ' + (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';

const fixedAfter = after
  .replace(/^'\"," \/ \/\/\//, "") // this won't work, use index-based
  .replace("'\"," + (!!u.is_instructor", "', ' + (!!u.is_instructor")
  .replace(" + '\"\\\\)\")\">", ")">")
  .replace(" + '\"\\\\)\")\\"", ")">");

// Simpler approach: just do string replacement
const oldBad = "'\\\"\\\\\\)\\),\")\">";
const newGood = "')">";

console.log('\nTrying simple replace...');
if (after.includes("'\"\\\\)\"))")) {
  console.log('Found complex pattern');
  const newAfter2 = after.replace("'\"\\\\)\"))", "')>");
  const newLine = before + newAfter2;
  lines[8743] = newLine;
  writeFileSync('public/app.html', lines.join('\n'));
  console.log('Fixed!');
} else if (after.includes("'\")\\")) {
  console.log('Found simpler pattern');
  const newAfter2 = after.replace("'\")\\", "')");
  const newLine = before + newAfter2;
  lines[8743] = newLine;
  writeFileSync('public/app.html', lines.join('\n'));
  console.log('Fixed!');
} else {
  console.log('Pattern not found, trying to fix the u.role + " , + " issue');
  // Fix: '," +  ->  '\/,  +
  // The '," +  part is: ' followed by " followed by , followed by space followed by + followed by space
  // In the file it's: single-quote, double-quote, comma, space, +, space
  const fixedAfter3 = after.replace("'\",  +", "',  +");
  if (fixedAfter3 !== after) {
    const newLine = before + fixedAfter3;
    console.log('Applied u.role fix');
    lines[8743] = newLine;
    writeFileSync('public/app.html', lines.join('\n'));
    console.log('Fixed!');
  } else {
    console.log('Could not find pattern to fix');
    console.log('After (raw):', after);
  }
}