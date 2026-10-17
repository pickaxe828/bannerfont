// A minimal PNG codec for straight (non-premultiplied) RGBA pixels.
//
// node-canvas premultiplies on the way in and out, so a pixel with a low alpha loses most of its
// color: tex 243 at alpha 3 comes back as 85. The banner textures have plenty of such pixels
// (gradients, soft edges), so the layer PNGs are decoded and encoded here instead.

import { unzlibSync, zlibSync } from "fflate"

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Encodes `pixels` (RGBA, 8 bits, not premultiplied) as a PNG. */
export function encodePng(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8 bit, RGBA, deflate, adaptive filtering, no interlace

  const stride = width * 4
  const scanlines = new Uint8Array(height * (stride + 1)) // every filter byte stays 0 (None)
  for (let y = 0; y < height; y++) scanlines.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)

  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(scanlines)), chunk("IEND", new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Decodes a non-interlaced PNG (8-bit grey, grey+alpha, RGB, RGBA, or a palette of 1-8 bits) to straight RGBA. */
export function decodePng(png: Uint8Array): { pixels: Uint8Array; width: number; height: number } {
  if (png.length < 8 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error("Not a PNG file")
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []

  for (let at = 8; at + 8 <= png.length; ) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + len)
    at += 12 + len
    if (type === "IHDR") {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = ihdr.getUint32(0)
      height = ihdr.getUint32(4)
      ;[bitDepth, colorType] = [data[8], data[9]]
      if (data[12] !== 0) throw new Error("Interlaced PNGs are not supported")
    } else if (type === "PLTE") palette = data
    else if (type === "tRNS") trns = data
    else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
  }

  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`)
  if (colorType === 3 ? ![1, 2, 4, 8].includes(bitDepth) : bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth} for color type ${colorType}`)
  }
  if (colorType === 3 && !palette) throw new Error("Palette PNG without a PLTE chunk")
  if (trns && (colorType === 0 || colorType === 2)) throw new Error("tRNS on grey or RGB PNGs is not supported")

  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of idat) {
    joined.set(p, off)
    off += p.length
  }
  const raw = unzlibSync(joined)

  const bpp = Math.max(1, (channels * bitDepth) >> 3)
  const stride = Math.ceil((width * channels * bitDepth) / 8)
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = rows.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`)
      cur[i] = (src[i] + predictor) & 0xff
    }
  }

  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 3) {
        const bit = x * bitDepth
        const idx = bitDepth === 8 ? row[x] : (row[bit >> 3] >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1)
        pixels.set([palette![idx * 3], palette![idx * 3 + 1], palette![idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255], o)
      } else if (colorType === 6) pixels.set(row.subarray(x * 4, x * 4 + 4), o)
      else if (colorType === 2) pixels.set([row[x * 3], row[x * 3 + 1], row[x * 3 + 2], 255], o)
      else if (colorType === 4) pixels.set([row[x * 2], row[x * 2], row[x * 2], row[x * 2 + 1]], o)
      else pixels.set([row[x], row[x], row[x], 255], o)
    }
  }
  return { pixels, width, height }
}
