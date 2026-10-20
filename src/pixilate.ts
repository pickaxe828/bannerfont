import fs from "fs"

import paper from "paper"
import quanti from "quanti"
import Path from "path"
import canvas, { createCanvas } from "canvas"

import { getName_King } from "./naming.ts"


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

export function processImage(path: string, colorNumber: number, detailedColorNumber: number) {
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

  // Quantization
  const palette = quanti(imageData.data, (currentCode === "13" || currentCode === "14") ? detailedColorNumber : colorNumber, 4) // 4 = RGBA
  palette.process(imageData.data)

  // Bucket the opaque pixels by colour. Insertion order is scan order, which is the
  // order the layers are painted in - build_font.py turns each one into a COLR layer.
  let layers = new Map<number, number[]>()
  let pixels = imageData.data
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      let i = (y * image.width + x) * 4
      // Skip transparent pixels
      if (pixels[i + 3] === 0) { continue }
      let colour = (pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]
      let cells = layers.get(colour)
      if (cells === undefined) { layers.set(colour, [vertex(x, y)]) } else { cells.push(vertex(x, y)) }
    }
  }

  // Trace each colour's pixels into one path, and emit the SVG directly. Paper.js is
  // not involved: it only ever saw axis-aligned unit squares on an integer grid, which
  // traceOutline unions exactly and far more cheaply than a boolean op can.
  let groups = ""
  for (let [colour, cells] of layers) {
    let hex = ((colour >>> 8) & 0xffffff).toString(16).padStart(6, "0")
    let alpha = colour & 0xff
    // Paper.js wrote fill-opacity to 5 decimals; match it so the COLR alphas are
    // bit-identical to the fonts built before this change.
    let opacity = alpha === 255 ? "" : ` fill-opacity="${Math.round((alpha / 255) * 1e5) / 1e5}"`
    groups += `<g fill="#${hex}"${opacity} fill-rule="nonzero"><path d="${traceOutline(cells, offset)}"/></g>`
  }

  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${canvasWidth}" height="${BANNER_HEIGHT}" viewBox="0,0,${canvasWidth},${BANNER_HEIGHT}">${groups}</svg>`
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
  /** Colours per image, including the transparent layer. */
  colors: number
  /** Called once per file before it is converted. */
  onFile?: (file: string) => void
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
  const { output, colors, onFile } = options
  fs.mkdirSync(output, { recursive: true })
  const result: PixilateResult = { written: 0, failed: [] }

  const convert = async (file: string) => {
    onFile?.(file)
    try {
      const svg = processImage(file, colors, 10)
      await fs.promises.writeFile(
        Path.join(output, getName_King(Path.basename(file, Path.extname(file))) + ".svg"),
        svg,
      )
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
