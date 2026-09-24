/**
 * Just enough HTML reading for <head> metadata. A full parser would be a
 * dependency for the sake of a few dozen tags, and scrapers like LinkedIn's
 * are not much smarter than this either.
 */

export interface PageMeta {
  title?: string;
  lang?: string;
  meta: Map<string, string>;
  links: { rel: string; href: string; sizes?: string }[];
  anchors: string[];
  scripts: string[];
  bodyText: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
};

export function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const m of tag.matchAll(re)) {
    out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

export function parseHtml(html: string): PageMeta {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const meta = new Map<string, string>();
  for (const m of noComments.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a["http-equiv"])?.toLowerCase();
    // First one wins, which is what Facebook's and LinkedIn's scrapers do.
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }

  const links: PageMeta["links"] = [];
  for (const m of noComments.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.rel && a.href) links.push({ rel: a.rel.toLowerCase(), href: a.href, sizes: a.sizes });
  }

  const anchors = [...noComments.matchAll(/<a\b[^>]*>/gi)]
    .map((m) => attrs(m[0]).href)
    .filter((h): h is string => Boolean(h));

  const scripts = [...noComments.matchAll(/<script\b[^>]*>/gi)]
    .map((m) => attrs(m[0]).src)
    .filter((s): s is string => Boolean(s));

  const titleMatch = noComments.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTag = noComments.match(/<html\b[^>]*>/i);
  const body = noComments.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  const bodyText = body
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: titleMatch ? decode(titleMatch[1].replace(/\s+/g, " ")) : undefined,
    lang: htmlTag ? attrs(htmlTag[0]).lang : undefined,
    meta,
    links,
    anchors,
    scripts,
    bodyText,
  };
}
