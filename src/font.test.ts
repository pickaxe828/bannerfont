import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"

import { FONT_PATH, SVG_DIR, buildFont, testFont, type Runner } from "./font.ts"

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
      { cmd: "uv", args: ["run", "python", "src/build_font.py", SVG_DIR, FONT_PATH], show: true },
    ])
  })

  it("fails on a non-zero exit", async () => {
    const { run } = fakeRunner(1)

    await assert.rejects(buildFont({ run }), /exit(ed)? (code )?1/)
  })
})

describe("testFont", () => {
  // The font path is relative to the current directory, so each test works in its own.
  const originalCwd = process.cwd()
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bannerfont-font-"))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const writeFont = () => {
    fs.mkdirSync(path.dirname(FONT_PATH), { recursive: true })
    fs.writeFileSync(FONT_PATH, "")
  }

  it("runs only the font tests", async () => {
    const { run, calls } = fakeRunner(0, "OK")
    writeFont()

    const result = await testFont({ run })

    assert.deepEqual(result, { ok: true, output: "OK" })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args, ["run", "python", "-m", "unittest", "discover", "tests"])
    assert.equal(calls[0].cmd, "uv")
  })

  it("reports failing tests with their output instead of throwing", async () => {
    const { run } = fakeRunner(1, "FAILED (failures=1)")
    writeFont()

    const result = await testFont({ run })

    assert.deepEqual(result, { ok: false, output: "FAILED (failures=1)" })
  })

  it("fails without running anything when build/Font.ttf is missing", async () => {
    const { run, calls } = fakeRunner(0)

    await assert.rejects(testFont({ run }), /build\/Font\.ttf/)

    assert.equal(calls.length, 0)
  })
})
