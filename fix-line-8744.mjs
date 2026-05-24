import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');

// Read the file
const content = fs.readFileSync('public/app.html', 'utf8');
const lines = content.split('\n');

// The FIXED line 8744 (0-indexed: line 8743)
const fixedLine = `      var editRoleBtn = isOwner && !isSelf ? ' <button style="background:none;border:none;cursor:pointer;color:var(--gray-400);font-size:0.85rem;padding:0.15rem 0.3rem;border-radius:4px;line-height:1;vertical-align:middle;transition:color 0.15s" title="Edit user" onmouseover="this.style.color=\\'var(--sky)\\'" onmouseout="this.style.color=\\'var(--gray-400)\\'" onclick="openRoleChangeModal(' + u.id + ',\\'' + escHtml(u.name).replace(/'/g,"\\\\'") + '\\',\\'' + u.role + '\\', ' + (!!u.is_instructor ? 'true' : 'false') + ')">&#9998;</button>' : '';`;

console.log('Fixed line:');
console.log(fixedLine);

// Verify JS syntax
try {
  new Function(fixedLine);
  console.log('\nJS syntax: PASS');
} catch (e) {
  console.log('\nJS syntax FAIL:', e.message);
  process.exit(1);
}

// Replace line 8744 (0-indexed: 8743)
lines[8743] = fixedLine;

fs.writeFileSync('public/app.html', lines.join('\n'));
console.log('\nFile updated!');