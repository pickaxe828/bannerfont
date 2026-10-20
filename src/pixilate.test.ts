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
