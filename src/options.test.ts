import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseColors, resolveValue, unknownFlags } from "./options.ts"

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
