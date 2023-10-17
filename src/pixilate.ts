import fs from "fs"
import paper from "paper"
import Jimp from "jimp"

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

export async function processImage(path: string) {
  // Canva setup
  paper.setup(new paper.Size(100, 200))

  // Layer setup
  let layers = new Map<string, paper.Layer>();

  // Loop over pixels
  let image = await Jimp.read(path)

  for (let y = 0; y < image.bitmap.height; y++) {
    for (let x = 0; x < image.bitmap.width; x++) {
      image.getPixelColor(x, y, (err, value) => {
        let rect = new paper.Path.Rectangle({
          point: [x, y],
          size: [1, 1]
        })
        rect.fillColor = new paper.Color(
          // Hexadecimal, hence 4 bits per channel
          sliceInteger(value, 6 * 4, 2 * 4),
          sliceInteger(value, 4 * 4, 2 * 4),
          sliceInteger(value, 2 * 4, 2 * 4),
          sliceInteger(value, 0 * 4, 2 * 4)
        )
        
        // Add layer if not exists
        if ( layers.get(value.toString()) === undefined ) {
          layers.set(value.toString(), new paper.Layer())
        }

        // Add rectangle to layer
        layers.get(value.toString())?.addChild(rect)
      })
    }
  }

  // Boolean operation unite all rectangles
  for (let key of layers.keys()) {
    layers.get(key)?.children.reduce(
      (previous, current) => (previous as paper.Path.Rectangle).unite(current as paper.Path.Rectangle)
    )
  }

  console.log(layers.size)

  // Export SVG
  for (let layer of layers.values()) { 
    paper.project.addLayer(layer)
  }

  console.log(paper.project.layers.length)
  let svg = paper.project.exportSVG({ asString: true }) as string
  fs.writeFileSync("output.svg", svg)
}
