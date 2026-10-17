import { test, mock } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { decodePng, encodePng } from "./png.ts"

import { multiplyLayer, cropFront, PATTERN_TEXTURES, textureEntryName, LAYER_COLORS, compareVersions, parseManifest, jarHasDyeValues, writeLayers, extractFromJar, ensureJar, jarPath, MANIFEST_URL, FRONT_FACE } from "./extract.ts"

test("multiplyLayer floors each channel as tex*dye/255 and copies alpha", () => {
  // white (F9FFFE) on a mid grey with partial alpha
  const out = multiplyLayer(new Uint8Array([128, 200, 255, 77]), 0xf9fffe)
  // floor(128*249/255)=124, floor(200*255/255)=200, floor(255*254/255)=254
  assert.deepEqual([...out], [124, 200, 254, 77])
})

test("multiplyLayer leaves the input untouched and handles several pixels", () => {
  const input = new Uint8Array([255, 255, 255, 255, 10, 20, 30, 0])
  const out = multiplyLayer(input, 0x1d1d21)
  assert.deepEqual([...out], [0x1d, 0x1d, 0x21, 255, 1, 2, 3, 0])
  assert.deepEqual([...input], [255, 255, 255, 255, 10, 20, 30, 0])
})

test("cropFront returns the 20x40 box (1,1)-(21,41) of a 64x64 texture", () => {
  const tex = new Uint8Array(64 * 64 * 4)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) tex.set([x, y, 7, 255], (y * 64 + x) * 4)
  const out = cropFront(tex, 64, "banner/big.png")
  assert.equal(out.length, 20 * 40 * 4)
  assert.deepEqual([...out.subarray(0, 4)], [1, 1, 7, 255]) // top-left is (1,1)
  assert.deepEqual([...out.subarray(19 * 4, 20 * 4)], [20, 1, 7, 255]) // last column is x=20
  assert.deepEqual([...out.subarray(39 * 20 * 4 + 19 * 4)], [20, 40, 7, 255]) // bottom-right is (20,40)
})

test("FRONT_FACE is the 20x40 box at (1,1)", () => {
  assert.deepEqual(FRONT_FACE, { x: 1, y: 1, width: 20, height: 40 })
})

test("cropFront rejects a texture too small to hold the front face and names the file and size", () => {
  assert.throws(
    () => cropFront(new Uint8Array(16 * 16 * 4), 16, "banner/tiny.png"),
    /banner\/tiny\.png.*16x16/,
  )
})

test("cropFront accepts a texture of exactly 21x41", () => {
  assert.equal(cropFront(new Uint8Array(21 * 41 * 4), 21, "banner/exact.png").length, 20 * 40 * 4)
  assert.throws(() => cropFront(new Uint8Array(20 * 41 * 4), 20, "banner/narrow.png"), /20x41/)
  assert.throws(() => cropFront(new Uint8Array(21 * 40 * 4), 21, "banner/short.png"), /21x40/)
})

test("compareVersions orders releaseTime stamps, also across UTC offsets", () => {
  assert.ok(compareVersions("2016-12-21T09:29:12+00:00", "2017-09-18T08:39:46+00:00") < 0)
  assert.ok(compareVersions("2024-10-22T09:58:55+00:00", "2017-09-18T08:39:46+00:00") > 0)
  assert.equal(compareVersions("2017-09-18T08:39:46+00:00", "2017-09-18T10:39:46+02:00"), 0)
})

const MANIFEST = {
  latest: { release: "26.3", snapshot: "26.4-snapshot-4" },
  versions: [
    { id: "26.3", type: "release", url: "https://example.test/26.3.json", releaseTime: "2026-09-15T11:23:02+00:00" },
    { id: "26.4-snapshot-4", type: "snapshot", url: "https://example.test/s.json", releaseTime: "2026-10-01T00:00:00+00:00" },
    { id: "1.21.2", type: "release", url: "https://example.test/1.21.2.json", releaseTime: "2024-10-22T09:58:55+00:00" },
    { id: "1.12.2", type: "release", url: "https://example.test/1.12.2.json", releaseTime: "2017-09-18T08:39:46+00:00" },
    { id: "1.12.1", type: "release", url: "https://example.test/1.12.1.json", releaseTime: "2017-08-03T12:40:39+00:00" },
    { id: "1.11.2", type: "release", url: "https://example.test/1.11.2.json", releaseTime: "2016-12-21T09:29:12+00:00" },
  ],
}

test("parseManifest returns the version json url of a release at or above the floor", () => {
  assert.deepEqual(parseManifest(MANIFEST, "1.21.2"), { id: "1.21.2", url: "https://example.test/1.21.2.json" })
  assert.equal(parseManifest(MANIFEST, "1.12.2").url, "https://example.test/1.12.2.json")
})

test("parseManifest errors on an unknown id", () => {
  assert.throws(() => parseManifest(MANIFEST, "9.9.9"), /unknown/i)
})

test("parseManifest errors on a snapshot", () => {
  assert.throws(() => parseManifest(MANIFEST, "26.4-snapshot-4"), /release/i)
})

test("parseManifest errors below the floor and names 1.12.2", () => {
  assert.throws(() => parseManifest(MANIFEST, "1.12.1"), /1\.12\.2/)
  assert.throws(() => parseManifest(MANIFEST, "1.11.2"), /1\.12\.2/)
})

// A constant-pool Integer entry: tag 0x03 + big-endian int32
function intConstant(v: number): number[] {
  return [0x03, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}
const ALL_DYES = [
  0xf9fffe, 0x9d9d97, 0x474f52, 0x1d1d21, 0xfed83d, 0xf9801d, 0xb02e26, 0x835432,
  0x80c71f, 0x5e7c16, 0x3ab3da, 0x169c9c, 0x3c44aa, 0xf38baa, 0xc74ebd, 0x8932b8,
]

test("jarHasDyeValues finds the 16 tints as Java int constants in one class", () => {
  const cls = new Uint8Array([0xca, 0xfe, ...ALL_DYES.flatMap(intConstant), 0x01, 0x02])
  assert.equal(jarHasDyeValues([new Uint8Array([1, 2, 3]), cls]), true)
})

test("jarHasDyeValues is false when a tint is missing", () => {
  const cls = new Uint8Array(ALL_DYES.slice(1).flatMap(intConstant))
  assert.equal(jarHasDyeValues([cls]), false)
})

test("jarHasDyeValues needs the 0x03 tag, not just the bytes", () => {
  const cls = new Uint8Array(ALL_DYES.flatMap((v) => intConstant(v).slice(1)))
  assert.equal(jarHasDyeValues([cls]), false)
})

test("jarHasDyeValues does not combine tints spread over different classes", () => {
  const a = new Uint8Array(ALL_DYES.slice(0, 8).flatMap(intConstant))
  const b = new Uint8Array(ALL_DYES.slice(8).flatMap(intConstant))
  assert.equal(jarHasDyeValues([a, b]), false)
})

function solidPng(r: number, g: number, b: number, a: number): Uint8Array {
  const pixels = new Uint8Array(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, a], i)
  return encodePng(pixels, 64, 64)
}

function readPixel(file: string): number[] {
  const { pixels, width, height } = decodePng(fs.readFileSync(file))
  assert.equal(width, 20)
  assert.equal(height, 40)
  const at = (20 * width + 10) * 4
  return [...pixels.subarray(at, at + 4)]
}

test("writeLayers writes 16 PNGs per present pattern, warns once per missing one and keeps other files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"))
  fs.writeFileSync(path.join(dir, "keep.txt"), "x")
  const base = solidPng(200, 100, 50, 255)
  const warnings: string[] = []

  const result = await writeLayers(
    (entry) => (entry.endsWith("/base.png") ? base : undefined),
    dir,
    (m) => warnings.push(m),
  )

  assert.deepEqual(result, { written: 16, missing: 42 })
  assert.equal(warnings.length, 42)
  assert.match(warnings[0], /pattern 01/)
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort()
  assert.deepEqual(pngs, [..."0123456789abcdef"].map((x) => `${x}00.png`))
  assert.ok(fs.existsSync(path.join(dir, "keep.txt")))
  // layer color 6 is red B02E26: floor(200*176/255)=138, floor(100*46/255)=18, floor(50*38/255)=7
  assert.deepEqual(readPixel(path.join(dir, "600.png")), [138, 18, 7, 255])
  fs.rmSync(dir, { recursive: true })
})

test("writeLayers keeps the exact tint under a very low alpha", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"))
  await writeLayers((entry) => (entry.endsWith("/base.png") ? solidPng(243, 243, 243, 3) : undefined), dir, () => {})
  // black is 1D1D21: floor(243*29/255)=27, floor(243*33/255)=31
  assert.deepEqual(readPixel(path.join(dir, "300.png")), [27, 27, 31, 3])
  fs.rmSync(dir, { recursive: true })
})

test("writeLayers treats a too-small texture like a missing one: one warning, no PNGs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"))
  const tiny = encodePng(new Uint8Array(16 * 16 * 4), 16, 16)
  const warnings: string[] = []

  const result = await writeLayers(
    (entry) => (entry.endsWith("/base.png") ? solidPng(200, 100, 50, 255) : entry.endsWith("/border.png") ? tiny : undefined),
    dir,
    (m) => warnings.push(m),
  )

  assert.deepEqual(result, { written: 16, missing: 42 })
  assert.equal(warnings.length, 42)
  const small = warnings.filter((m) => m.includes("/border.png"))
  assert.equal(small.length, 1)
  assert.match(small[0], /16x16/)
  assert.equal(fs.readdirSync(dir).filter((f) => /^.01\.png$/.test(f)).length, 0)
  fs.rmSync(dir, { recursive: true })
})

test("ensureJar leaves no client.jar behind when writing the jar fails", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "extract-cache-"))
  const jar = Buffer.from("not really a jar")
  const sha1 = crypto.createHash("sha1").update(jar).digest("hex")
  const responses: Record<string, unknown> = {
    [MANIFEST_URL]: { versions: [{ id: "1.21.2", type: "release", url: "https://example.test/v.json", releaseTime: "2024-10-22T09:58:55+00:00" }, { id: "1.12.2", type: "release", url: "https://example.test/f.json", releaseTime: "2017-09-18T08:39:46+00:00" }] },
    "https://example.test/v.json": { downloads: { client: { url: "https://example.test/client.jar", sha1 } } },
  }
  const fetchMock = mock.method(globalThis, "fetch", async (url: string) =>
    url === "https://example.test/client.jar" ? new Response(jar) : Response.json(responses[url]),
  )
  const realWrite = fs.writeFileSync
  // Simulates an interrupted write: half of the bytes reach the disk, then it throws
  const writeMock = mock.method(fs, "writeFileSync", (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
    realWrite(file, (data as Buffer).subarray(0, 5))
    throw new Error("disk full")
  })
  try {
    await assert.rejects(() => ensureJar(cache, "1.21.2"), /disk full/)
    assert.equal(fs.existsSync(jarPath(cache, "1.21.2")), false)
    writeMock.mock.restore()
    // A later run downloads again and succeeds
    assert.equal(await ensureJar(cache, "1.21.2"), jarPath(cache, "1.21.2"))
    assert.deepEqual(fs.readFileSync(jarPath(cache, "1.21.2")), jar)
  } finally {
    writeMock.mock.restore()
    fetchMock.mock.restore()
    fs.rmSync(cache, { recursive: true })
  }
})

const LOCAL_JAR = "/Users/pickaxe828/.claude/jobs/57de1d97/tmp/mc/client.jar"

test("extractFromJar builds all 688 PNGs from a real 26.3 jar", { skip: !fs.existsSync(LOCAL_JAR) && "local jar not present" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-jar-"))
  const result = await extractFromJar(LOCAL_JAR, dir)
  assert.deepEqual(result, { written: 688, missing: 0 })
  assert.equal(fs.readdirSync(dir).length, 688)
  // black (3) multiplied by anything is at most 0x1d..0x21 per channel
  const [r, g, b] = readPixel(path.join(dir, "300.png"))
  assert.ok(r <= 0x1d && g <= 0x1d && b <= 0x21)
  fs.rmSync(dir, { recursive: true })
})

test("pattern map covers 00-42 and matches the notes", () => {
  assert.equal(PATTERN_TEXTURES.length, 43)
  assert.equal(PATTERN_TEXTURES[0], "base")
  assert.equal(PATTERN_TEXTURES[13], "gradient")
  assert.equal(PATTERN_TEXTURES[19], "mojang")
  assert.equal(PATTERN_TEXTURES[41], "flow")
  assert.equal(PATTERN_TEXTURES[42], "guster")
  assert.equal(new Set(PATTERN_TEXTURES).size, 43)
})

test("textureEntryName builds the jar path of a pattern", () => {
  assert.equal(textureEntryName(1), "assets/minecraft/textures/entity/banner/border.png")
})

test("layer color table is the frozen 16-digit oracle order", () => {
  assert.equal(LAYER_COLORS.length, 16)
  assert.deepEqual(
    LAYER_COLORS.slice(0, 3).map((c) => [c.name, c.rgb]),
    [
      ["white", 0xf9fffe],
      ["light_gray", 0x9d9d97],
      ["gray", 0x474f52],
    ],
  )
  assert.deepEqual(LAYER_COLORS[10], { name: "light_blue", rgb: 0x3ab3da })
  assert.deepEqual(LAYER_COLORS[15], { name: "purple", rgb: 0x8932b8 })
})
