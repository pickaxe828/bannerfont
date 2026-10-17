// Builds the 688 layer PNGs (16 layer colors x 43 patterns) from the Mojang client jar.
// PNGs are read and written by ./png.ts rather than node-canvas, which premultiplies alpha and
// would distort the color of every low-alpha pixel.
// Usage: pnpm extract [--mc-version <id>] [-o <dir>] [--cache <dir>]
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import Arg from "arg"
import { unzipSync } from "fflate"

import { decodePng, encodePng } from "./png.ts"

/**
 * Pattern yy (the array index, 00-42) -> texture file name in the jar, without extension.
 * Pattern 00 uses base.png (banner_base.png also exists and is not used).
 */
export const PATTERN_TEXTURES: readonly string[] = [
  "base", "border", "bricks", "circle", "creeper", "cross", "curly_border", "diagonal_left",
  "diagonal_right", "diagonal_up_left", "diagonal_up_right", "flower", "globe", "gradient",
  "gradient_up", "half_horizontal", "half_horizontal_bottom", "half_vertical", "half_vertical_right",
  "mojang", "piglin", "rhombus", "skull", "small_stripes", "square_bottom_left", "square_bottom_right",
  "square_top_left", "square_top_right", "straight_cross", "stripe_bottom", "stripe_center",
  "stripe_downleft", "stripe_downright", "stripe_left", "stripe_middle", "stripe_right", "stripe_top",
  "triangle_bottom", "triangle_top", "triangles_bottom", "triangles_top", "flow", "guster",
]

/** Path of the texture of pattern `yy` inside the client jar. */
export function textureEntryName(yy: number): string {
  return `assets/minecraft/textures/entity/banner/${PATTERN_TEXTURES[yy]}.png`
}

/**
 * Layer color digit x (the array index, 0-f) -> name and tint 0xRRGGBB. The digit order is the
 * frozen encoding order. These are the `DyeColor` constants (Java integers) of the client jars,
 * identical in 1.12.2 through 26.3. They are not the Minecraft wiki "Pattern color" values, which
 * are `MapColor`s.
 */
export const LAYER_COLORS: readonly { name: string; rgb: number }[] = [
  { name: "white", rgb: 0xf9fffe },
  { name: "light_gray", rgb: 0x9d9d97 },
  { name: "gray", rgb: 0x474f52 },
  { name: "black", rgb: 0x1d1d21 },
  { name: "yellow", rgb: 0xfed83d },
  { name: "orange", rgb: 0xf9801d },
  { name: "red", rgb: 0xb02e26 },
  { name: "brown", rgb: 0x835432 },
  { name: "lime", rgb: 0x80c71f },
  { name: "green", rgb: 0x5e7c16 },
  { name: "light_blue", rgb: 0x3ab3da },
  { name: "cyan", rgb: 0x169c9c },
  { name: "blue", rgb: 0x3c44aa },
  { name: "pink", rgb: 0xf38baa },
  { name: "magenta", rgb: 0xc74ebd },
  { name: "purple", rgb: 0x8932b8 },
]

/** Oldest supported release. Older jars have no DyeColor tint constants. */
export const MIN_VERSION = "1.12.2"

/** Compares two manifest `releaseTime` stamps: negative if `a` is older, positive if newer, 0 if the same instant. */
export function compareVersions(a: string, b: string): number {
  const diff = Date.parse(a) - Date.parse(b)
  return Number.isNaN(diff) ? Number.NaN : Math.sign(diff)
}

export interface ManifestVersion {
  id: string
  type: string
  url: string
  releaseTime: string
}

export interface Manifest {
  versions: ManifestVersion[]
}

/** Finds `id` in the Mojang version manifest. Errors on an unknown id, a non-release type, or a release older than 1.12.2. */
export function parseManifest(manifest: Manifest, id: string): { id: string; url: string } {
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`Unknown Minecraft version "${id}"`)
  if (entry.type !== "release") {
    throw new Error(`"${id}" is a ${entry.type}, only release versions are supported`)
  }
  const floor = manifest.versions.find((v) => v.id === MIN_VERSION)
  if (!floor) throw new Error(`The manifest has no ${MIN_VERSION} entry to compare against`)
  if (!(compareVersions(entry.releaseTime, floor.releaseTime) >= 0)) {
    throw new Error(`Minecraft ${id} is older than ${MIN_VERSION}, the oldest supported version`)
  }
  return { id: entry.id, url: entry.url }
}

/**
 * True when one of the `classes` (raw .class file bytes) holds all 16 tints as Java int constants,
 * that is tag 0x03 + big-endian int32. In every supported jar they all sit in the `DyeColor` class.
 */
export function jarHasDyeValues(classes: Iterable<Uint8Array>): boolean {
  const needles = LAYER_COLORS.map(({ rgb }) => Buffer.from([0x03, 0x00, (rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]))
  for (const cls of classes) {
    const buf = Buffer.from(cls.buffer, cls.byteOffset, cls.byteLength)
    if (needles.every((n) => buf.includes(n))) return true
  }
  return false
}

/** Multiplies every RGB channel of RGBA `pixels` by the tint `rgb` (0xRRGGBB): floor(tex * dye / 255). Alpha is copied. */
export function multiplyLayer(pixels: Uint8Array | Uint8ClampedArray, rgb: number): Uint8Array {
  const dye = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.floor((pixels[i + c] * dye[c]) / 255)
    out[i + 3] = pixels[i + 3]
  }
  return out
}

/** The front face of a banner texture: the box (1,1)-(21,41), which is a 20x40 image. */
export const FRONT_FACE = { x: 1, y: 1, width: 20, height: 40 } as const

/** Thrown by `cropFront` for a texture that cannot hold the front face. */
export class TextureTooSmallError extends Error {}

/**
 * Crops the front face (`FRONT_FACE`) from RGBA `pixels` that are `width` px wide.
 * `name` is the texture file, used in the error for a texture smaller than 21x41.
 */
export function cropFront(pixels: Uint8Array | Uint8ClampedArray, width: number, name: string): Uint8Array {
  const { x: fx, y: fy, width: fw, height: fh } = FRONT_FACE
  const height = pixels.length / 4 / width
  if (width < fx + fw || height < fy + fh) {
    throw new TextureTooSmallError(
      `Texture ${name} is ${width}x${height}, too small to hold the ${fw}x${fh} front face (needs at least ${fx + fw}x${fy + fh})`,
    )
  }
  const out = new Uint8Array(fw * fh * 4)
  for (let y = 0; y < fh; y++) {
    const from = ((y + fy) * width + fx) * 4
    out.set(pixels.subarray(from, from + fw * 4), y * fw * 4)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// I/O: manifest, jar download, PNG output

export const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  return res
}

/** Path of the cached client jar of `version`. */
export function jarPath(cacheDir: string, version: string): string {
  return path.join(cacheDir, "minecraft", version, "client.jar")
}

/** Returns the cached client jar of `version`, downloading and SHA-1-verifying it first when it is absent. */
export async function ensureJar(cacheDir: string, version: string): Promise<string> {
  const jar = jarPath(cacheDir, version)
  if (fs.existsSync(jar)) return jar

  const manifest = (await (await fetchOk(MANIFEST_URL)).json()) as Manifest
  const { url } = parseManifest(manifest, version)
  const versionJson = (await (await fetchOk(url)).json()) as { downloads: { client: { url: string; sha1: string } } }
  const client = versionJson.downloads.client

  console.log(`Downloading Minecraft ${version} client jar`)
  const data = Buffer.from(await (await fetchOk(client.url)).arrayBuffer())
  const sha1 = crypto.createHash("sha1").update(data).digest("hex")
  if (sha1 !== client.sha1) {
    // Nothing has been written yet, so a bad download is never left behind as a cached jar
    throw new Error(`SHA-1 mismatch for the ${version} client jar: expected ${client.sha1}, got ${sha1}`)
  }
  fs.mkdirSync(path.dirname(jar), { recursive: true })
  // Write beside the target and rename, so an interrupted write never leaves a truncated client.jar
  // that later runs would trust. A rename within one directory is atomic.
  const tmp = `${jar}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, jar)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  return jar
}

/**
 * Writes `<x><yy>.png` into `outDir` for every pattern whose texture `readTexture` returns, for all 16 layer colors.
 * `warn` is called once per pattern with no texture. Other files in `outDir` are left alone.
 */
export async function writeLayers(
  readTexture: (entry: string) => Uint8Array | undefined,
  outDir: string,
  warn: (message: string) => void = console.warn,
): Promise<{ written: number; missing: number }> {
  fs.mkdirSync(outDir, { recursive: true })
  let written = 0
  let missing = 0
  for (let yy = 0; yy < PATTERN_TEXTURES.length; yy++) {
    const entry = textureEntryName(yy)
    const png = readTexture(entry)
    if (!png) {
      warn(`Missing texture for pattern ${String(yy).padStart(2, "0")}: ${entry}`)
      missing++
      continue
    }
    const { pixels, width } = decodePng(png)
    let front: Uint8Array
    try {
      front = cropFront(pixels, width, entry)
    } catch (err) {
      if (!(err instanceof TextureTooSmallError)) throw err
      // Same as a missing texture: one warning, no PNGs for this pattern
      warn(`Pattern ${String(yy).padStart(2, "0")} skipped: ${err.message}`)
      missing++
      continue
    }
    LAYER_COLORS.forEach(({ rgb }, x) => {
      const file = path.join(outDir, `${x.toString(16)}${String(yy).padStart(2, "0")}.png`)
      fs.writeFileSync(file, encodePng(multiplyLayer(front, rgb), FRONT_FACE.width, FRONT_FACE.height))
      written++
    })
  }
  return { written, missing }
}

const DYE_NOTICE =
  "Notice: the 16 layer colors were not found as DyeColor constants in this jar, so the tints are unverified for it. Continuing with the built-in table."

/** Reads the banner textures of the jar at `jar` in memory, builds the layer PNGs and returns the counts. */
export async function extractFromJar(jar: string, outDir: string): Promise<{ written: number; missing: number }> {
  const data = new Uint8Array(fs.readFileSync(jar))
  const wanted = new Set(PATTERN_TEXTURES.map((_, yy) => textureEntryName(yy)))
  const textures = unzipSync(data, { filter: (f) => wanted.has(f.name) })
  const result = await writeLayers((entry) => textures[entry], outDir)

  const classes = unzipSync(data, { filter: (f) => f.name.endsWith(".class") })
  if (!jarHasDyeValues(Object.values(classes))) console.log(DYE_NOTICE)
  return result
}

async function main(): Promise<void> {
  const args = Arg({
    "--mc-version": String,
    "--output": String,
    "--cache": String,
    "-o": "--output",
  })
  const version = args["--mc-version"] ?? "1.21.2"
  const outDir = args["--output"] ?? "./images"
  const cacheDir = args["--cache"] ?? "./.cache"

  const jar = await ensureJar(cacheDir, version)
  const { written, missing } = await extractFromJar(jar, outDir)
  console.log(`${written} PNGs written, ${missing} patterns missing`)
}

// Only run as a script, so the tests can import the pure functions
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
