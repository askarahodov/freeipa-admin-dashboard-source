import assert from "node:assert/strict";
import test from "node:test";

import { parseBuildContextBytes, parseHumanBytes } from "../../scripts/docker-packaging-metrics.mjs";

test("Docker byte parser uses BuildKit decimal size units", () => {
  assert.equal(parseHumanBytes("309", "B"), 309);
  assert.equal(parseHumanBytes("4.25", "kB"), 4_250);
  assert.equal(parseHumanBytes("5.04", "MB"), 5_040_000);
  assert.equal(parseHumanBytes("1.5", "GB"), 1_500_000_000);
});

test("build-context parser ignores .dockerignore transfer and captures actual context", () => {
  const log = `#4 [internal] load .dockerignore
#4 transferring context: 309B done
#4 DONE 0.0s
#6 [internal] load build context
#6 transferring context: 5.04MB 0.1s done
#6 DONE 0.1s`;

  assert.equal(parseBuildContextBytes(log), 5_040_000);
});

test("build-context parser supports progress updates and returns completed context transfer", () => {
  const log = `#6 [internal] load build context
#6 transferring context: 1.02MB 0.1s
#6 transferring context: 4.31MB 0.2s done
#6 DONE 0.2s`;

  assert.equal(parseBuildContextBytes(log), 4_310_000);
});

test("build-context parser fails closed when measurement is absent", () => {
  assert.throws(
    () => parseBuildContextBytes("#4 [internal] load .dockerignore\n#4 transferring context: 309B done\n#4 DONE 0.0s"),
    /does not contain a completed build-context transfer measurement/u,
  );
});
