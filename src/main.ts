import * as fs from "fs"

import { processImage, exportEmptySVGs } from "./pixilate.ts"
import { getName_King } from "./naming.ts"

import Arg from "arg"
import Path from "path"

const args = Arg(
  {
    "--output": String,
    "--colors": Number,
    // Aliases
    "-o": "--output",
    "-c": "--colors",
    "--colours": "--colors",
  }
)

const OUTDIR = args["--output"] ?? "./out"
const COLORNUMBER = args["--colors"] ?? 3 // Including transparent layer lmao

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

// Not tracked in git, so a fresh clone has no ./out to write into
fs.mkdirSync(OUTDIR, { recursive: true })

async function processImageAndExport(basepath: string, file: string, colorNumber: number) {
  console.log(`Processing: ${file}`)
  let result = processImage(`${basepath}/${file}`, colorNumber, 10)
  await fs.promises.writeFile(
    OUTDIR + "/" + getName_King(Path.basename(file, Path.extname(file))) + ".svg",
    result
  )
}

async function processSingleFile(arg: string, colorNumber: number) {
  let result = processImage(arg, COLORNUMBER, 10)
  fs.writeFileSync(OUTDIR + "/" + getName_King(Path.basename(arg, Path.extname(arg))) + ".svg", result)
}

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

async function processDirectory(directory: string, colorNumber: number, time: number) {
  console.log(`Creating tasks to pixilate: ${directory}`)
  let files = fs.readdirSync(directory)
  console.log("Start running tasks to pixilate...")
  let tasks = files.map((file) => processImageAndExport(directory, file, colorNumber))
  console.log(`Number of tasks: ${tasks.length}`)
  await Promise.allSettled(tasks) // Hehehehheehe
  await exportEmptySVGs(OUTDIR, "ucfff7")
  await exportSpaceSVGs(OUTDIR)
  await exportControlSVGs(OUTDIR)
}

let t0 = performance.now()
args._.forEach( async (arg) => {
  if (fs.lstatSync(arg).isDirectory()) {
    await processDirectory(arg, COLORNUMBER, t0)
  } else if (fs.lstatSync(arg).isFile() ) {
    await processSingleFile(arg, COLORNUMBER)
  } else {
    console.log(`Path or argument ${arg} not found.`)
  }
})
let t1 = performance.now()
console.log(`Finish all tasks took ${t1 - t0} milliseconds.`)