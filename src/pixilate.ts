import paper from "paper"
import fs from "fs"
import Jimp from "jimp"

let args = process.argv.slice(2)

if (args.length === 0) { throw new Error("No image path provided") }

function sliceInteger(integer: number, start: number, length: number) {
  return (integer >> start) & ((1 << length) - 1)
}

function processImage(path: string) {
  // Canva setup
  let size = new paper.Size(100, 200)
  paper.setup(size)

  // Loop over pixels
  Jimp.read(
    path, (err, image) => {
      if (err) throw err

      for (let y = 0; y < image.bitmap.width; y++) {
        for (let x = 0; x < image.bitmap.width; x++) {
          image.getPixelColor(x, y, (err, value) => {
            let rect = new paper.Path.Rectangle({
              point: [x, y],
              size: [1, 1]
            })
            rect.fillColor = new paper.Color(
              sliceInteger(value, 6 * 4, 2 * 4),
              sliceInteger(value, 4 * 4, 2 * 4),
              sliceInteger(value, 2 * 4, 2 * 4),
              sliceInteger(value, 0 * 4, 2 * 4)
            )
            paper.project.addLayer(new paper.Layer()).addChild(rect)
          })
        }
      }
      // Must export here, before leaving the scope
      console.log(paper.project.layers.length)
      let svg = paper.project.exportSVG({ asString: true }) as string
      fs.writeFileSync("output.svg", svg)
    }
  )

}

processImage(args[0])