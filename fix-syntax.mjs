import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

// The problematic section:
// ... + u.role + '," + (!!u.is_instructor ? 'true' : 'false') + '"\")">&#9998;</button>' : '';
//
// We need:
// ... + u.role + '\/', (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';

// Find the marker
const marker = "(!!u.is_instructor ? 'true' : 'false')";
const idx = line.indexOf(marker);
if (idx < 0) {
  console.log("ERROR: marker not found!");
  process.exit(1);
}

// What's before the marker?
const before = line.substring(0, idx);
const after = line.substring(idx + marker.length);

console.log("Before marker:", JSON.stringify(before.slice(-60)));
console.log("After marker:", JSON.stringify(after.slice(0, 80)));

// Build the new line
const newAfter = " + ')\">&#9998;</button>' : '';";
const newLine = before + marker + newAfter;

console.log("\nNew ending:", JSON.stringify(newLine.slice(-60)));

// Verify the new line parses as valid JS
try {
  new Function(newLine);
  console.log("JS syntax: OK");
} catch (e) {
  console.log("JS syntax error:", e.message);
}

// Write back
lines[8743] = newLine;
writeFileSync('public/app.html', lines.join('\n'));
console.log("\nFix applied!");