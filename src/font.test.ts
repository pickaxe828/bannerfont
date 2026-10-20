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

  const line = (id: string, status: string, message = "") =>
    JSON.stringify({ id, status, message, seconds: 0.01 })

  it("runs the real-font suite through its JSON-lines runner", async () => {
    const { run, calls } = fakeRunner(0)
    writeFont()

    await testFont({ run })

    assert.deepEqual(calls, [{ cmd: "uv", args: ["run", "python", "tests/font/run.py"], show: undefined }])
  })

  it("returns one result per JSON line and skips the lines that are not JSON", async () => {
    const output = [
      line("tests.font.test_metrics.A.test_one", "pass"),
      "tests/font: 2 pass",
      line("tests.font.test_render.B.test_two", "skip", "no hb-view"),
    ].join("\n")
    const { run } = fakeRunner(0, output)
    writeFont()

    const result = await testFont({ run })

    assert.equal(result.ok, true)
    assert.deepEqual(
      result.results.map(({ id, status, message }) => ({ id, status, message })),
      [
        { id: "tests.font.test_metrics.A.test_one", status: "pass", message: "" },
        { id: "tests.font.test_render.B.test_two", status: "skip", message: "no hb-view" },
      ],
    )
  })

  it("reports failing tests with their results instead of throwing", async () => {
    const output = line("tests.font.test_colr.C.test_bad", "fail", "AssertionError: boom")
    const { run } = fakeRunner(1, output)
    writeFont()

    const result = await testFont({ run })

    assert.equal(result.ok, false)
    assert.equal(result.results[0].status, "fail")
    assert.equal(result.results[0].message, "AssertionError: boom")
  })

  it("fails without running anything when build/Font.ttf is missing", async () => {
    const { run, calls } = fakeRunner(0)

    await assert.rejects(testFont({ run }), /build\/Font\.ttf/)

    assert.equal(calls.length, 0)
  })
})
