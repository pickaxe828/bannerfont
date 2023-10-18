import { processImage } from "./pixilate.ts"

let args = process.argv.slice(2)

if (args.length === 0) { throw new Error("No image path provided") }

console.log(args[0])
processImage(args[0])