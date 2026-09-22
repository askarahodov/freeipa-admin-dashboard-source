import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { handleFrameworkHttpRequest } from "../../worker/framework-http.ts";

function env() {
  return {
    ASSETS: {
      async fetch() {
        return new Response("asset");
      },
    },
    IMAGES: {
      input() {
        return {
          transform() {
            return {
              async output() {
                return { response: () => new Response("image") };
              },
            };
          },
        };
      },
    },
  };
}

test("framework owner routes Vinext image requests without app fallback", async () => {
  const calls = [];
  const request = new Request("https://portal.test/_vinext/image?url=%2Flogo.png&w=64");
  const response = await handleFrameworkHttpRequest(request, env(), {}, {
    async image(nextRequest) {
      calls.push(["image", nextRequest.url]);
      return new Response("optimized");
    },
    async app() {
      calls.push(["app"]);
      return new Response("unexpected");
    },
  });

  assert.equal(await response.text(), "optimized");
  assert.deepEqual(calls, [["image", request.url]]);
});

test("framework owner rewrites known HTML application routes to root without losing request metadata", async () => {
  const calls = [];
  const request = new Request("https://portal.test/settings?tab=general", {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "x-test": "preserved",
    },
  });

  const response = await handleFrameworkHttpRequest(request, env(), { marker: "ctx" }, {
    async image() {
      return new Response("unexpected");
    },
    async app(nextRequest, _env, ctx) {
      calls.push({
        pathname: new URL(nextRequest.url).pathname,
        search: new URL(nextRequest.url).search,
        header: nextRequest.headers.get("x-test"),
        ctx,
      });
      return new Response("app");
    },
  });

  assert.equal(await response.text(), "app");
  assert.deepEqual(calls, [{
    pathname: "/",
    search: "?tab=general",
    header: "preserved",
    ctx: { marker: "ctx" },
  }]);
});

test("framework owner passes ordinary static and RSC requests through unchanged", async () => {
  const request = new Request("https://portal.test/_next/static/chunk.js", {
    headers: { accept: "*/*" },
  });
  let received = null;

  const response = await handleFrameworkHttpRequest(request, env(), {}, {
    async image() {
      return new Response("unexpected");
    },
    async app(nextRequest) {
      received = nextRequest;
      return new Response("static");
    },
  });

  assert.equal(await response.text(), "static");
  assert.equal(received, request);
});

test("#635 B1 removes Vinext framework implementation from central Worker", () => {
  const index = fs.readFileSync(new URL("../../worker/index.ts", import.meta.url), "utf8");
  const entry = fs.readFileSync(new URL("../../worker/framework-http-entry.ts", import.meta.url), "utf8");

  assert.equal(index.includes('from "vinext/server/image-optimization"'), false);
  assert.equal(index.includes('from "vinext/server/app-router-entry"'), false);
  assert.equal(index.includes('url.pathname === "/_vinext/image"'), false);
  assert.equal(index.includes('appUrl.pathname = "/"'), false);
  assert.equal(index.includes('from "./framework-http-entry.ts"'), true);
  assert.equal(index.includes("handleFrameworkRequest(request, runtimeEnv, ctx)"), true);

  assert.equal(entry.includes('from "vinext/server/image-optimization"'), true);
  assert.equal(entry.includes('from "vinext/server/app-router-entry"'), true);
  assert.equal(entry.includes("handleFrameworkHttpRequest(request, env, ctx"), true);
});
