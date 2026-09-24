import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

type RouteOrFn = Route | ((base: string) => Route);

/** A throwaway site on a random localhost port. Unknown paths use `fallback`. */

export async function serve(routes: Record<string, RouteOrFn>, fallback: Route = { status: 404, body: "not found" }) {
  let base = "";
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const entry = routes[path] ?? fallback;
    const route = typeof entry === "function" ? entry(base) : entry;
    res.writeHead(route.status ?? 200, { "content-type": "text/html", ...route.headers });
    res.end(route.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

export function page(head: string, body = "<main><h1>Hello</h1><p>A real page with enough content to not look like an empty app shell. It keeps going for a while so the text is long enough to count as server rendered content for the checker, which wants a couple of hundred characters.</p></main>") {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}
