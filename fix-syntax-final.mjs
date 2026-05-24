import { readFileSync, writeFileSync } from 'fs';

const fs = require('fs');
const lines = fs.readFileSync('public/app.html', 'utf8').split('\n');
const line = lines[8743];

console.log('=== Line 8744 before ===');
console.log(line.substring(line.indexOf('+ u.role +'), line.indexOf('+ u.role +') + 200));

// The file has:
// + u.role + '," + (!!u.is_instructor ? 'true' : 'false') + ')\">&#9998;</button>' : '';
//
// We need:
// + u.role + '\/, ' + (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';

// Step 1: Fix '," + -> '\/,
const step1 = line.replace("'\",  + (!!u.is_instructor", "'\",  + (!!u.is_instructor"));
if (step1 === line) {
  // Try without spaces
  const step1b = line.replace("'\",\" + (!!u.is_instructor", "'\", \" + (!!u.is_instructor"));
  if (step1b !== line) {
    console.log('Applied step1b (with quote-char)');
  } else {
    console.log('Step 1 pattern not found!');
  }
} else {
  console.log('Applied step1');
}

// Step 2: Fix + ')\")" -> + ')"
const step2 = step1.replace(" + ')\")\">", " + ')')\">");
console.log('After step2, last 80:', step2.slice(-80));

lines[8743] = step2;
fs.writeFileSync('public/app.html', lines.join('\n'));
console.log('\nWritten!');