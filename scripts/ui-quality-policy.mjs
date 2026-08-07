import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sharedUiRoots = ["app/ui", "app/shell", "app/overview"];

export function parseHexTokens(css) {
  return Object.fromEntries(Array.from(String(css).matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/giu), (match) => [match[1], match[2].toLowerCase()]));
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const normalized = String(hex).replace(/^#/u, "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) throw new Error(`Invalid RGB hex color: ${hex}`);
  const red = channel(Number.parseInt(normalized.slice(0, 2), 16));
  const green = channel(Number.parseInt(normalized.slice(2, 4), 16));
  const blue = channel(Number.parseInt(normalized.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground, background) {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

async function collectCssFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith(".css")) files.push(target);
    }
  }
  await walk(root);
  return files.sort();
}

export async function sharedUiCssFiles(repositoryRoot = process.cwd()) {
  const nested = await Promise.all(sharedUiRoots.map((root) => collectCssFiles(path.join(repositoryRoot, root))));
  return nested.flat().sort();
}

export function cssPolicyViolations(source, filename = "<css>") {
  const violations = [];
  const lines = String(source).split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    if (lower.includes("linear-gradient(")) violations.push(`${filename}:${index + 1}: gradients are not allowed in shared UI`);
    if (lower.includes("translatey(")) violations.push(`${filename}:${index + 1}: hover-lift translateY is not allowed in shared UI`);
    if (lower.includes("text-shadow")) violations.push(`${filename}:${index + 1}: text shadow is not allowed in shared UI`);
    if (lower.includes("drop-shadow(")) violations.push(`${filename}:${index + 1}: drop shadow is not allowed in shared UI`);
    if (lower.includes("box-shadow") && !lower.includes("var(--ui-shadow-overlay)")) {
      violations.push(`${filename}:${index + 1}: only canonical overlay elevation is allowed`);
    }
  }
  return violations;
}

export async function scanSharedUiCss(repositoryRoot = process.cwd()) {
  const files = await sharedUiCssFiles(repositoryRoot);
  const violations = [];
  for (const filename of files) {
    const source = await readFile(filename, "utf8");
    violations.push(...cssPolicyViolations(source, path.relative(repositoryRoot, filename)));
  }
  return { files, violations };
}
