#!/usr/bin/env node
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkBasics } from "./checks/basics.js";
import { checkHeaders } from "./checks/headers.js";
import { type PreviewImage, checkPreview } from "./checks/preview.js";
import { checkRoutes } from "./checks/routes.js";
import { FetchError } from "./fetch.js";
import { formatFindings, tally, verdict } from "./report.js";
import { loadPage, runAll } from "./run.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const INLINE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const url = z
  .string()
  .min(1)
  .describe("The page to check: a live URL, a preview deployment, or a local dev server like http://localhost:5173");
const paths = z
  .array(z.string())
  .max(20)
  .optional()
  .describe('Extra paths to open directly, e.g. ["/about", "/pricing"]. Use this for client-rendered apps whose links are not in the HTML.');

function imageContent(img?: PreviewImage): Content[] {
  if (!img?.data || img.bytes > MAX_INLINE_IMAGE_BYTES || !INLINE_MIME.includes(img.mimeType)) return [];
  return [
    { type: "text", text: `The preview image, exactly as platforms will fetch it (${img.url}):` },
    { type: "image", data: img.data.toString("base64"), mimeType: img.mimeType },
  ];
}

async function guarded(fn: () => Promise<Content[]>) {
  try {
    return { content: await fn() };
  } catch (err) {
    const message = err instanceof FetchError ? err.message : `Check failed: ${(err as Error).message}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "golive-mcp", version });

  server.registerTool(
    "golive",
    {
      title: "Check a site is ready to go live",
      description:
        "Run every check on a URL before it gets shared or launched: how the link preview will look on LinkedIn, X, Slack, iMessage and Discord (and whether the image loads, is the right size, and is not an SVG), sub-pages that 404 on refresh, noindex or robots.txt left on from staging, template titles and Vite favicons, missing security headers, and http that does not redirect. Returns findings with fixes, text mockups of each platform's card, and the preview image itself. Use it after deploying, before posting a link, or on localhost before pushing.",
      inputSchema: { url, paths },
    },
    async ({ url, paths }) =>
      guarded(async () => {
        const report = await runAll(url, paths);
        return [{ type: "text", text: report.text }, ...imageContent(report.preview.image)];
      })
  );

  server.registerTool(
    "check_link_preview",
    {
      title: "Check how a link will look when shared",
      description:
        "Check the Open Graph and Twitter card tags on a URL and show how the link will look on LinkedIn, X, Slack, iMessage and Discord. Loads the og:image and checks it is reachable, a raster format, about 1200x630, and under platform size limits. Returns the image so you can see it.",
      inputSchema: { url },
    },
    async ({ url }) =>
      guarded(async () => {
        const page = await loadPage(url);
        const result = await checkPreview(page.meta, page.url);
        const text = [`**${verdict(result.findings)}**`, "", formatFindings("Link preview", result.findings), "", result.mockups].join("\n");
        return [{ type: "text", text }, ...imageContent(result.image)];
      })
  );

  server.registerTool(
    "check_routes",
    {
      title: "Check sub-pages survive a refresh",
      description:
        "Open a site's internal links directly, the way a refresh, bookmark or shared link does. Catches the single-page-app 404 (works when clicked, breaks on refresh) and names the host-specific fix, e.g. the vercel.json rewrite. Also checks that made-up URLs return a real 404.",
      inputSchema: { url, paths },
    },
    async ({ url, paths }) =>
      guarded(async () => {
        const page = await loadPage(url);
        const findings = await checkRoutes(page.home, page.meta, paths);
        return [{ type: "text", text: `**${verdict(findings)}**\n\n${formatFindings("Routes", findings)}` }];
      })
  );

  server.registerTool(
    "check_security_headers",
    {
      title: "Check security headers",
      description:
        "Check HTTPS, the http to https redirect, HSTS, nosniff, clickjacking protection, CSP, Referrer-Policy and X-Powered-By on a URL, each with the header to add.",
      inputSchema: { url },
    },
    async ({ url }) =>
      guarded(async () => {
        const page = await loadPage(url);
        const findings = await checkHeaders(page.home);
        return [{ type: "text", text: `**${verdict(findings)}**\n\n${formatFindings("Security headers", findings)}` }];
      })
  );

  server.registerTool(
    "check_basics",
    {
      title: "Check launch basics",
      description:
        "Check the things that get forgotten at launch: template titles like 'Vite + React', the Vite favicon, missing meta description, viewport and lang, apple-touch-icon, noindex or robots.txt left on from staging, and mixed content.",
      inputSchema: { url },
    },
    async ({ url }) =>
      guarded(async () => {
        const page = await loadPage(url);
        const findings = await checkBasics(page.home, page.meta);
        return [{ type: "text", text: `**${verdict(findings)}**\n\n${formatFindings("Basics", findings)}` }];
      })
  );

  return server;
}

async function cli(args: string[]) {
  const [target, ...extra] = args;
  if (!target) {
    console.error("Usage: npx golive-mcp check <url> [/path ...]");
    process.exit(2);
  }
  try {
    const report = await runAll(target, extra);
    console.log(report.text.replace(/\*\*/g, ""));
    process.exit(tally(report.findings).fail > 0 ? 1 : 0);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") {
    await cli(rest);
  } else if (command === "--version" || command === "-v") {
    console.log(version);
  } else {
    await createServer().connect(new StdioServerTransport());
  }
}
