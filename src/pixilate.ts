import fs from "fs"

import paper from "paper"
import quanti from "quanti"
import Path from "path"
import canvas, { createCanvas } from "canvas"


const PIXEL_BLEED_FOR_BOOL_OP_UNITE = 0
// One banner is 20x40. nanoemoji derives the advance width from the viewBox aspect
// ratio (see exportEmptySVGs), so these two numbers also set the per-glyph advance.
export const BANNER_WIDTH = 20
export const BANNER_HEIGHT = 40
const X_OFFSET = -BANNER_WIDTH

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

export function processImage(path: string, colorNumber: number, detailedColorNumber: number) {
  // Canva setup
  let offset = 0
  let currentCode = Path.basename(path, Path.extname(path)).slice(1, 3)
  if (currentCode === "00") {
    paper.setup(new paper.Size(BANNER_WIDTH, BANNER_HEIGHT))
  }
  else {
    paper.setup(new paper.Size(0, BANNER_HEIGHT))
    offset = X_OFFSET
  }

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
      originalImage.width, 
      originalImage.height
    )
  )

  // Quantization
  const palette = quanti(originalImageData.data, (currentCode === "13" || currentCode === "14") ? detailedColorNumber : colorNumber, 4) // 4 = RGBA
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
        point: [x + offset, y],
        size: [
          1 + PIXEL_BLEED_FOR_BOOL_OP_UNITE, 
          1 + PIXEL_BLEED_FOR_BOOL_OP_UNITE
        ]
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
    // Add merged layer to project
    paper.project.addLayer(
      new paper.Layer(
        layers.get(key)?.children.reduce(
          (previous, current) => {
            let path = (previous as paper.Path.Rectangle).unite(current as paper.Path.Rectangle, { insert: false })
            path.fillColor = previous.fillColor
            return path
          }
        ) as paper.Path
      )
    )
  }

  // Clean up
  originalImage.remove()
  quantizedImage.remove()
  layers.forEach((layer) => layer.remove())

  // Export SVG
  return paper.project.exportSVG({ asString: true }) as string
}

/**
 * Write a glyph with no geometry, `banners` banners wide.
 *
 * nanoemoji sets the advance width to
 *   max(--width, (ascender - descender) * viewBox.w / viewBox.h)
 * and generate_font.sh passes `--width 0`, so with the default 950/-250 metrics a
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