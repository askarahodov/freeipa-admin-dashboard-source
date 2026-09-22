import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  handleFrameworkHttpRequest,
  type FrameworkHttpContext,
  type FrameworkHttpEnv,
} from "./framework-http.ts";

const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

export async function handleFrameworkRequest<
  Env extends FrameworkHttpEnv,
  Context extends FrameworkHttpContext,
>(
  request: Request,
  env: Env,
  ctx: Context,
): Promise<Response> {
  return handleFrameworkHttpRequest(request, env, ctx, {
    image(nextRequest, nextEnv) {
      return handleImageOptimization(nextRequest, {
        fetchAsset: (path) => nextEnv.ASSETS.fetch(
          new Request(new URL(path, nextRequest.url)),
        ),
        transformImage: async (body, { width, format, quality }) => {
          const result = await nextEnv.IMAGES
            .input(body)
            .transform(width > 0 ? { width } : {})
            .output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    },
    app(nextRequest, nextEnv, nextContext) {
      return handler.fetch(nextRequest, nextEnv, nextContext);
    },
  });
}
