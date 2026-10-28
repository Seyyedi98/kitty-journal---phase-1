// Regenerates the lucide icon stand-ins from every lucide import in the app.
// Run:  node tests/browser/gen-icons.cjs
const fs = require('fs'), path = require('path');
const names = new Set();
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'tests'].includes(f.name)) continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.js$/.test(f.name)) {
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react-native['"]/g))
        m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n));
    }
  }
})('.');
const p = 'tests/browser/stubs/misc.jsx';
let s = fs.readFileSync(p, 'utf8');
const a = s.indexOf('export const iconProxy'), b = s.indexOf('// Chainable');
s = s.slice(0, a) + 'export const iconProxy = { __esModule: true, ' + [...names].sort().map((n) => `${n}: mk('${n}')`).join(', ') + ' };\n\n' + s.slice(b);
fs.writeFileSync(p, s);
console.log([...names].sort().join(' '));
