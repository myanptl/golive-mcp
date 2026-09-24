import { type FetchResult, fetchUrl } from "../fetch.js";
import type { PageMeta } from "../html.js";
import type { Finding } from "../report.js";
import { truncate } from "./preview.js";

const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

async function exists(url: URL): Promise<FetchResult | undefined> {
  try {
    const res = await fetchUrl(url, { maxBytes: 256 * 1024 });
    return res.status === 200 ? res : undefined;
  } catch {
    return undefined;
  }
}

function robotsBlocksAll(txt: string): boolean {
  let appliesToAll = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) appliesToAll = value === "*";
    else if (appliesToAll && /^disallow$/i.test(key) && value === "/") return true;
  }
  return false;
}

export async function checkBasics(home: FetchResult, meta: PageMeta): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = new URL(home.finalUrl);

  if (home.status !== 200) {
    findings.push({ check: "page loads", severity: "fail", message: `The page returns HTTP ${home.status}` });
  }

  if (!meta.title) {
    findings.push({ check: "<title>", severity: "fail", message: "Missing. The browser tab and search results show the URL.", fix: "<title>Name: what it does</title>" });
  } else if (/^(vite \+ react|vite \+ react \+ ts|vite app|vite-project|my-app|my-react-app|react app|next app|create next app|document|untitled|home)$/i.test(meta.title.trim())) {
    findings.push({ check: "<title>", severity: "fail", message: `Still the template default: "${truncate(meta.title, 40)}"`, fix: "Replace it in index.html." });
  } else if (meta.title.length > TITLE_MAX) {
    findings.push({ check: "<title>", severity: "warn", message: `${meta.title.length} characters. Google cuts it at about 60.` });
  } else {
    findings.push({ check: "<title>", severity: "pass", message: `"${truncate(meta.title, 90)}"` });
  }

  const desc = meta.meta.get("description");
  if (!desc) {
    findings.push({ check: "meta description", severity: "warn", message: "Missing. Google writes its own snippet from whatever text it finds.", fix: '<meta name="description" content="...">' });
  } else if (desc.length < DESCRIPTION_MIN || desc.length > DESCRIPTION_MAX) {
    findings.push({ check: "meta description", severity: "warn", message: `${desc.length} characters. Aim for ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX}.` });
  } else {
    findings.push({ check: "meta description", severity: "pass", message: `${desc.length} characters` });
  }

  if (!meta.meta.get("viewport")) {
    findings.push({ check: "viewport", severity: "fail", message: "No viewport tag, so phones render the desktop layout zoomed out.", fix: '<meta name="viewport" content="width=device-width, initial-scale=1">' });
  }

  if (!meta.lang) {
    findings.push({ check: "<html lang>", severity: "warn", message: "Missing. Screen readers guess the language and may read it in the wrong accent.", fix: '<html lang="en">' });
  }

  const robotsMeta = `${meta.meta.get("robots") ?? ""} ${home.headers.get("x-robots-tag") ?? ""}`;
  if (/noindex/i.test(robotsMeta)) {
    findings.push({ check: "noindex", severity: "fail", message: "The page tells search engines not to index it. Usually left over from staging.", fix: "Remove the robots noindex meta tag or X-Robots-Tag header." });
  }

  const iconLink = meta.links.find((l) => l.rel.split(/\s+/).includes("icon"));
  const iconUrl = iconLink ? new URL(iconLink.href, base) : new URL("/favicon.ico", base);
  const icon = iconUrl.protocol === "data:" ? undefined : await exists(iconUrl);
  if (iconUrl.protocol === "data:") {
    findings.push({ check: "favicon", severity: "pass", message: "Inline data URI" });
  } else if (!icon) {
    findings.push({ check: "favicon", severity: "warn", message: iconLink ? `The favicon link points to ${iconUrl.pathname}, which does not load.` : "No favicon. The tab shows a blank page icon.", fix: '<link rel="icon" href="/favicon.svg">' });
  } else if (/\/vite\.svg$/.test(iconUrl.pathname)) {
    findings.push({ check: "favicon", severity: "warn", message: "Still the Vite logo.", fix: "Swap in your own icon." });
  } else {
    findings.push({ check: "favicon", severity: "pass", message: iconUrl.pathname });
  }

  // iOS also requests /apple-touch-icon.png from the root by convention.
  const hasTouchIcon =
    meta.links.some((l) => l.rel.includes("apple-touch-icon")) ||
    Boolean(await exists(new URL("/apple-touch-icon.png", base)));
  if (!hasTouchIcon) {
    findings.push({ check: "apple-touch-icon", severity: "warn", message: "Missing. Saving the site to an iPhone home screen shows a blurry screenshot instead of your icon.", fix: '<link rel="apple-touch-icon" href="/apple-touch-icon.png"> (180x180 PNG)' });
  }

  const robots = await exists(new URL("/robots.txt", base));
  if (robots && robotsBlocksAll(robots.body.toString("utf8"))) {
    findings.push({ check: "robots.txt", severity: "fail", message: "Disallow: / for every crawler. The whole site is hidden from search.", fix: "Remove the Disallow: / line." });
  }

  if (base.protocol === "https:") {
    const html = home.body.toString("utf8");
    const insecure = html.match(/<(?:img|script|link|iframe|source)\b[^>]*(?:src|href)=["']http:\/\/[^"']+/gi);
    if (insecure?.length) {
      findings.push({ check: "mixed content", severity: "warn", message: `${insecure.length} resource(s) load over http on an https page. Browsers block or flag them.`, fix: "Switch them to https." });
    }
  }
  return findings;
}
