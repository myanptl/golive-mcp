import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// Regression: the server must start when launched through a symlink, which is
// exactly how npx and node_modules/.bin run it. It silently did not.
const dist = resolve(__dirname, "../dist/index.js");
const dir = mkdtempSync(join(tmpdir(), "mcp-entry-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function initialize(bin: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); done(out); }, 8000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes('"id":1')) { clearTimeout(timer); child.kill(); done(out); }
    });
    child.on("error", fail);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n"
    );
  });
}

describe.skipIf(!existsSync(dist))("entrypoint", () => {
  it("starts when run through a symlink, like npx does", async () => {
    const link = join(dir, "bin-link");
    symlinkSync(dist, link);
    expect(await initialize(link)).toContain('"serverInfo"');
  });

  it("starts when run directly", async () => {
    expect(await initialize(dist)).toContain('"serverInfo"');
  });
});
