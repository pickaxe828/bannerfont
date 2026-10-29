import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { encodePng } from "./png.ts"
import { QUALITY_PRESETS } from "./options.ts"
import { DETAILED_COLORS, pixilatePaths } from "./pixilate.ts"

/** A 20x40 PNG with a red square on a transparent ground. */
function bannerPng(): Uint8Array {
  const pixels = new Uint8Array(20 * 40 * 4)
  for (let y = 5; y < 15; y++) {
    for (let x = 5; x < 15; x++) pixels.set([255, 0, 0, 255], (y * 20 + x) * 4)
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

/** A 20x40 PNG whose 20 columns are 20 distinct grays. */
function gradientPng(): Uint8Array {
  const pixels = new Uint8Array(20 * 40 * 4)
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 20; x++) pixels.set([x * 12, x * 12, x * 12, 255], (y * 20 + x) * 4)
  }
  return encodePng(pixels, 20, 40)
}

const layersOf = (file: string) => (fs.readFileSync(file, "utf8").match(/<g /g) ?? []).length

describe("gradient colors", () => {
  it("standard preset matches DETAILED_COLORS", () => {
    assert.equal(QUALITY_PRESETS.standard.gradientColors, DETAILED_COLORS)
  })

  it("only the gradient patterns (13 and 14) use gradientColors; the others use colors", async () => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "013.png"), gradientPng())
    fs.writeFileSync(path.join(images, "015.png"), gradientPng())

    const result = await pixilatePaths([images], { output: out, colors: 2, gradientColors: 8 })

    assert.deepEqual(result.failed, [])
    assert.ok(layersOf(path.join(out, "ue013.svg")) > layersOf(path.join(out, "ue015.svg")))
  })
})

/** A 20x40 PNG with a red block (columns 5-9) next to a blue block (columns 10-14), blue at the given alpha. */
function neighbourPng(blueAlpha: number): Uint8Array {
  const pixels = new Uint8Array(20 * 40 * 4)
  for (let y = 5; y < 15; y++) {
    for (let x = 5; x < 10; x++) pixels.set([255, 0, 0, 255], (y * 20 + x) * 4)
    for (let x = 10; x < 15; x++) pixels.set([0, 0, 255, blueAlpha], (y * 20 + x) * 4)
  }
  return encodePng(pixels, 20, 40)
}

/** Horizontal extent [min, max] of the path of the group with the given fill. */
function extentOf(file: string, fill: string): [number, number] {
  const svg = fs.readFileSync(file, "utf8")
  const d = svg.match(new RegExp(`fill="${fill}"[^>]*><path d="([^"]*)"`))![1]
  let x = 0
  const xs: number[] = []
  for (const [, command, value] of d.matchAll(/([MhvLz])(-?[\d.]*)(?:,-?[\d.]*)?/g)) {
    if (command === "M") { x = Number(value); xs.push(x) } else if (command === "h") { x += Number(value); xs.push(x) }
  }
  return [Math.min(...xs), Math.max(...xs)]
}

describe("seam overlap", () => {
  const build = async (blueAlpha: number) => {
    const { images, out } = workspace()
    fs.writeFileSync(path.join(images, "000.png"), neighbourPng(blueAlpha))
    const result = await pixilatePaths([images], { output: out, colors: 3 })
    assert.deepEqual(result.failed, [])
    return path.join(out, "ue000.svg")
  }

  it("grows an earlier layer one cell under a later opaque layer", async () => {
    const file = await build(255)
    assert.deepEqual(extentOf(file, "#ff0000"), [5, 11])
    assert.deepEqual(extentOf(file, "#0000ff"), [10, 15])
  })

  it("splits a translucent image into opaque colour layers and nested alpha masks", async () => {
    const svg = fs.readFileSync(await build(128), "utf8")
    const groups = [...svg.matchAll(/<g ([^>]*)>/g)].map((match) => match[1])
    const masks = groups.filter((attributes) => attributes.includes('data-mask="1"'))
    const colours = groups.filter((attributes) => !attributes.includes("data-mask"))
    assert.equal(colours.length, 2)
    assert.ok(colours.every((attributes) => !attributes.includes("fill-opacity")))
    // Levels 128 and 255, so the increments are 128/255 and then 1 (no attribute).
    assert.equal(masks.length, 2)
    assert.ok(masks[0].includes('fill-opacity="0.50196"'))
    assert.ok(!masks[1].includes("fill-opacity"))
  })

  it("keeps the colour layers inside the visible cells, so no renderer shows them unmasked", async () => {
    const file = await build(128)
    assert.deepEqual(extentOf(file, "#ff0000"), [5, 11])
    assert.deepEqual(extentOf(file, "#0000ff"), [10, 15])
  })

  it("writes no mask for an image without translucent pixels", async () => {
    assert.ok(!fs.readFileSync(await build(255), "utf8").includes("data-mask"))
  })
})

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
