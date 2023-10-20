import * as fs from "fs"

import { processImage } from "./pixilate.ts"
import { rejects } from "assert"
import path from "path"

const OUTDIR = "./dist"
const COLORNUMBER = 3

let args = process.argv.slice(2)

if (args.length === 0) { throw new Error("No image file/ directory provided") }
else if (args.length > 1) { throw new Error("Too many arguments") }

console.log(args[0])


async function processImageAndExport(path: string, file: string, colourNumber: number) {
    console.log(`Processing: ${file}`)
    let result = await processImage(`${path}/${file}`, colourNumber)
    await fs.promises.writeFile(OUTDIR + "/" + file.replace(".png", "") + ".svg", result)
    // console.log(`Exported: ${file.replace(".png", "") + ".svg"}`)
}

async function processDirectory(path: string, colourNumber: number) {
    console.log(`Creating tasks to pixilate: ${path}`)
    let files = fs.readdirSync(path)
    let tasks = files.map((file) => processImageAndExport(path, file, colourNumber))
    console.log(`Number of tasks: ${tasks.length}`)
    console.log("Start running tasks to pixilate...")
    await Promise.allSettled(tasks) // Hehehehheehe
}

let t0 = performance.now()
args.forEach( async (arg) => {
    if (fs.lstatSync(args[0]).isDirectory()) {
        await processDirectory(args[0], COLORNUMBER)
    } else {
        let result = await processImage(args[0], COLORNUMBER)
        fs.writeFileSync(OUTDIR + "/" + path.basename(args[0], path.extname(args[0])) + ".svg", result)
    }
})
let t1 = performance.now()
console.log(`Finish all tasks took ${t1 - t0} milliseconds.`)