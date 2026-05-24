import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');
const line = lines[8743];

console.log('Current line 8744:');
console.log(line);
console.log('---');

// Step 1: Find and fix the problematic '," + (!!u.is_instructor part
// The line has: + u.role + '," + (!!u.is_instructor ? 'true' : 'false') + '"\")">&#9998;</button>' : '';
// We need:   + u.role + '\/, ' + (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';

// Step 1: Replace '," + (!!u.is_instructor with '\/, ' + (!!u.is_instructor
let fixed = line;
const bad1 = "'\",  + (!!u.is_instructor";
const good1 = "',  + (!!u.is_instructor";
if (fixed.includes(bad1)) {
  fixed = fixed.replace(bad1, good1);
  console.log('Applied fix 1: replaced "\", +" with "\/, "');
} else {
  // Try without spaces
  const bad1b = "'\"," + " + (!!u.is_instructor";
  if (fixed.includes(bad1b)) {
    fixed = fixed.replace(bad1b, good1);
    console.log('Applied fix 1b');
  } else {
    console.log('Pattern 1 not found. Searching...');
    // Look for the actual pattern
    const idx = fixed.indexOf("+ u.role +");
    if (idx >= 0) {
      const ctx = fixed.substring(idx, idx + 120);
      console.log('Context after u.role+:', JSON.stringify(ctx));
    }
  }
}

// Step 2: Replace + '"\\")\")">  with + ')">
// The current end is: + '"\")\")">&#9998;</button>'
// We need:               + ')">&#9998;</button>'
const bad2 = " + '\"" + "\\\\" + ")\")\">";
const good2 = " + ')">';
if (fixed.includes(bad2)) {
  fixed = fixed.replace(bad2, good2);
  console.log('Applied fix 2');
} else {
  // Look for the actual pattern
  const idx = fixed.indexOf("!!u.is_instructor");
  if (idx >= 0) {
    const ctx = fixed.substring(idx, idx + 100);
    console.log('Context from instructor check:', JSON.stringify(ctx));
  }
}

console.log('\nNew line 8744:');
console.log(fixed);

// Test syntax by trying to parse as JS
try {
  // Just check the editRoleBtn line is valid JS
  const fn = new Function(fixed);
  console.log('\nJS syntax check: PASS');
} catch (e) {
  console.log('\nJS syntax check: FAIL -', e.message);
}

// Write back
lines[8743] = fixed;
writeFileSync('public/app.html', lines.join('\n'));
console.log('\nFile updated!');