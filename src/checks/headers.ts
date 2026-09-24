import { type FetchResult, fetchUrl } from "../fetch.js";
import type { Finding } from "../report.js";

const HSTS_MIN_SECONDS = 15_552_000; // 180 days

function isLocal(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname);
}

async function checkHttpsRedirect(url: URL): Promise<Finding | undefined> {
  const http = new URL(url.href);
  http.protocol = "http:";
  let res: FetchResult;
  try {
    res = await fetchUrl(http, { followRedirects: false, maxBytes: 1024 });
  } catch {
    return undefined; // Port 80 closed is fine: nothing is served insecurely.
  }
  const to = res.headers.get("location") ?? "";
  if (res.status >= 300 && res.status < 400 && to.startsWith("https:")) {
    return { check: "http → https", severity: "pass", message: `Redirects with ${res.status}` };
  }
  return {
    check: "http → https",
    severity: "fail",
    message: `http://${url.host} serves the page (HTTP ${res.status}) instead of redirecting to https.`,
    fix: "Force HTTPS in your host settings. Vercel and Netlify do it by default for custom domains.",
  };
}

export async function checkHeaders(home: FetchResult): Promise<Finding[]> {
  const findings: Finding[] = [];
  const url = new URL(home.finalUrl);
  const h = home.headers;
  const local = isLocal(url);

  if (url.protocol !== "https:") {
    findings.push({
      check: "HTTPS",
      severity: local ? "pass" : "fail",
      message: local ? "Local dev server, skipped" : "The site is served over plain http. Browsers mark it Not Secure.",
      fix: local ? undefined : "Serve it over https.",
    });
  } else {
    findings.push({ check: "HTTPS", severity: "pass", message: "Served over https" });
    if (!local) {
      const redirect = await checkHttpsRedirect(url);
      if (redirect) findings.push(redirect);
    }
    const hsts = h.get("strict-transport-security");
    const maxAge = Number(hsts?.match(/max-age=(\d+)/i)?.[1] ?? 0);
    if (!hsts) {
      findings.push({ check: "Strict-Transport-Security", severity: "warn", message: "Missing, so a first visit over http can be intercepted.", fix: "Strict-Transport-Security: max-age=31536000; includeSubDomains" });
    } else if (maxAge < HSTS_MIN_SECONDS) {
      findings.push({ check: "Strict-Transport-Security", severity: "warn", message: `max-age is ${maxAge}s, shorter than the usual 1 year.`, fix: "max-age=31536000" });
    } else {
      findings.push({ check: "Strict-Transport-Security", severity: "pass", message: hsts.slice(0, 100) });
    }
  }

  if ((h.get("x-content-type-options") ?? "").toLowerCase() !== "nosniff") {
    findings.push({ check: "X-Content-Type-Options", severity: "warn", message: "Missing. Browsers may guess file types, which lets some uploads run as scripts.", fix: "X-Content-Type-Options: nosniff" });
  } else {
    findings.push({ check: "X-Content-Type-Options", severity: "pass", message: "nosniff" });
  }

  const csp = h.get("content-security-policy");
  const framing = h.get("x-frame-options") || /frame-ancestors/i.test(csp ?? "");
  if (!framing) {
    findings.push({ check: "Clickjacking", severity: "warn", message: "Any site can load yours in an invisible frame and trick people into clicking.", fix: "X-Frame-Options: DENY, or frame-ancestors 'none' in your CSP" });
  } else {
    findings.push({ check: "Clickjacking", severity: "pass", message: "Framing is restricted" });
  }

  if (!csp) {
    findings.push({ check: "Content-Security-Policy", severity: "warn", message: "No CSP, so one injected script can do anything the page can.", fix: "Start with default-src 'self' and add the origins you actually use." });
  } else {
    findings.push({ check: "Content-Security-Policy", severity: "pass", message: "Present" });
  }

  if (!h.get("referrer-policy")) {
    findings.push({ check: "Referrer-Policy", severity: "warn", message: "Missing. Full URLs, including any tokens in them, leak to every site you link to.", fix: "Referrer-Policy: strict-origin-when-cross-origin" });
  } else {
    findings.push({ check: "Referrer-Policy", severity: "pass", message: h.get("referrer-policy")!.slice(0, 60) });
  }

  const powered = h.get("x-powered-by");
  if (powered) {
    findings.push({ check: "X-Powered-By", severity: "warn", message: `Advertises "${powered.slice(0, 60)}", which tells attackers what to try.`, fix: "Remove the header." });
  }
  return findings;
}
