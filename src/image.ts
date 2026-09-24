/** Reads width and height from the file header. No decoding, no dependency. */

export interface ImageInfo {
  format: "png" | "jpeg" | "gif" | "webp" | "svg" | "unknown";
  width?: number;
  height?: number;
}

function jpegSize(b: Buffer): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0-SOF15 carry dimensions, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return undefined;
}

function webpSize(b: Buffer): { width: number; height: number } | undefined {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 ") {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return undefined;
}

export function imageInfo(b: Buffer): ImageInfo {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    return { format: "jpeg", ...jpegSize(b) };
  }
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") {
    return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return { format: "webp", ...webpSize(b) };
  }
  if (/^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(b.toString("utf8", 0, 512))) {
    return { format: "svg" };
  }
  return { format: "unknown" };
}
