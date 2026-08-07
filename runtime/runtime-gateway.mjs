function requireFunction(options, name) {
  if (typeof options?.[name] !== "function") throw new Error(`${name} must be a function`);
  return options[name];
}

function validatedPort(value) {
  const port = Number(value ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("requestedPort must be an integer between 0 and 65535");
  }
  return port;
}

function validatedGatewayToken(value) {
  const token = String(value ?? "");
  if (token.length < 32 || token.length > 512 || /\s/u.test(token)) {
    throw new Error("gateway token must be an opaque non-whitespace value of at least 32 characters");
  }
  return token;
}

export async function startRuntimeGateway(options = {}) {
  const createGateway = requireFunction(options, "createGateway");
  const tokenFactory = requireFunction(options, "tokenFactory");
  const requestedPort = validatedPort(options.requestedPort);
  const token = validatedGatewayToken(tokenFactory());
  const env = options.env ?? {};

  const server = createGateway({ token });
  if (!server || typeof server.listen !== "function" || typeof server.close !== "function" || typeof server.address !== "function") {
    throw new Error("gateway factory must return a Node HTTP server");
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off?.("error", onError);
      reject(error);
    };
    server.once?.("error", onError);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off?.("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port) || address.port <= 0) {
    try { server.close(); } catch {}
    throw new Error("FreeIPA Gateway did not acquire a TCP port");
  }

  let closePromise = null;
  function close() {
    if (closePromise) return closePromise;
    closePromise = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    return closePromise;
  }

  return {
    server,
    address: { host: "127.0.0.1", port: address.port },
    env: {
      ...env,
      IPA_NODE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
      IPA_NODE_GATEWAY_TOKEN: token,
    },
    close,
  };
}
