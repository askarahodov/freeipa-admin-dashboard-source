export type FrameworkHttpEnv = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
};

export type FrameworkHttpContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

export type FrameworkHttpDependencies<
  Env extends FrameworkHttpEnv,
  Context,
> = {
  image(request: Request, env: Env): Promise<Response>;
  app(request: Request, env: Env, ctx: Context): Promise<Response>;
};

const APP_SHELL_HTML_PATH = /^\/(?:automation(?:\/[^/]+)?|users|groups|operations|approvals|audit|settings)\/?$/;

export async function handleFrameworkHttpRequest<
  Env extends FrameworkHttpEnv,
  Context,
>(
  request: Request,
  env: Env,
  ctx: Context,
  dependencies: FrameworkHttpDependencies<Env, Context>,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/_vinext/image") {
    return dependencies.image(request, env);
  }

  if (
    request.method === "GET"
    && request.headers.get("accept")?.includes("text/html")
    && APP_SHELL_HTML_PATH.test(url.pathname)
  ) {
    const appUrl = new URL(request.url);
    appUrl.pathname = "/";
    return dependencies.app(new Request(appUrl, request), env, ctx);
  }

  return dependencies.app(request, env, ctx);
}
