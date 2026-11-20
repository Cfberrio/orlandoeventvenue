// L2-04 (ClickUp 86e40ach2, second pass): "live" was declared on commits that
// were never redeployed, and nothing could show which code a function runs.
// Every function that imports this returns `build` in its JSON responses and
// an `x-oev-build` header (also on the OPTIONS preflight, which never runs any
// work). scripts/check-deployed-builds.sh reads it. Bump BUILD_ID whenever a
// batch of edge functions is redeployed.

export const BUILD_ID = "2026-11-19-second-pass";

export const BUILD_HEADER = "x-oev-build";

/** Spread into a function's corsHeaders so every response carries the build. */
export const BUILD_HEADERS: Record<string, string> = { [BUILD_HEADER]: BUILD_ID };

/**
 * Wraps a serve() handler: every response gets the x-oev-build header and
 * every JSON object body gets `build` (unless it already has one). Used by
 * functions whose many return paths would otherwise each need editing.
 */
export function withBuild(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set(BUILD_HEADER, BUILD_ID);
    const init = { status: res.status, statusText: res.statusText, headers };
    if ((headers.get("content-type") ?? "").includes("application/json")) {
      const text = await res.text();
      try {
        const body = JSON.parse(text);
        if (body && typeof body === "object" && !Array.isArray(body) && !("build" in body)) {
          return new Response(JSON.stringify({ ...body, build: BUILD_ID }), init);
        }
      } catch {
        // not JSON after all: pass it through unchanged
      }
      return new Response(text, init);
    }
    return new Response(res.body, init);
  };
}
