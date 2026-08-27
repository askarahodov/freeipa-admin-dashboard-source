import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const skipDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'docs/superpowers']);

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

function walk(dir = '.') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir === '.' ? '' : dir, entry.name);
    if (entry.isDirectory()) {
      if ([...skipDirs].some((skip) => rel === skip || rel.startsWith(`${skip}/`))) continue;
      out.push(...walk(rel));
    } else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const files = walk();
const markdown = files.filter((file) => file.endsWith('.md'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmScripts = new Set(Object.keys(packageJson.scripts ?? {}));

for (const file of markdown) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const base = path.posix.dirname(file);

  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:)/i.test(raw)) continue;
    const target = decodeURIComponent(raw.split('#')[0].split('?')[0]);
    if (!target) continue;
    const resolved = path.posix.normalize(path.posix.join(base, target));
    if (!fs.existsSync(path.join(root, resolved))) fail(file, `broken internal Markdown link: ${raw}`);
  }

  for (const match of text.matchAll(/`npm run(?: --silent)? ([A-Za-z0-9:_-]+)`/g)) {
    if (!npmScripts.has(match[1])) fail(file, `documented npm script does not exist: ${match[1]}`);
  }
}

const activeDocs = markdown.filter((file) => file === 'README.md' || file.startsWith('docs/'));
for (const file of activeDocs) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (/production runtime still uses the development-oriented Wrangler local command/i.test(text)) {
    fail(file, 'obsolete production-runtime claim: Wrangler local mode is no longer canonical production startup');
  }
  if (/current production command still starts local Wrangler development mode/i.test(text)) {
    fail(file, 'obsolete production-runtime claim: current production command is canonical Node runtime');
  }
}

if (failures.length) {
  console.error('Documentation consistency guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation consistency guard passed (${markdown.length} Markdown files checked; docs/superpowers excluded).`);
