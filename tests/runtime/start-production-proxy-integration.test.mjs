import assert from "node:assert/strict";
import test from "node:test";

import { createProductionRuntimeOptions } from "../../scripts/start-production.mjs";

test("production startup applies outbound proxy policy before loading runtime work", async () => {
  const calls = [];
  const env = { NODE_USE_ENV_PROXY: "1" };
  const options = createProductionRuntimeOptions({
    env,
    async configureProxy(input) {
      calls.push(["proxy", input.env]);
      throw new Error("proxy policy rejected");
    },
  });

  let workerLoaded = false;
  await assert.rejects(
    options.start({
      ...options,
      env,
      async loadWorker() {
        workerLoaded = true;
        throw new Error("must not be reached");
      },
    }),
    /proxy policy rejected/u,
  );

  assert.deepEqual(calls, [["proxy", env]]);
  assert.equal(workerLoaded, false);
});
