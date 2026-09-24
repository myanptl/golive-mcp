import { describe, expect, it } from "vitest";

import { parseTarget } from "../src/fetch.js";
import { decode, parseHtml } from "../src/html.js";
import { imageInfo } from "../src/image.js";
import { png } from "./server.js";

describe("parseHtml", () => {
  it("reads og, twitter and name meta, first one wins", () => {
    const meta = parseHtml(`<head>
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">
      <meta name='twitter:card' content='summary_large_image'>
      <meta content="Desc &amp; more" name="description">
    </head>`);
    expect(meta.meta.get("og:title")).toBe("First");
    expect(meta.meta.get("twitter:card")).toBe("summary_large_image");
    expect(meta.meta.get("description")).toBe("Desc & more");
  });

  it("ignores tags inside comments", () => {
    const meta = parseHtml(`<!-- <meta property="og:image" content="/old.png"> --><title>x</title>`);
    expect(meta.meta.has("og:image")).toBe(false);
  });

  it("collects title, lang, links, anchors and scripts", () => {
    const meta = parseHtml(`<html lang="en"><head><title> My  Site </title>
      <link rel="icon" href="/favicon.svg"><script type="module" src="/assets/app.js"></script></head>
      <body><a href="/about">About</a><a href="mailto:x@y.z">Mail</a></body></html>`);
    expect(meta.title).toBe("My Site");
    expect(meta.lang).toBe("en");
    expect(meta.links).toEqual([{ rel: "icon", href: "/favicon.svg", sizes: undefined }]);
    expect(meta.anchors).toEqual(["/about", "mailto:x@y.z"]);
    expect(meta.scripts).toEqual(["/assets/app.js"]);
  });

  it("decodes numeric entities", () => {
    expect(decode("It&#39;s &#x2014; fine")).toBe("It's — fine");
  });
});

describe("imageInfo", () => {
  it("reads PNG dimensions", () => {
    expect(imageInfo(png(1200, 630))).toEqual({ format: "png", width: 1200, height: 630 });
  });

  it("reads JPEG dimensions from the SOF marker", () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0, 0, 0]);
    expect(imageInfo(b)).toEqual({ format: "jpeg", width: 1200, height: 630 });
  });

  it("reads GIF dimensions", () => {
    const b = Buffer.alloc(16);
    b.write("GIF89a", 0, "ascii");
    b.writeUInt16LE(400, 6);
    b.writeUInt16LE(300, 8);
    expect(imageInfo(b)).toEqual({ format: "gif", width: 400, height: 300 });
  });

  it("reads VP8X WebP dimensions", () => {
    const b = Buffer.alloc(30);
    b.write("RIFF", 0, "ascii");
    b.write("WEBPVP8X", 8, "ascii");
    b.writeUIntLE(1199, 24, 3);
    b.writeUIntLE(629, 27, 3);
    expect(imageInfo(b)).toEqual({ format: "webp", width: 1200, height: 630 });
  });

  it("recognises SVG and unknown data", () => {
    expect(imageInfo(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).format).toBe("svg");
    expect(imageInfo(Buffer.from("<html>")).format).toBe("unknown");
  });
});

describe("parseTarget", () => {
  it("adds https to bare domains", () => {
    expect(parseTarget("example.com").href).toBe("https://example.com/");
  });

  it("rejects non-http protocols", () => {
    expect(() => parseTarget("file:///etc/passwd")).toThrow(/Only http and https/);
    expect(() => parseTarget("data:text/html,hi")).toThrow();
  });
});
