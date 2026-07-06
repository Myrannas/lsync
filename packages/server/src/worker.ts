import type { Env } from "./durable-object";

export interface WorkerOptions {
  binding?: keyof Env;
  routePattern?: RegExp;
}

export function createWorkerHandler(options: WorkerOptions = {}) {
  const binding = options.binding ?? "SYNC_SHARDS";
  const routePattern = options.routePattern ?? /^\/sync\/([^/]+)$/;

  return {
    fetch(request: Request, env: Env): Promise<Response> | Response {
      const url = new URL(request.url);
      const match = url.pathname.match(routePattern);

      if (!match?.[1]) {
        return new Response("Not found", { status: 404 });
      }

      const namespace = env[binding] as DurableObjectNamespace | undefined;
      if (!namespace) {
        return new Response(`Missing Durable Object binding: ${String(binding)}`, { status: 500 });
      }

      const id = namespace.idFromName(decodeURIComponent(match[1]));
      const stub = namespace.get(id);
      return stub.fetch(request);
    },
  };
}
