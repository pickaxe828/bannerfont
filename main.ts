import { processImage } from "./src/pixilate.ts"

let args = process.argv.slice(2)

if (args.length === 0) { throw new Error("No image path provided") }

await processImage(args[0])