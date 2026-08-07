import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export function createExecutionContext() {
  const pending = new Set();

  return {
    waitUntil(promise) {
      const tracked = Promise.resolve(promise).finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    passThroughOnException() {},
    async drain() {
      await Promise.allSettled([...pending]);
    },
  };
}

export function nodeRequestToWebRequest(request, origin) {
  const method = String(request.method || "GET").toUpperCase();
  const url = new URL(request.url || "/", origin);
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }

  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(url, init);
}

export async function writeWebResponse(responseStream, response) {
  responseStream.statusCode = response.status;
  if (response.statusText) responseStream.statusMessage = response.statusText;

  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];

  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie" && setCookies.length > 0) continue;
    responseStream.setHeader(name, value);
  }
  if (setCookies.length > 0) responseStream.setHeader("set-cookie", setCookies);

  if (!response.body) {
    responseStream.end();
    return;
  }

  await new Promise((resolvePromise, reject) => {
    const body = Readable.fromWeb(response.body);
    body.once("error", reject);
    responseStream.once("error", reject);
    responseStream.once("finish", resolvePromise);
    body.pipe(responseStream);
  });
}

function safeAssetPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) return null;
  return candidate;
}

export function createStaticAssetsFetcher(assetsRoot) {
  const root = resolve(assetsRoot);

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const path = safeAssetPath(root, url.pathname);
      if (!path) return new Response("Not Found", { status: 404 });

      let info;
      try {
        info = await stat(path);
      } catch {
        return new Response("Not Found", { status: 404 });
      }
      if (!info.isFile()) return new Response("Not Found", { status: 404 });

      const body = await readFile(path);
      const headers = new Headers({
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(body.byteLength),
        "content-type": contentTypes.get(extname(path).toLowerCase()) ?? "application/octet-stream",
      });
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    },
  };
}
