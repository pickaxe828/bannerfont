import fs from "fs"

import jimp from "jimp"
import paper from "paper"
import quanti from "quanti"
import canvas, { createCanvas } from "canvas"
// @ts-ignore
import { setup } from "./debug.js"

setup()

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

export async function processImage(path: string) {
  // TODO: Original PNG is in the canvas somehow. Find out why and remove it.
  // TODO: The result is not centered. 
  // Canva setup
  paper.setup(new paper.Size(20, 40))

  // Layer setup
  let layers = new Map<string, paper.Layer>()

  // Read image as canvas element
  let image = new canvas.Image
  image.src = fs.readFileSync(path)

  let canva = new canvas.Canvas(image.width, image.height)
  let ctx = canva.getContext('2d')
  ctx.drawImage(image, 0, 0, image.width, image.height)

  // Put image into paper
  let originalImage = new paper.Raster(canva)
  let originalImageData = originalImage.getImageData(
    new paper.Rectangle(0, 0, originalImage.width, originalImage.height)
  )

  // Quantization
  const palette = quanti(originalImageData.data, 2, 4)
  palette.process(originalImageData.data)

  // Output quantized image
  let quantizedImage = new paper.Raster
  quantizedImage.setImageData(originalImageData)

  // Generate vector rectangles
  for (let y = 0; y < quantizedImage.height; y++) {
    for (let x = 0; x < quantizedImage.width; x++) {
      let color = quantizedImage.getPixel(x, y)
      let rectangle = new paper.Path.Rectangle({
        point: [x, y],
        size: [1, 1]
      })
        rectangle.fillColor = color
      
      // Create layer if not exists
      if ( layers.get(color.toString()) === undefined ) {
        layers.set(color.toString(), new paper.Layer())
      }
      // Add the rectangle to layer with same color as index
      layers.get(color.toString())?.addChild(rectangle)
      }
    }

  // Boolean operation unite all rectangles
  for (let key of layers.keys()) {
    layers.get(key)?.children.reduce(
      (previous, current) => (previous as paper.Path.Rectangle).unite(current as paper.Path.Rectangle)
    )
  }

  console.log(layers.size)

  // Clean up
  originalImage.remove()
  quantizedImage.remove()

  // Export SVG
  for (let layer of layers.values()) { 
    paper.project.addLayer(layer)
  }

  console.log(paper.project.layers.length)
  let svg = paper.project.exportSVG({ asString: true }) as string
  fs.writeFileSync("output.svg", svg)
}
