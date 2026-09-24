import { checkBasics } from "./checks/basics.js";
import { checkHeaders } from "./checks/headers.js";
import { type PreviewResult, checkPreview } from "./checks/preview.js";
import { checkRoutes, internalPaths, looksLikeSpa } from "./checks/routes.js";
import { type FetchResult, fetchUrl, parseTarget } from "./fetch.js";
import { type PageMeta, parseHtml } from "./html.js";
import { type Finding, formatFindings, verdict } from "./report.js";

export interface Page {
  url: URL;
  home: FetchResult;
  meta: PageMeta;
}

export async function loadPage(input: string): Promise<Page> {
  const url = parseTarget(input);
  const home = await fetchUrl(url);
  const meta = parseHtml(home.body.toString("utf8"));
  return { url: new URL(home.finalUrl), home, meta };
}

export interface FullReport {
  text: string;
  preview: PreviewResult;
  findings: Finding[];
}

export async function runAll(input: string, paths: string[] = []): Promise<FullReport> {
  const page = await loadPage(input);
  const [preview, routes, headers, basics] = await Promise.all([
    checkPreview(page.meta, page.url),
    checkRoutes(page.home, page.meta, paths),
    checkHeaders(page.home),
    checkBasics(page.home, page.meta),
  ]);
  const findings = [...preview.findings, ...routes, ...basics, ...headers];
  const redirectNote = page.home.redirects.length
    ? `\n(${page.home.redirects.map((r) => `${r.status} → ${r.to}`).join(", ")})`
    : "";
  const text = [
    `# golive: ${page.url.href}${redirectNote}`,
    "",
    `**${verdict(findings)}**`,
    "",
    formatFindings("Link previews", preview.findings),
    "",
    preview.mockups,
    "",
    formatFindings("Routes", routes),
    ...(looksLikeSpa(page.meta) && internalPaths(page.meta, page.url, paths).length === 0
      ? ["", "Client-rendered app with no links in its HTML, so no sub-pages were opened. Pass your routes (paths: [\"/about\"]) to check each one survives a refresh."]
      : []),
    "",
    formatFindings("Basics", basics),
    "",
    formatFindings("Security headers", headers),
  ].join("\n");
  return { text, preview, findings };
}
