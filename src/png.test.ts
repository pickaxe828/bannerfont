import { test } from "node:test"
import assert from "node:assert/strict"

import { zlibSync } from "fflate"

import { decodePng, encodePng } from "./png.ts"

// Hand-built PNG: the signature, an IHDR, the extra chunks, one IDAT of `scanlines` (filter bytes included), an IEND.
// The CRC fields are left zero: the decoder does not check them.
function chunk(type: string, data: number[]): number[] {
  const len = data.length
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0]
}
function rawPng(width: number, height: number, bitDepth: number, colorType: number, scanlines: number[], extra: number[][] = []): Uint8Array {
  const ihdr = [0, 0, 0, width, 0, 0, 0, height, bitDepth, colorType, 0, 0, 0]
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr),
    ...extra.flat(),
    ...chunk("IDAT", [...zlibSync(new Uint8Array(scanlines))]),
    ...chunk("IEND", []),
  ])
}

test("encodePng then decodePng keeps colors under low alpha exactly", () => {
  const pixels = new Uint8Array([243, 243, 243, 3, 10, 20, 30, 0, 255, 128, 1, 255, 77, 88, 99, 100])
  const out = decodePng(encodePng(pixels, 2, 2))
  assert.equal(out.width, 2)
  assert.equal(out.height, 2)
  assert.deepEqual([...out.pixels], [...pixels])
})

test("encodePng writes a PNG signature and IHDR", () => {
  const png = encodePng(new Uint8Array(20 * 40 * 4), 20, 40)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(new DataView(png.buffer, png.byteOffset).getUint32(16), 20)
  assert.equal(new DataView(png.buffer, png.byteOffset).getUint32(20), 40)
})

test("decodePng undoes the Sub filter on RGBA", () => {
  const png = rawPng(2, 1, 8, 6, [1, 10, 20, 30, 40, 1, 1, 1, 1])
  assert.deepEqual([...decodePng(png).pixels], [10, 20, 30, 40, 11, 21, 31, 41])
})

test("decodePng undoes Up, Average and Paeth against the previous row", () => {
  const row1 = [0, 10, 10, 10, 10, 20, 20, 20, 20]
  const up = decodePng(rawPng(2, 2, 8, 6, [...row1, 2, 1, 1, 1, 1, 2, 2, 2, 2]))
  assert.deepEqual([...up.pixels.subarray(8)], [11, 11, 11, 11, 22, 22, 22, 22])
  // average: floor((left + up) / 2): px1 (0+10)/2=5 -> 5+5=10, px2 (10+20)/2=15 -> 15+5=20
  const avg = decodePng(rawPng(2, 2, 8, 6, [...row1, 3, 5, 5, 5, 5, 5, 5, 5, 5]))
  assert.deepEqual([...avg.pixels.subarray(8)], [10, 10, 10, 10, 20, 20, 20, 20])
  // paeth: px1 predicts Up (10) -> 11; px2: a=11, b=20, c=10 -> b (20) -> 22
  const paeth = decodePng(rawPng(2, 2, 8, 6, [...row1, 4, 1, 1, 1, 1, 2, 2, 2, 2]))
  assert.deepEqual([...paeth.pixels.subarray(8)], [11, 11, 11, 11, 22, 22, 22, 22])
})

test("decodePng expands grey+alpha, plain RGB and grey", () => {
  assert.deepEqual([...decodePng(rawPng(1, 1, 8, 4, [0, 100, 7])).pixels], [100, 100, 100, 7])
  assert.deepEqual([...decodePng(rawPng(1, 1, 8, 2, [0, 1, 2, 3])).pixels], [1, 2, 3, 255])
  assert.deepEqual([...decodePng(rawPng(1, 1, 8, 0, [0, 9])).pixels], [9, 9, 9, 255])
})

test("decodePng reads a 1-bit palette with tRNS", () => {
  const plte = chunk("PLTE", [255, 0, 0, 0, 255, 0])
  const trns = chunk("tRNS", [0])
  // 8 px wide, bits 1010 0000 -> indices 1 0 1 0 0 0 0 0
  const png = rawPng(8, 1, 1, 3, [0, 0b10100000], [plte, trns])
  const px = decodePng(png).pixels
  assert.deepEqual([...px.subarray(0, 4)], [0, 255, 0, 255]) // index 1: no tRNS entry, opaque
  assert.deepEqual([...px.subarray(4, 8)], [255, 0, 0, 0]) // index 0: transparent
})

test("decodePng reads an 8-bit palette with tRNS alpha", () => {
  const png = rawPng(2, 1, 8, 3, [0, 1, 0], [chunk("PLTE", [1, 2, 3, 4, 5, 6]), chunk("tRNS", [200, 50])])
  assert.deepEqual([...decodePng(png).pixels], [4, 5, 6, 50, 1, 2, 3, 200])
})

test("decodePng rejects what it does not support", () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3])), /PNG/)
  assert.throws(() => decodePng(rawPng(1, 1, 16, 6, new Array(9).fill(0))), /bit depth/i)
})
