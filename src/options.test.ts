import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { QUALITY_PRESETS, parseColors, parseQuality, pixilateSettings, resolveValue, unknownFlags } from "./options.ts"

describe("resolveValue", () => {
  it("a flag wins and never prompts", async () => {
    let asked = false
    const value = await resolveValue({
      flag: "1.20.4",
      interactive: true,
      ask: async () => { asked = true; return "x" },
      fallback: "1.21.2",
    })
    assert.equal(value, "1.20.4")
    assert.equal(asked, false)
  })

  it("prompts on a TTY when the value is missing", async () => {
    const value = await resolveValue({
      flag: undefined,
      interactive: true,
      ask: async (initial) => `asked:${initial}`,
      fallback: "1.21.2",
    })
    assert.equal(value, "asked:1.21.2")
  })

  it("applies the default without a TTY and never prompts", async () => {
    let asked = false
    const value = await resolveValue({
      flag: undefined,
      interactive: false,
      ask: async () => { asked = true; return "x" },
      fallback: "1.21.2",
    })
    assert.equal(value, "1.21.2")
    assert.equal(asked, false)
  })

  it("an empty flag string is still a flag", async () => {
    const value = await resolveValue({ flag: "", interactive: true, ask: async () => "x", fallback: "d" })
    assert.equal(value, "")
  })
})

describe("parseColors", () => {
  it("defaults to 3 including the transparent layer", () => {
    assert.equal(parseColors(undefined), 3)
  })

  it("accepts a number or a numeric string", () => {
    assert.equal(parseColors(5), 5)
    assert.equal(parseColors("4"), 4)
  })

  it("rejects values that are not a positive integer", () => {
    for (const bad of ["abc", "0", "-2", "2.5", 0]) {
      assert.throws(() => parseColors(bad), /--colors/)
    }
  })
})

describe("parseQuality", () => {
  it("returns undefined without a flag", () => {
    assert.equal(parseQuality(undefined), undefined)
  })

  it("accepts every preset name", () => {
    assert.equal(parseQuality("standard"), "standard")
    assert.equal(parseQuality("high"), "high")
  })

  it("rejects anything else", () => {
    for (const bad of ["", "ultra", "High"]) {
      assert.throws(() => parseQuality(bad), /--quality/)
    }
  })
})

describe("pixilateSettings", () => {
  it("standard keeps the original 3 colors and 10 gradient colors", () => {
    assert.deepEqual(pixilateSettings("standard"), { colors: 3, gradientColors: 10 })
  })

  it("high keeps more colors than standard", () => {
    const high = pixilateSettings("high")
    assert.ok(high.colors > QUALITY_PRESETS.standard.colors)
    assert.ok(high.gradientColors > QUALITY_PRESETS.standard.gradientColors)
  })

  it("an explicit colors value replaces the colors but not the gradient colors", () => {
    assert.deepEqual(pixilateSettings("high", "5"), { colors: 5, gradientColors: QUALITY_PRESETS.high.gradientColors })
  })

  it("rejects an invalid colors value", () => {
    assert.throws(() => pixilateSettings("high", "0"), /--colors/)
  })
})

describe("unknownFlags", () => {
  const declared = {
    "mc-version": { type: "string" },
    colors: { type: "string", alias: ["c", "colours"] },
    output: { type: "string", alias: "o" },
  }

  it("accepts declared flags, their aliases and their camelCase form", () => {
    const args = { _: [], "mc-version": "1", mcVersion: "1", c: "3", colors: "3", colours: "3", o: "x", output: "x" }
    assert.deepEqual(unknownFlags(args, declared), [])
  })

  it("ignores the positional arguments", () => {
    assert.deepEqual(unknownFlags({ _: ["images/"] }, declared), [])
  })

  it("lists every undeclared flag with its dashes", () => {
    assert.deepEqual(unknownFlags({ _: [], o: "x", verbose: true, z: true }, { colors: declared.colors }), [
      "-o",
      "--verbose",
      "-z",
    ])
  })

  it("rejects every flag of a command that declares none", () => {
    assert.deepEqual(unknownFlags({ _: [], output: "x" }, undefined), ["--output"])
  })
})
