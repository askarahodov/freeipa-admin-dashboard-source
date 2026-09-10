import assert from "node:assert/strict";
import test from "node:test";

import { configureOutboundProxy, outboundProxyPolicy } from "../../scripts/outbound-proxy-policy.mjs";

test("outbound proxy is disabled by default on older supported Node runtimes", () => {
  assert.deepEqual(outboundProxyPolicy({}, "22.13.0"), { enabled: false });
});

test("outbound proxy requires a Node release with built-in startup proxy support", () => {
  const env = {
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
  };
  assert.throws(() => outboundProxyPolicy(env, "22.20.0"), /22\.21\.0\+/u);
  assert.throws(() => outboundProxyPolicy(env, "23.11.1"), /22\.21\.0\+/u);
  assert.equal(outboundProxyPolicy(env, "22.21.0").enabled, true);
  assert.equal(outboundProxyPolicy(env, "24.5.0").enabled, true);
});

test("enabled outbound proxy requires at least one valid HTTP(S) proxy URL", () => {
  assert.throws(() => outboundProxyPolicy({
    NODE_USE_ENV_PROXY: "1",
    NO_PROXY: "127.0.0.1",
  }, "22.21.0"), /requires HTTP_PROXY\/HTTPS_PROXY/u);

  assert.throws(() => outboundProxyPolicy({
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "socks5://proxy.example:1080",
    NO_PROXY: "127.0.0.1",
  }, "22.21.0"), /absolute HTTP\(S\) proxy URL/u);
});

test("lowercase proxy variables take precedence and loopback gateway bypass is mandatory", () => {
  assert.throws(() => outboundProxyPolicy({
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost",
  }, "22.21.0"), /must bypass 127\.0\.0\.1/u);

  assert.throws(() => outboundProxyPolicy({
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "   ",
  }, "22.21.0"), /must bypass 127\.0\.0\.1/u);

  const policy = outboundProxyPolicy({
    NODE_USE_ENV_PROXY: "1",
    https_proxy: "https://proxy.example:8443",
    no_proxy: "localhost,127.0.0.1,.corp.example",
  }, "22.21.0");
  assert.deepEqual(policy, {
    enabled: true,
    httpProxyConfigured: false,
    httpsProxyConfigured: true,
    gatewayBypassed: true,
  });
});

test("configureOutboundProxy performs fail-closed startup preflight without requiring the newer dynamic proxy API", () => {
  const env = {
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://user:secret@proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
  };

  assert.deepEqual(configureOutboundProxy({ env, nodeVersion: "22.21.0" }), {
    enabled: true,
    httpProxyConfigured: false,
    httpsProxyConfigured: true,
    gatewayBypassed: true,
  });
});
