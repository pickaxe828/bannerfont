import fs from "fs"

import paper from "paper"
import quanti from "quanti"
import canvas, { createCanvas } from "canvas"

const PIXEL_BLEED_FOR_BOOL_OP_UNITE = 0 // Unused

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

export async function processImage(path: string, colorNumber: number) {
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
    new paper.Rectangle(0, 0, 
      originalImage.width  + PIXEL_BLEED_FOR_BOOL_OP_UNITE, 
      originalImage.height + PIXEL_BLEED_FOR_BOOL_OP_UNITE
    )
  )

  // Quantization
  const palette = quanti(originalImageData.data, colorNumber, 4)
  palette.process(originalImageData.data)

  // Output quantized image
  let quantizedImage = new paper.Raster
  quantizedImage.setImageData(originalImageData)

  // Generate vector rectangles
  for (let y = 0; y < quantizedImage.height; y++) {
    for (let x = 0; x < quantizedImage.width; x++) {
      // Get color of the pixel
      let color = quantizedImage.getPixel(x, y)

      // Skip transparent pixels
      if (color.alpha === 0) { continue }
      
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

  // Clean up
  originalImage.remove()
  quantizedImage.remove()

  // Export SVG
  for (let layer of layers.values()) { 
    paper.project.addLayer(layer)
  }

  return paper.project.exportSVG({ asString: true }) as string
}
