import fs from "fs"

import paper from "paper"
import quanti from "quanti"
import Path from "path"
import canvas, { createCanvas } from "canvas"

import { getName_King } from "./naming.ts"
import { decodePng } from "./png.ts"


// One banner is 20x40. nanoemoji derives the advance width from the viewBox aspect
// ratio (see exportEmptySVGs), so these two numbers also set the per-glyph advance.
export const BANNER_WIDTH = 20
export const BANNER_HEIGHT = 40
const X_OFFSET = -BANNER_WIDTH

// Vertices are grid corners, packed into one integer so they can key a Map. The +1
// keeps the -1 row and column (needed by the empty-neighbour tests) non-negative.
const VERTEX_STRIDE = 4096
const vertex = (x: number, y: number) => (y + 1) * VERTEX_STRIDE + (x + 1)

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

/**
 * Union a set of unit grid cells into SVG path data by tracing its boundary.
 *
 * This replaces a Paper.js boolean unite over one `Path.Rectangle` per pixel. That
 * unite was 95% of stage 1: reducing N rectangles pairwise costs O(N^2) in segments,
 * and stage 1 unites ~200k of them. Because every cell here is an axis-aligned unit
 * square on an integer grid, the union needs no boolean geometry at all - it is a
 * contour trace, and it runs in time linear in the number of pixels.
 *
 * Each filled cell contributes the edges whose neighbour is empty, directed so the
 * filled side is always on the same hand. Outer boundaries therefore wind one way and
 * holes the other, which is exactly what `fill-rule="nonzero"` needs. Chaining those
 * directed edges head-to-tail yields the closed loops.
 *
 * Where two cells touch only at a corner, four edges meet at that vertex and the
 * pairing is ambiguous. Either choice closes into valid loops with the same winding
 * and covers the same area, so the loop below just takes them in any order.
 */
function traceOutline(cells: number[], offset: number): string {
  const filled = new Set(cells)

  // Directed boundary edges, keyed by start vertex.
  const from = new Map<number, number[]>()
  const edge = (start: number, end: number) => {
    const outgoing = from.get(start)
    if (outgoing === undefined) { from.set(start, [end]) } else { outgoing.push(end) }
  }
  for (const cell of cells) {
    const x = (cell % VERTEX_STRIDE) - 1
    const y = Math.floor(cell / VERTEX_STRIDE) - 1
    if (!filled.has(vertex(x, y - 1))) { edge(vertex(x, y), vertex(x + 1, y)) }
    if (!filled.has(vertex(x + 1, y))) { edge(vertex(x + 1, y), vertex(x + 1, y + 1)) }
    if (!filled.has(vertex(x, y + 1))) { edge(vertex(x + 1, y + 1), vertex(x, y + 1)) }
    if (!filled.has(vertex(x - 1, y))) { edge(vertex(x, y + 1), vertex(x, y)) }
  }

  let data = ""
  for (const start of from.keys()) {
    while ((from.get(start)?.length ?? 0) > 0) {
      const loop = [start]
      let at = start
      for (;;) {
        const outgoing = from.get(at)!
        const next = outgoing.pop()!
        if (outgoing.length === 0) { from.delete(at) }
        if (next === start) { break }
        loop.push(next)
        at = next
      }

      // Emit as h/v runs. Every edge is axis-aligned, so consecutive edges in the same
      // direction collapse into one command; that is what Paper.js used to emit too.
      const first = loop[0]
      let cursorX = (first % VERTEX_STRIDE) - 1 + offset
      let cursorY = Math.floor(first / VERTEX_STRIDE) - 1
      data += `M${cursorX},${cursorY}`
      for (let i = 1; i <= loop.length; i++) {
        const point = loop[i % loop.length]
        const x = (point % VERTEX_STRIDE) - 1 + offset
        const y = Math.floor(point / VERTEX_STRIDE) - 1
        // Skip the vertex entirely when the next edge continues in the same direction.
        const after = loop[(i + 1) % loop.length]
        const nextX = (after % VERTEX_STRIDE) - 1 + offset
        const nextY = Math.floor(after / VERTEX_STRIDE) - 1
        if (i < loop.length && (x - cursorX === 0) === (nextX - x === 0)) { continue }
        data += x === cursorX ? `v${y - cursorY}` : `h${x - cursorX}`
        cursorX = x
        cursorY = y
      }
      data += "z"
    }
  }
  return data
}

/**
 * Patterns 13 (`gra`) and 14 (`gru`) are vertical alpha ramps over a noisy gray texture. Quantizing them
 * to a handful of RGBA colors turns the ramp into visible bands, and keeping enough colors to hide the
 * bands (see AGENTS.md for the measured cost) multiplies the outline count. They are drawn as what they
 * are instead: the texture traced into a few opaque color classes, each class painted with the same
 * linear alpha gradient.
 */
export const RAMP_PATTERNS = ["13", "14"]
/** Opaque color classes the ramp texture is traced into. */
export const RAMP_COLOR_CLASSES = 4
/** Flat RGBA colors of the fallback trace, for renderers that cannot draw a gradient (COLRv0). */
export const RAMP_FALLBACK_COLORS = 16

export interface RampOptions {
  classes: number
  fallbackColors: number
}

export interface ProcessedImage {
  svg: string
  /** A flat-color version of `svg`, written beside it as `<glyph>.flat.svg`. Only the ramp patterns have one. */
  fallbackSvg?: string
}

const svgDocument = (canvasWidth: number, body: string) =>
  `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
  ` width="${canvasWidth}" height="${BANNER_HEIGHT}" viewBox="0,0,${canvasWidth},${BANNER_HEIGHT}">${body}</svg>`

/**
 * Quantizes RGBA pixels in place to `colorNumber` colors and buckets the visible cells by packed RGBA.
 *
 * With `splitAlpha`, an image that has translucent pixels is split instead: the color layers are all
 * opaque (keyed by RGB alone) and the alpha goes into separate `alphas` levels, which build_font.py
 * composites over them. Translucent shapes cannot overlap without showing double alpha, so they
 * cannot be made seam-free; opaque ones can.
 */
function bucketByColour(pixels: Uint8ClampedArray, width: number, height: number, colorNumber: number, splitAlpha = false) {
  const palette = quanti(pixels, colorNumber, 4) // 4 = RGBA
  palette.process(pixels)

  let translucent = false
  if (splitAlpha) {
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] > 0 && pixels[i] < 255) { translucent = true; break } }
  }

  // Insertion order is scan order, which is the order the layers are painted in - build_font.py
  // turns each one into a COLR layer.
  const layers = new Map<number, number[]>()
  const alphas = new Map<number, number[]>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (pixels[i + 3] === 0) { continue } // transparent
      const alpha = translucent ? 255 : pixels[i + 3]
      const colour = (pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | alpha
      const cells = layers.get(colour)
      if (cells === undefined) { layers.set(colour, [vertex(x, y)]) } else { cells.push(vertex(x, y)) }
      if (translucent) {
        const level = alphas.get(pixels[i + 3])
        if (level === undefined) { alphas.set(pixels[i + 3], [vertex(x, y)]) } else { level.push(vertex(x, y)) }
      }
    }
  }
  return { layers, alphas, translucent }
}

/**
 * Seams: two shapes that meet on an edge are anti-aliased separately, so each one lets the background
 * bleed through along that edge. Fix it by growing every layer one cell *under* the later, opaque layers
 * it touches. Later layers paint over the growth, so no opaque pixel changes colour and the outer edge
 * stays exact. The growth never leaves the visible cells: a color layer must stay inside the mask,
 * because not every renderer clears the backdrop outside the source of a DEST_IN composite.
 */
function overlapSeams(layers: Map<number, number[]>) {
  const owner = new Map<number, number>()
  const order = [...layers.keys()]
  order.forEach((colour, index) => { for (const cell of layers.get(colour)!) { owner.set(cell, index) } })
  const grown = new Map<number, number[]>()
  order.forEach((colour, index) => {
    const extra = new Set<number>()
    for (const cell of layers.get(colour)!) {
      for (const near of [cell - 1, cell + 1, cell - VERTEX_STRIDE, cell + VERTEX_STRIDE]) {
        const other = owner.get(near)
        if (other !== undefined && other > index && (order[other] & 0xff) === 255) { extra.add(near) }
      }
    }
    grown.set(colour, extra.size === 0 ? layers.get(colour)! : layers.get(colour)!.concat([...extra]))
  })
  return grown
}

const hexOf = (colour: number) => ((colour >>> 8) & 0xffffff).toString(16).padStart(6, "0")
const round5 = (value: number) => Math.round(value * 1e5) / 1e5

/** One flat-color group per quantized color. Alpha becomes fill-opacity, as Paper.js wrote it. */
function flatGroups(layers: Map<number, number[]>, offset: number) {
  let groups = ""
  for (const [colour, cells] of layers) {
    const alpha = colour & 0xff
    const opacity = alpha === 255 ? "" : ` fill-opacity="${round5(alpha / 255)}"`
    groups += `<g fill="#${hexOf(colour)}"${opacity} fill-rule="nonzero"><path d="${traceOutline(cells, offset)}"/></g>`
  }
  return groups
}

/**
 * Mask layers: level k covers every cell with alpha >= a_k, so the levels are nested and share no edge
 * that could leave a seam. Each is painted with the increment that takes the running alpha from
 * a_(k-1) to a_k.
 */
function maskGroups(alphas: Map<number, number[]>, offset: number) {
  let groups = ""
  let previous = 0
  let covered: number[] = []
  const nested = new Map<number, number[]>()
  for (const level of [...alphas.keys()].sort((a, b) => b - a)) { covered = covered.concat(alphas.get(level)!); nested.set(level, covered) }
  for (const level of [...alphas.keys()].sort((a, b) => a - b)) {
    const target = level / 255
    const step = 1 - (1 - target) / (1 - previous)
    previous = target
    const opacity = step >= 1 ? "" : ` fill-opacity="${round5(step)}"`
    groups += `<g data-mask="1" fill="#000000"${opacity} fill-rule="nonzero"><path d="${traceOutline(nested.get(level)!, offset)}"/></g>`
  }
  return groups
}

/** Least-squares line through the per-row mean alpha, as [alpha at the first row's center, alpha at the last row's]. */
function fitAlphaRamp(pixels: Uint8Array, width: number, height: number): [number, number] {
  let sumY = 0, sumA = 0, sumYY = 0, sumYA = 0
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) { row += pixels[(y * width + x) * 4 + 3] }
    const a = row / width / 255
    const c = y + 0.5
    sumY += c; sumA += a; sumYY += c * c; sumYA += c * a
  }
  const slope = (height * sumYA - sumY * sumA) / (height * sumYY - sumY * sumY)
  const intercept = (sumA - slope * sumY) / height
  const at = (c: number) => Math.min(1, Math.max(0, intercept + slope * c))
  return [at(0.5), at(height - 0.5)]
}

/**
 * Draws a ramp pattern as opaque color classes under one alpha gradient. Straight RGBA is read with
 * decodePng: node-canvas premultiplies, and at the low alphas of a ramp's faint end that destroys the
 * color the classes are cut from.
 */
function rampSvg(path: string, offset: number, canvasWidth: number, classes: number): string {
  const { pixels, width, height } = decodePng(fs.readFileSync(path))
  const [from, to] = fitAlphaRamp(pixels, width, height)

  // Classes are cut from the texture alone, so every pixel is made opaque for the quantizer.
  const opaque = new Uint8ClampedArray(pixels)
  for (let i = 3; i < opaque.length; i += 4) { opaque[i] = 255 }
  // A pixel that is fully transparent in the source stays out of every class.
  const buckets = bucketByColour(opaque, width, height, classes).layers
  const visible = new Set<number>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) { if (pixels[(y * width + x) * 4 + 3] !== 0) { visible.add(vertex(x, y)) } }
  }

  let defs = ""
  let groups = ""
  let index = 0
  for (const [colour, all] of buckets) {
    const cells = all.filter((cell) => visible.has(cell))
    if (cells.length === 0) { continue }
    const id = `r${index++}`
    const stop = (at: number, alpha: number) =>
      `<stop offset="${at}" stop-color="#${hexOf(colour)}" stop-opacity="${round5(alpha)}"/>`
    defs += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${offset}" y1="0.5" x2="${offset}" y2="${height - 0.5}">` +
      `${stop(0, from)}${stop(1, to)}</linearGradient>`
    groups += `<g fill="url(#${id})" fill-rule="nonzero"><path d="${traceOutline(cells, offset)}"/></g>`
  }
  return svgDocument(canvasWidth, `<defs>${defs}</defs>${groups}`)
}

export function processImage(path: string, colorNumber: number, ramp: RampOptions = { classes: RAMP_COLOR_CLASSES, fallbackColors: RAMP_FALLBACK_COLORS }): ProcessedImage {
  // Pattern 00 is the base and is the only one with a non-zero canvas width; every
  // overlay is zero-width and shifts back by one banner so it lands on top of the base.
  let offset = 0
  let currentCode = Path.basename(path, Path.extname(path)).slice(1, 3)
  let canvasWidth = BANNER_WIDTH
  if (currentCode !== "00") {
    canvasWidth = 0
    offset = X_OFFSET
  }

  // Read image as canvas element
  let image = new canvas.Image
  image.src = fs.readFileSync(path)

  let canva = new canvas.Canvas(image.width, image.height)
  let ctx = canva.getContext('2d')
  ctx.drawImage(image, 0, 0, image.width, image.height)
  let imageData = ctx.getImageData(0, 0, image.width, image.height)

  // Trace each colour's pixels into one path, and emit the SVG directly. Paper.js is
  // not involved: it only ever saw axis-aligned unit squares on an integer grid, which
  // traceOutline unions exactly and far more cheaply than a boolean op can.
  const original = new Uint8ClampedArray(imageData.data)
  const flat = (pixels: Uint8ClampedArray, colors: number) =>
    svgDocument(canvasWidth, flatGroups(bucketByColour(pixels, image.width, image.height, colors).layers, offset))

  if (RAMP_PATTERNS.includes(currentCode)) {
    return { svg: rampSvg(path, offset, canvasWidth, ramp.classes), fallbackSvg: flat(imageData.data, ramp.fallbackColors) }
  }

  const { layers, alphas, translucent } = bucketByColour(imageData.data, image.width, image.height, colorNumber, true)
  const svg = svgDocument(canvasWidth, flatGroups(overlapSeams(layers), offset) + maskGroups(alphas, offset))
  // COLRv0 and the SVG table cannot draw alpha masks: a translucent image gets a plain RGBA twin for them.
  return translucent ? { svg, fallbackSvg: flat(original, colorNumber) } : { svg }
}

/**
 * Write a glyph with no geometry, `banners` banners wide.
 *
 * nanoemoji sets the advance width to
 *   max(--width, (ascender - descender) * viewBox.w / viewBox.h)
 * and the font build used `--width 0`, so with the default 950/-250 metrics a
 * viewBox of `20n x 40` compiles to an advance of exactly `n * 600` units - i.e. an
 * empty canvas `n` banners wide *is* a space of `n` banners. `banners = 0` reproduces
 * the original zero-width behaviour used by the U+CFFF7 negative-space character.
 *
 * A viewBox cannot be negative and TrueType advance widths are unsigned, so negative
 * `banners` clamps to zero here; a backwards space has to come from GPOS instead.
 */
export async function exportEmptySVGs(directory: string, name: string, banners: number = 0) {
  paper.setup(new paper.Size(Math.max(0, banners) * BANNER_WIDTH, BANNER_HEIGHT))
  let svg = paper.project.exportSVG({ asString: true }) as string
  await fs.promises.writeFile(
    directory + "/" + name + ".svg",
    svg
  )
}

// ---------------------------------------------------------------------------------------------
// The stage: PNGs -> SVGs

// Space block, per the ClongCraft PUA allocation: U+F040 + x is a space of x banners,
// so the block runs from U+F000 (-64 banners) to U+F07F (+63 banners).
const SPACE_ORIGIN = 0xf040
const SPACE_FIRST = 0xf000
const SPACE_LAST = 0xf07f
// U+E00C is the SPACE control character, an alias for U+F041 (one banner).
const SPACE_CONTROL_CHARACTER = 0xe00c

// Control characters. A banner glyph is `ue` + colour hex + pattern *decimal*, so no
// banner ever lands on a codepoint whose last two digits are 0a-0f or 1a-1f. The
// ClongCraft allocation reserves those gaps for control characters; they get empty,
// zero-width glyphs so each one maps to a real glyph instead of tofu. U+E00C is the
// exception - exportSpaceSVGs already gives it one banner of advance.
const CONTROL_RANGES: [number, number][] = [
  [0xe00a, 0xe00f],
  [0xe01a, 0xe01f],
]

// Written one at a time: paper.setup() replaces the single global paper.project, so
// concurrent exports would race each other.
async function exportSpaceSVGs(directory: string) {
  for (let codepoint = SPACE_FIRST; codepoint <= SPACE_LAST; codepoint++) {
    await exportEmptySVGs(directory, "u" + codepoint.toString(16), codepoint - SPACE_ORIGIN)
  }
  await exportEmptySVGs(directory, "u" + SPACE_CONTROL_CHARACTER.toString(16), 1)
}

// Same one-at-a-time rule as exportSpaceSVGs: paper.setup() is global.
async function exportControlSVGs(directory: string) {
  for (let [first, last] of CONTROL_RANGES) {
    for (let codepoint = first; codepoint <= last; codepoint++) {
      if (codepoint === SPACE_CONTROL_CHARACTER) { continue }
      await exportEmptySVGs(directory, "u" + codepoint.toString(16), 0)
    }
  }
}

export interface PixilateOptions {
  /** Where the SVGs go. Created when absent. */
  output: string
  /** Colors per image, including the transparent layer. */
  colors: number
  /** Colors of the flat COLRv0 twin of the gradient patterns (13 and 14). Defaults to `RAMP_FALLBACK_COLORS`. */
  gradientColors?: number
}

export interface PixilateResult {
  /** Number of SVGs written from a PNG. */
  written: number
  failed: { path: string; message: string }[]
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Converts every PNG of the given files and directories into `<output>/<glyph>.svg`.
 * A file that fails is recorded in `failed` and does not stop the others. Directories also get
 * the geometry-free glyphs (U+CFFF7, the space block, the control gaps) after their PNGs.
 */
export async function pixilatePaths(paths: string[], options: PixilateOptions): Promise<PixilateResult> {
  const { output, colors, gradientColors = RAMP_FALLBACK_COLORS } = options
  fs.mkdirSync(output, { recursive: true })
  const result: PixilateResult = { written: 0, failed: [] }

  const convert = async (file: string) => {
    try {
      const { svg, fallbackSvg } = processImage(file, colors, { classes: RAMP_COLOR_CLASSES, fallbackColors: gradientColors })
      const glyph = Path.join(output, getName_King(Path.basename(file, Path.extname(file))))
      await fs.promises.writeFile(glyph + ".svg", svg)
      if (fallbackSvg !== undefined) {
        await fs.promises.writeFile(glyph + ".flat.svg", fallbackSvg)
      } else {
        // A previous conversion may have needed a twin that would now override the current COLRv0 glyph.
        await fs.promises.rm(glyph + ".flat.svg", { force: true })
      }
      result.written++
    } catch (err) {
      result.failed.push({ path: file, message: messageOf(err) })
    }
  }

  for (const arg of paths) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(arg)
    } catch {
      result.failed.push({ path: arg, message: `Path or argument ${arg} not found.` })
      continue
    }
    if (stat.isDirectory()) {
      const files = fs.readdirSync(arg).filter((f) => f.toLowerCase().endsWith(".png"))
      for (const file of files) await convert(Path.join(arg, file))
      await exportEmptySVGs(output, "ucfff7")
      await exportSpaceSVGs(output)
      await exportControlSVGs(output)
    } else if (stat.isFile()) {
      await convert(arg)
    } else {
      result.failed.push({ path: arg, message: `Path or argument ${arg} is neither a file nor a directory.` })
    }
  }
  return result
}
