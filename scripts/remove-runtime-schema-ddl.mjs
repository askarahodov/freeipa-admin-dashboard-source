import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", ".next", ".wrangler", "dist", "node_modules", "tests"]);
const owners = new Set(["db/portal-migration-v1.ts", "db/portal-migrations.ts", "db/portal-schema.ts"]);
const ddl = /\b(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REINDEX)\b/i;

async function files(directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) output.push(absolute);
  }
  return output;
}

function matchingBrace(source, open) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function removeSchemaEnsureFunctions(source) {
  const removed = [];
  const pattern = /(?:export\s+)?async\s+function\s+(ensure[A-Za-z0-9_]*)\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>)?\s*\{/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = source.indexOf("{", match.index);
    const close = matchingBrace(source, open);
    if (close < 0) break;
    const body = source.slice(open + 1, close);
    if (!ddl.test(body)) continue;
    removed.push(match[1]);
    let end = close + 1;
    while (source[end] === "\r" || source[end] === "\n") end += 1;
    source = source.slice(0, match.index) + source.slice(end);
    pattern.lastIndex = match.index;
  }
  for (const name of removed) {
    const call = new RegExp(`^[\\t ]*await\\s+${name}\\([^;]*\\);[\\t ]*\\r?\\n`, "gm");
    source = source.replace(call, "");
  }
  return source;
}

function removeDdlConstants(source) {
  const pattern = /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*/gm;
  let match;
  while ((match = pattern.exec(source))) {
    let index = pattern.lastIndex;
    const quote = source[index];
    if (!['"', "'", "`"].includes(quote)) continue;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const char = source[index];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) break;
      index += 1;
    }
    if (index >= source.length) continue;
    let end = index + 1;
    while (/\s/.test(source[end] ?? "")) end += 1;
    if (source[end] !== ";") continue;
    end += 1;
    while (source[end] === "\r" || source[end] === "\n") end += 1;
    const declaration = source.slice(match.index, end);
    if (!ddl.test(declaration)) continue;
    source = source.slice(0, match.index) + source.slice(end);
    pattern.lastIndex = match.index;
  }
  return source;
}

function removeInlineDdlStatements(source) {
  return source.replace(
    /^[\t ]*await\s+[^\n;]*prepare\((?:`[^`]*`|'[^']*'|"[^"]*")\)[^\n;]*\.run\(\);[\t ]*\r?\n/gm,
    (statement) => ddl.test(statement) ? "" : statement,
  );
}

for (const absolute of await files()) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (owners.has(relative)) continue;
  const original = await readFile(absolute, "utf8");
  let next = removeSchemaEnsureFunctions(original);
  next = removeDdlConstants(next);
  next = removeInlineDdlStatements(next);
  if (next !== original) {
    await writeFile(absolute, next);
    console.log(`updated ${relative}`);
  }
}
