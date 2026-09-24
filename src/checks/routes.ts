import { randomBytes } from "node:crypto";

import { type FetchResult, fetchUrl } from "../fetch.js";
import type { PageMeta } from "../html.js";
import type { Finding } from "../report.js";

const MAX_LINKS = 8;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|mp3|css|js|json|xml|txt)$/i;

function isVercel(headers: Headers): boolean {
  return (headers.get("server") ?? "").toLowerCase().includes("vercel") || headers.has("x-vercel-id");
}

function isNetlify(headers: Headers): boolean {
  return (headers.get("server") ?? "").toLowerCase().includes("netlify") || headers.has("x-nf-request-id");
}

export function spaFix(headers: Headers): string {
  if (isVercel(headers)) {
    return 'Add a vercel.json with { "rewrites": [{ "source": "/(.*)", "destination": "/" }] } so every path serves your app.';
  }
  if (isNetlify(headers)) return "Add a public/_redirects file containing: /*  /index.html  200";
  return "Configure the host to serve index.html for unknown paths, so the client router can take over.";
}

/** A client-rendered app ships an almost empty body and a script. */
export function looksLikeSpa(meta: PageMeta): boolean {
  return meta.bodyText.length < 200 && meta.scripts.length > 0;
}

export function internalPaths(meta: PageMeta, base: URL, extra: string[] = []): string[] {
  const seen = new Set<string>();
  for (const href of [...extra, ...meta.anchors]) {
    if (/^(mailto|tel|javascript):/i.test(href) || href.startsWith("#")) continue;
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if (u.origin !== base.origin || u.pathname === "/" || SKIP_EXT.test(u.pathname)) continue;
    seen.add(u.pathname);
  }
  return [...seen].slice(0, MAX_LINKS + extra.length);
}

function sameShell(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) return true;
  const strip = (x: Buffer) => x.toString("utf8").replace(/\s+/g, "");
  return strip(a) === strip(b);
}

export async function checkRoutes(home: FetchResult, meta: PageMeta, paths: string[] = []): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = new URL(home.finalUrl);
  const probe = new URL(`/golive-probe-${randomBytes(4).toString("hex")}`, base);

  let missing: FetchResult | undefined;
  try {
    missing = await fetchUrl(probe);
  } catch {
    // An unreachable probe says nothing about the site; skip rather than guess.
  }
  if (missing) {
    if (missing.status === 404 || missing.status === 410) {
      findings.push({ check: "unknown URLs", severity: "pass", message: `Return ${missing.status}` });
    } else if (missing.status === 200 && sameShell(missing.body, home.body)) {
      findings.push({
        check: "unknown URLs",
        severity: looksLikeSpa(meta) ? "pass" : "warn",
        message: looksLikeSpa(meta)
          ? "Load the app, so client routes survive a refresh. Make sure your router shows a real not-found page."
          : "Return your homepage with HTTP 200 (a soft 404). Search engines index broken links as duplicates of your homepage.",
        fix: looksLikeSpa(meta) ? undefined : "Return a real 404 for paths that do not exist.",
      });
    } else if (missing.status >= 500) {
      findings.push({ check: "unknown URLs", severity: "warn", message: `A made-up path returns HTTP ${missing.status}, a server error instead of a 404.` });
    }
  }

  const targets = internalPaths(meta, base, paths);
  const results = await Promise.all(
    targets.map(async (path) => {
      try {
        return { path, res: await fetchUrl(new URL(path, base)) };
      } catch (err) {
        return { path, error: (err as Error).message };
      }
    })
  );

  for (const r of results) {
    if ("error" in r) {
      findings.push({ check: `link ${r.path}`, severity: "warn", message: r.error ?? "unreachable" });
    } else if (r.res.status === 404) {
      findings.push({
        check: `link ${r.path}`,
        severity: "fail",
        message: looksLikeSpa(meta)
          ? `Opening ${r.path} directly returns 404. It works when clicked inside the app, but breaks on refresh, bookmark or share.`
          : `${r.path} is linked from the page but returns 404.`,
        fix: looksLikeSpa(meta) ? spaFix(home.headers) : "Fix or remove the link.",
      });
    } else if (r.res.status >= 400) {
      findings.push({ check: `link ${r.path}`, severity: "fail", message: `Returns HTTP ${r.res.status}` });
    } else {
      findings.push({ check: `link ${r.path}`, severity: "pass", message: `HTTP ${r.res.status}` });
    }
  }
  return findings;
}
