import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { FONT_PATH, buildFont, testFont, type Runner } from "./font.ts"

/** A runner that records its calls and answers with `code`. */
function fakeRunner(code: number, output = "") {
  const calls: { cmd: string; args: string[]; show: boolean | undefined }[] = []
  const run: Runner = async (cmd, args, options) => {
    calls.push({ cmd, args, show: options?.show })
    return { code, output }
  }
  return { run, calls }
}

describe("buildFont", () => {
  it("compiles out/ into build/Font.ttf with uv and shows the child's output", async () => {
    const { run, calls } = fakeRunner(0)

    await buildFont({ run })

    assert.deepEqual(calls, [
      { cmd: "uv", args: ["run", "python", "src/build_font.py", "out", FONT_PATH], show: true },
    ])
  })

  it("passes a custom SVG directory and destination", async () => {
    const { run, calls } = fakeRunner(0)

    await buildFont({ run, svgDir: "svgs", dest: "x/Font.ttf" })

    assert.deepEqual(calls[0].args, ["run", "python", "src/build_font.py", "svgs", "x/Font.ttf"])
  })

  it("fails on a non-zero exit", async () => {
    const { run } = fakeRunner(1)

    await assert.rejects(buildFont({ run }), /exit(ed)? (code )?1/)
  })
})

describe("testFont", () => {
  it("runs only the font tests", async () => {
    const { run, calls } = fakeRunner(0, "OK")

    const result = await testFont({ run, exists: () => true })

    assert.deepEqual(result, { ok: true, output: "OK" })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args, ["run", "python", "-m", "unittest", "discover", "tests"])
    assert.equal(calls[0].cmd, "uv")
  })

  it("reports failing tests with their output instead of throwing", async () => {
    const { run } = fakeRunner(1, "FAILED (failures=1)")

    const result = await testFont({ run, exists: () => true })

    assert.deepEqual(result, { ok: false, output: "FAILED (failures=1)" })
  })

  it("fails without running anything when build/Font.ttf is missing", async () => {
    const { run, calls } = fakeRunner(0)
    const checked: string[] = []

    await assert.rejects(
      testFont({ run, exists: (p) => { checked.push(p); return false } }),
      /build\/Font\.ttf/,
    )

    assert.deepEqual(checked, [FONT_PATH])
    assert.equal(calls.length, 0)
  })
})
