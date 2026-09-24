import { afterEach, describe, expect, it } from "vitest";

import { checkBasics } from "../src/checks/basics.js";
import { checkHeaders } from "../src/checks/headers.js";
import { checkPreview } from "../src/checks/preview.js";
import { checkRoutes, spaFix } from "../src/checks/routes.js";
import type { Finding } from "../src/report.js";
import { loadPage, runAll } from "../src/run.js";
import { page, png, serve } from "./server.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function site(...args: Parameters<typeof serve>) {
  const s = await serve(...args);
  close = s.close;
  return s.url;
}

const find = (fs: Finding[], check: string) => fs.find((f) => f.check === check);

describe("link preview", () => {
  it("passes a complete, correctly sized card and returns the image", async () => {
    const url = await site({
      "/": (base) => ({ body: page(`<title>Site</title>
        <meta property="og:title" content="Site"><meta property="og:description" content="What it does">
        <meta property="og:image" content="${base}/og.png"><meta name="twitter:card" content="summary_large_image">
        <meta property="og:url" content="${base}/">`) }),
      "/og.png": { headers: { "content-type": "image/png" }, body: png(1200, 630) },
    });
    const p = await loadPage(url);
    const result = await checkPreview(p.meta, p.url);
    expect(result.findings.filter((f) => f.severity !== "pass")).toEqual([]);
    expect(result.image?.info).toEqual({ format: "png", width: 1200, height: 630 });
    expect(result.image?.data).toBeDefined();
    expect(result.mockups).toContain("[image 1200x630] large card");
  });

  it("flags a relative, SVG, and missing image", async () => {
    const url = await site({
      "/": { body: page(`<meta property="og:title" content="T"><meta property="og:image" content="/og.svg">`) },
      "/og.svg": { headers: { "content-type": "image/svg+xml" }, body: "<svg xmlns='http://www.w3.org/2000/svg'/>" },
    });
    const p = await loadPage(url);
    const { findings } = await checkPreview(p.meta, p.url);
    expect(find(findings, "og:image URL")?.severity).toBe("fail");
    expect(find(findings, "og:image format")?.severity).toBe("fail");
    expect(find(findings, "twitter:card")?.severity).toBe("warn");
  });

  it("flags a missing og:image and a 404 image", async () => {
    const url = await site({ "/": { body: page("<title>T</title>") } });
    const p = await loadPage(url);
    expect(find((await checkPreview(p.meta, p.url)).findings, "og:image")?.severity).toBe("fail");

    await close?.();
    const url2 = await site({ "/": { body: page(`<meta property="og:image" content="http://127.0.0.1:1/og.png">`) } });
    const p2 = await loadPage(url2);
    expect(find((await checkPreview(p2.meta, p2.url)).findings, "og:image loads")?.severity).toBe("fail");
  });

  it("flags small and badly shaped images", async () => {
    const url = await site({
      "/": (base) => ({ body: page(`<meta property="og:image" content="${base}/tiny.png">`) }),
      "/tiny.png": { headers: { "content-type": "image/png" }, body: png(150, 150) },
    });
    const p = await loadPage(url);
    expect(find((await checkPreview(p.meta, p.url)).findings, "og:image size")?.severity).toBe("fail");

    await close?.();
    const url2 = await site({
      "/": (base) => ({ body: page(`<meta property="og:image" content="${base}/sq.png">`) }),
      "/sq.png": { headers: { "content-type": "image/png" }, body: png(800, 800) },
    });
    const p2 = await loadPage(url2);
    const f2 = (await checkPreview(p2.meta, p2.url)).findings;
    expect(find(f2, "og:image shape")?.severity).toBe("warn");
    expect(find(f2, "og:image resolution")?.severity).toBe("warn");
  });
});

describe("routes", () => {
  it("catches the SPA refresh 404 and names the Vercel fix", async () => {
    const shell = `<!doctype html><html><head><title>App</title><script type="module" src="/app.js"></script></head><body><div id="root"></div><a href="/about">About</a></body></html>`;
    const url = await site({ "/": { body: shell, headers: { server: "Vercel" } } });
    const p = await loadPage(url);
    const findings = await checkRoutes(p.home, p.meta);
    const about = find(findings, "link /about");
    expect(about?.severity).toBe("fail");
    expect(about?.fix).toContain("vercel.json");
  });

  it("treats a host that serves the app for any path as refresh-safe", async () => {
    const shell = `<!doctype html><html><head><title>App</title><script type="module" src="/app.js"></script></head><body><div id="root"></div></body></html>`;
    const url = await site({}, { status: 200, body: shell });
    const p = await loadPage(url);
    expect(find(await checkRoutes(p.home, p.meta), "unknown URLs")?.severity).toBe("pass");
    expect((await runAll(url)).text).toContain("Pass your routes");
  });

  it("passes when sub-pages load and unknown URLs 404", async () => {
    const url = await site({ "/": { body: page("", `<a href="/about">About</a>`) }, "/about": { body: page("") } });
    const p = await loadPage(url);
    const findings = await checkRoutes(p.home, p.meta);
    expect(find(findings, "link /about")?.severity).toBe("pass");
    expect(find(findings, "unknown URLs")?.severity).toBe("pass");
  });

  it("warns about soft 404s on server-rendered sites", async () => {
    const body = page("<title>Home</title>");
    const url = await site({ "/": { body } }, { status: 200, body });
    const p = await loadPage(url);
    expect(find(await checkRoutes(p.home, p.meta), "unknown URLs")?.severity).toBe("warn");
  });

  it("tests paths passed in explicitly", async () => {
    const url = await site({ "/": { body: page("") } });
    const p = await loadPage(url);
    expect(find(await checkRoutes(p.home, p.meta, ["/pricing"]), "link /pricing")?.severity).toBe("fail");
  });

  it("names Netlify and generic fixes", () => {
    expect(spaFix(new Headers({ server: "Netlify" }))).toContain("_redirects");
    expect(spaFix(new Headers())).toContain("index.html");
  });
});

describe("basics", () => {
  it("catches template leftovers and staging settings", async () => {
    const url = await site({
      "/": { body: `<html><head><title>Vite + React</title><meta name="robots" content="noindex"><link rel="icon" href="/vite.svg"></head><body></body></html>` },
      "/vite.svg": { body: "<svg/>" },
      "/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /\n" },
    });
    const p = await loadPage(url);
    const findings = await checkBasics(p.home, p.meta);
    expect(find(findings, "<title>")?.message).toContain("template default");
    expect(find(findings, "noindex")?.severity).toBe("fail");
    expect(find(findings, "robots.txt")?.severity).toBe("fail");
    expect(find(findings, "favicon")?.message).toContain("Vite");
    expect(find(findings, "viewport")?.severity).toBe("fail");
    expect(find(findings, "<html lang>")?.severity).toBe("warn");
  });

  it("does not flag robots.txt that only blocks one bot", async () => {
    const url = await site({
      "/": { body: page(`<title>Real</title><meta name="viewport" content="width=device-width">`) },
      "/robots.txt": { body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n" },
    });
    const p = await loadPage(url);
    expect(find(await checkBasics(p.home, p.meta), "robots.txt")).toBeUndefined();
  });

  it("accepts an inline data URI favicon", async () => {
    const url = await site({ "/": { body: page(`<title>X</title><link rel="icon" href="data:image/svg+xml,%3Csvg/%3E">`) } });
    const p = await loadPage(url);
    expect(find(await checkBasics(p.home, p.meta), "favicon")?.message).toBe("Inline data URI");
  });
});

describe("headers", () => {
  it("flags missing headers and X-Powered-By, skips https on localhost", async () => {
    const url = await site({ "/": { body: page(""), headers: { "x-powered-by": "Express" } } });
    const p = await loadPage(url);
    const findings = await checkHeaders(p.home);
    expect(find(findings, "HTTPS")?.message).toContain("Local");
    expect(find(findings, "X-Powered-By")?.severity).toBe("warn");
    expect(find(findings, "Clickjacking")?.severity).toBe("warn");
  });

  it("passes a hardened response", async () => {
    const url = await site({
      "/": {
        body: page(""),
        headers: {
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      },
    });
    const p = await loadPage(url);
    const findings = await checkHeaders(p.home);
    expect(findings.filter((f) => f.severity !== "pass")).toEqual([]);
  });
});

describe("runAll", () => {
  it("produces a full report with a verdict", async () => {
    const url = await site({ "/": { body: page("<title>T</title>") } });
    const report = await runAll(url);
    expect(report.text).toMatch(/^# golive:/);
    expect(report.text).toContain("Not ready");
    expect(report.text).toContain("How the link will look");
  });

  it("follows redirects and reports them", async () => {
    const url = await site({ "/": { status: 301, headers: { location: "/home" } }, "/home": { body: page("<title>T</title>") } });
    const report = await runAll(url);
    expect(report.text).toContain("301 →");
  });
});
