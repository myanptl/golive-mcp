import { FetchError, fetchUrl } from "../fetch.js";
import type { PageMeta } from "../html.js";
import { type ImageInfo, imageInfo } from "../image.js";
import type { Finding } from "../report.js";

const MIN_SIDE = 200; // Facebook ignores og:image below 200x200
const RECOMMENDED_WIDTH = 1200;
const LARGE_CARD_RATIO = 1.91; // 1200x630, what LinkedIn, Facebook and Slack crop to
const RATIO_TOLERANCE = 0.12;
const X_MAX_BYTES = 5 * 1024 * 1024; // X rejects card images over 5 MB
const HEAVY_BYTES = 1024 * 1024;
const TITLE_SOFT_MAX = 70;
const DESCRIPTION_SOFT_MAX = 200;

export interface PreviewImage {
  url: string;
  info: ImageInfo;
  bytes: number;
  mimeType: string;
  data?: Buffer;
}

export interface PreviewResult {
  findings: Finding[];
  mockups: string;
  image?: PreviewImage;
}

export function truncate(s: string | undefined, n: number): string {
  if (!s) return "(none)";
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

async function loadImage(src: string, findings: Finding[]): Promise<PreviewImage | undefined> {
  let res;
  try {
    res = await fetchUrl(src, { maxBytes: X_MAX_BYTES + 1 });
  } catch (err) {
    findings.push({
      check: "og:image loads",
      severity: "fail",
      message: err instanceof FetchError ? err.message : `Could not load ${src}`,
      fix: "Make sure the image URL is public. Scrapers do not send cookies and cannot see preview deployments behind login.",
    });
    return undefined;
  }
  if (res.status !== 200) {
    findings.push({
      check: "og:image loads",
      severity: "fail",
      message: `The preview image returns HTTP ${res.status}: ${src}`,
      fix: "Every platform shows a blank card when the image 404s. Check the path, and that the file is deployed.",
    });
    return undefined;
  }
  const info = imageInfo(res.body);
  const mimeType = res.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";
  findings.push({ check: "og:image loads", severity: "pass", message: `${info.format.toUpperCase()}, HTTP 200` });
  return {
    url: src,
    info,
    bytes: res.truncated ? X_MAX_BYTES + 1 : res.body.length,
    mimeType,
    data: res.truncated ? undefined : res.body,
  };
}

function checkImage(img: PreviewImage, findings: Finding[]) {
  const { info, bytes } = img;
  if (info.format === "svg" || info.format === "unknown") {
    findings.push({
      check: "og:image format",
      severity: "fail",
      message: info.format === "svg"
        ? "The preview image is an SVG. LinkedIn, Facebook, X and iMessage do not render SVG previews."
        : `The preview URL does not return an image the checker recognises (content-type ${img.mimeType}).`,
      fix: "Export a 1200x630 PNG or JPEG and point og:image at it.",
    });
    return;
  }
  if (info.width && info.height) {
    const { width, height } = info;
    if (width < MIN_SIDE || height < MIN_SIDE) {
      findings.push({
        check: "og:image size",
        severity: "fail",
        message: `${width}x${height} is below the 200x200 minimum, so Facebook drops it and others show a thumbnail at best.`,
        fix: "Use 1200x630.",
      });
    } else {
      const ratio = width / height;
      if (Math.abs(ratio - LARGE_CARD_RATIO) / LARGE_CARD_RATIO > RATIO_TOLERANCE) {
        findings.push({
          check: "og:image shape",
          severity: "warn",
          message: `${width}x${height} (${ratio.toFixed(2)}:1). Large cards are about 1.91:1, so this gets cropped or shown as a small square.`,
          fix: "Use 1200x630 and keep text away from the edges.",
        });
      } else {
        findings.push({ check: "og:image shape", severity: "pass", message: `${width}x${height}, the right shape for a large card` });
      }
      if (width < RECOMMENDED_WIDTH) {
        findings.push({
          check: "og:image resolution",
          severity: "warn",
          message: `${width}px wide. It will look soft on high-density screens.`,
          fix: "Export at 1200px wide.",
        });
      }
    }
  }
  if (bytes > X_MAX_BYTES) {
    findings.push({
      check: "og:image weight",
      severity: "fail",
      message: "Over 5 MB. X refuses card images this big and other scrapers time out.",
      fix: "Compress it. A 1200x630 JPEG is usually under 200 KB.",
    });
  } else if (bytes > HEAVY_BYTES) {
    findings.push({
      check: "og:image weight",
      severity: "warn",
      message: `${(bytes / 1024 / 1024).toFixed(1)} MB. Scrapers give up on slow images and fall back to no image.`,
      fix: "Compress it under 1 MB.",
    });
  }
}

function mockups(meta: PageMeta, host: string, img?: PreviewImage): string {
  const title = meta.meta.get("og:title") ?? meta.meta.get("twitter:title") ?? meta.title;
  const desc = meta.meta.get("og:description") ?? meta.meta.get("twitter:description") ?? meta.meta.get("description");
  const imgLine = img?.info.width
    ? `[image ${img.info.width}x${img.info.height}]`
    : img ? "[image, size unknown]" : "[no image]";
  const card = meta.meta.get("twitter:card");
  const xLarge = card === "summary_large_image";
  const color = meta.meta.get("theme-color");
  return [
    "## How the link will look",
    "",
    "Approximate. Each platform truncates by pixel width, so treat the cut-off points as a guide.",
    "",
    `**LinkedIn**: ${imgLine} / **${truncate(title, 70)}** / ${host}`,
    `**X**: ${xLarge ? `${imgLine} large card` : `small square thumbnail${card ? "" : " (no twitter:card tag)"}`} / **${truncate(title, 70)}** / ${host}`,
    `**Slack**: ${host} / **${truncate(title, 80)}** / ${truncate(desc, 150)} / ${imgLine}`,
    `**iMessage**: ${imgLine} / **${truncate(title, 60)}** / ${host}`,
    `**Discord**: ${color ? `accent ${truncate(color, 20)}` : "grey accent (no theme-color)"} / ${host} / **${truncate(title, 70)}** / ${truncate(desc, 150)} / ${imgLine}`,
    "",
    "Already shared the link before fixing this? Platforms keep the old card for days. Refresh it with LinkedIn Post Inspector and the Facebook Sharing Debugger, and rename the image file (og-v2.png) so caches treat it as new.",
  ].join("\n");
}

export async function checkPreview(meta: PageMeta, pageUrl: URL): Promise<PreviewResult> {
  const findings: Finding[] = [];
  const m = meta.meta;

  const title = m.get("og:title");
  if (!title) {
    findings.push({
      check: "og:title",
      severity: meta.title ? "warn" : "fail",
      message: meta.title
        ? `Missing. Platforms fall back to the <title> ("${truncate(meta.title, 50)}"), which is often not what you want shared.`
        : "Missing, and there is no <title> either. Shared links show the bare URL.",
      fix: '<meta property="og:title" content="...">',
    });
  } else if (title.length > TITLE_SOFT_MAX) {
    findings.push({ check: "og:title", severity: "warn", message: `${title.length} characters, so it gets cut off on most platforms.`, fix: "Keep it under 70." });
  } else {
    findings.push({ check: "og:title", severity: "pass", message: `"${truncate(title, 90)}"` });
  }

  const desc = m.get("og:description");
  if (!desc) {
    findings.push({
      check: "og:description",
      severity: "warn",
      message: "Missing. Slack and Discord show an empty line where the summary goes.",
      fix: '<meta property="og:description" content="...">',
    });
  } else if (desc.length > DESCRIPTION_SOFT_MAX) {
    findings.push({ check: "og:description", severity: "warn", message: `${desc.length} characters. Most of it will not be shown.`, fix: "Aim for under 160." });
  } else {
    findings.push({ check: "og:description", severity: "pass", message: `${desc.length} characters` });
  }

  const rawImage = m.get("og:image") ?? m.get("og:image:url") ?? m.get("og:image:secure_url") ?? m.get("twitter:image");
  let image: PreviewImage | undefined;
  if (!rawImage) {
    findings.push({
      check: "og:image",
      severity: "fail",
      message: "No preview image. On LinkedIn, X and iMessage the link becomes a plain grey text card.",
      fix: 'Add a 1200x630 image: <meta property="og:image" content="https://yoursite.com/og.png">',
    });
  } else {
    if (!/^https?:\/\//i.test(rawImage)) {
      findings.push({
        check: "og:image URL",
        severity: "fail",
        message: `"${rawImage}" is relative. The Open Graph spec needs an absolute URL, and LinkedIn and Facebook will not resolve it.`,
        fix: `Use the full URL, e.g. ${new URL(rawImage, pageUrl).href}`,
      });
    } else if (pageUrl.protocol === "https:" && rawImage.startsWith("http:")) {
      findings.push({ check: "og:image URL", severity: "warn", message: "Served over http on an https page. Some platforms drop insecure images.", fix: "Use the https URL." });
    }
    image = await loadImage(new URL(rawImage, pageUrl).href, findings);
    if (image) checkImage(image, findings);
  }

  const card = m.get("twitter:card");
  if (!card) {
    findings.push({
      check: "twitter:card",
      severity: "warn",
      message: "Missing. X reads your og: tags but only shows a small thumbnail without this.",
      fix: '<meta name="twitter:card" content="summary_large_image">',
    });
  } else {
    findings.push({ check: "twitter:card", severity: "pass", message: truncate(card, 40) });
  }

  if (!m.get("og:url")) {
    findings.push({
      check: "og:url",
      severity: "warn",
      message: "Missing. Shares of /?ref=x and / get counted and cached as different pages.",
      fix: `<meta property="og:url" content="${pageUrl.origin}/">`,
    });
  }

  return { findings, mockups: mockups(meta, pageUrl.host, image), image };
}
