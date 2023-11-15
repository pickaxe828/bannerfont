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

async function processDirectory(directory: string, colorNumber: number, time: number) {
  console.log(`Creating tasks to pixilate: ${directory}`)
  let files = fs.readdirSync(directory)
  console.log("Start running tasks to pixilate...")
  let tasks = files.map((file) => processImageAndExport(directory, file, colorNumber))
  console.log(`Number of tasks: ${tasks.length}`)
  await Promise.allSettled(tasks) // Hehehehheehe
  exportEmptySVGs(OUTDIR, "ucfff7")
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