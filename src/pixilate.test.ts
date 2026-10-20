import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { encodePng } from "./png.ts"
import { pixilatePaths } from "./pixilate.ts"

/** A 20x40 PNG with a red square on a transparent ground. */
function bannerPng(): Uint8Array {
  const pixels = new Uint8Array(20 * 40 * 4)
  for (let y = 5; y < 15; y++) {
    for (let x = 5; x < 15; x++) pixels.set([255, 0, 0, 255], (y * 20 + x) * 4)
  }
  return encodePng(pixels, 20, 40)
}

/** A 20x40 PNG of a noisy gray texture whose alpha falls from 255 at the top to 0 at the bottom, like pattern 13. */
function rampPng(): Uint8Array {
  const pixels = new Uint8Array(20 * 40 * 4)
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 20; x++) {
      const gray = 200 + ((x * 7 + y * 3) % 40)
      pixels.set([gray, gray, gray, Math.round(255 * (1 - y / 39))], (y * 20 + x) * 4)
    }
  }
  return encodePng(pixels, 20, 40)
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bannerfont-pixilate-"))
  const images = path.join(root, "images")
  const out = path.join(root, "out")
  fs.mkdirSync(images)
  return { root, images, out }
}

describe("pixilatePaths", () => {
  it("writes one SVG per PNG of a directory, plus the geometry-free glyphs", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "000.png"), bannerPng())
    fs.writeFileSync(path.join(images, "a21.png"), bannerPng())

    const result = await pixilatePaths([images], { output: out, colors: 3 })

    assert.deepEqual(result.failed, [])
    assert.equal(result.written, 2)
    assert.ok(fs.existsSync(path.join(out, "ue000.svg")))
    assert.ok(fs.existsSync(path.join(out, "uea21.svg")))
    for (const glyph of ["ucfff7", "uf000", "uf07f", "ue00c", "ue00a", "ue01f"]) {
      assert.ok(fs.existsSync(path.join(out, `${glyph}.svg`)), `${glyph}.svg`)
    }
  })

  it("reports a failing file, keeps going and still exports the empty glyphs", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "000.png"), bannerPng())
    fs.writeFileSync(path.join(images, "101.png"), "this is not a png")

    const result = await pixilatePaths([images], { output: out, colors: 3 })

    assert.equal(result.written, 1)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].path, path.join(images, "101.png"))
    assert.ok(result.failed[0].message.length > 0)
    assert.ok(fs.existsSync(path.join(out, "ue000.svg")))
    assert.ok(fs.existsSync(path.join(out, "ucfff7.svg")))
  })

  it("ignores files in a directory that are not PNGs", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "000.png"), bannerPng())
    fs.writeFileSync(path.join(images, ".DS_Store"), "junk")

    const result = await pixilatePaths([images], { output: out, colors: 3 })

    assert.deepEqual(result.failed, [])
    assert.equal(result.written, 1)
  })

  it("reports a path that does not exist", async () => {
    const { root, out } = workspace()
    const missing = path.join(root, "nope")

    const result = await pixilatePaths([missing], { output: out, colors: 3 })

    assert.equal(result.written, 0)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].path, missing)
    assert.match(result.failed[0].message, /not found/)
  })

  it("converts a single file without exporting the empty glyphs", async () => {
    const { images, out } = workspace()
    const file = path.join(images, "f42.png")
    fs.writeFileSync(file, bannerPng())

    const result = await pixilatePaths([file], { output: out, colors: 3 })

    assert.deepEqual(result.failed, [])
    assert.equal(result.written, 1)
    assert.ok(fs.existsSync(path.join(out, "uef42.svg")))
    assert.equal(fs.existsSync(path.join(out, "ucfff7.svg")), false)
  })

  it("waits for every path of several arguments", async () => {
    const { images, out } = workspace()
    const a = path.join(images, "000.png")
    const b = path.join(images, "001.png")
    fs.writeFileSync(a, bannerPng())
    fs.writeFileSync(b, bannerPng())

    const result = await pixilatePaths([a, b], { output: out, colors: 3 })

    assert.equal(result.written, 2)
    assert.ok(fs.existsSync(path.join(out, "ue000.svg")))
    assert.ok(fs.existsSync(path.join(out, "ue001.svg")))
  })
})

describe("ramp patterns", () => {
  it("draw 13 and 14 as color classes under one alpha gradient, with a flat twin", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "013.png"), rampPng())

    const result = await pixilatePaths([images], { output: out, colors: 3 })

    assert.deepEqual(result.failed, [])
    const svg = fs.readFileSync(path.join(out, "ue013.svg"), "utf8")
    // The overlay is shifted one banner left, so the gradient line sits at x = -20, and it runs
    // from the first row's center to the last row's.
    assert.match(svg, /<linearGradient id="r0" gradientUnits="userSpaceOnUse" x1="-20" y1="0.5" x2="-20" y2="39.5">/)
    assert.match(svg, /fill="url\(#r0\)"/)
    // The ramp is fitted from the rows: opaque at the top, almost clear at the bottom.
    const opacities = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].slice(0, 2).map((m) => Number(m[1]))
    assert.ok(opacities[0] > 0.99, `first stop ${opacities[0]}`)
    assert.ok(opacities[1] < 0.1, `last stop ${opacities[1]}`)
    const flat = fs.readFileSync(path.join(out, "ue013.flat.svg"), "utf8")
    assert.doesNotMatch(flat, /linearGradient/)
    assert.match(flat, /fill-opacity=/)
  })

  it("write no flat twin for any other pattern", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "012.png"), bannerPng())

    await pixilatePaths([images], { output: out, colors: 3 })

    assert.ok(fs.existsSync(path.join(out, "ue012.svg")))
    assert.equal(fs.existsSync(path.join(out, "ue012.flat.svg")), false)
  })
})
