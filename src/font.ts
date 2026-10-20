// Stage 2: the font stays Python (fontTools has the mature COLRv1 tooling). This module only
// drives it through `uv run`, which resolves the interpreter and the pinned fontTools from
// pyproject.toml and uv.lock. Paths are relative to the current directory: run from the repo root.
import { spawn } from "node:child_process"
import fs from "node:fs"

export const FONT_PATH = "build/Font.ttf"
export const SVG_DIR = "out"

export interface RunResult {
  code: number
  /** stdout and stderr in arrival order. */
  output: string
}

/** Runs a command to completion. With `show`, the child's output is also forwarded to this process. */
export type Runner = (cmd: string, args: string[], options?: { show?: boolean }) => Promise<RunResult>

export const run: Runner = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const collect = (sink: NodeJS.WriteStream) => (chunk: Buffer) => {
      output += chunk.toString()
      if (options?.show) sink.write(chunk)
    }
    child.stdout.on("data", collect(process.stdout))
    child.stderr.on("data", collect(process.stderr))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, output }))
  })

export interface BuildFontOptions {
  run?: Runner
}

/** Compiles `SVG_DIR/*.svg` into the font. The child's output (stderr included) is shown; a non-zero exit throws. */
export async function buildFont({ run: runner = run }: BuildFontOptions = {}): Promise<void> {
  const { code } = await runner("uv", ["run", "python", "src/build_font.py", SVG_DIR, FONT_PATH], { show: true })
  if (code !== 0) throw new Error(`The font build failed (exit code ${code})`)
}

export interface TestFontOptions {
  run?: Runner
}

/** One line of `tests/font/run.py`'s JSON-lines output. */
export interface FontTestResult {
  id: string
  status: "pass" | "fail" | "error" | "skip"
  message: string
  seconds: number
}

export interface TestFontResult {
  ok: boolean
  results: FontTestResult[]
  /** The runner's whole output, for when `results` does not explain a failure (a crash before any test ran). */
  output: string
}

/** The JSON lines of the runner's output; its human summary and any warnings are not JSON and are skipped. */
function parseResults(output: string): FontTestResult[] {
  const results: FontTestResult[] = []
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) continue
    try {
      results.push(JSON.parse(line) as FontTestResult)
    } catch {
      // not a result line
    }
  }
  return results
}

/**
 * Runs only the real-font suite (tests/font/run.py, which prints one JSON object per test) against
 * the built font. Throws when build/Font.ttf is missing; failing tests are a result, not an exception.
 */
export async function testFont(options: TestFontOptions = {}): Promise<TestFontResult> {
  const { run: runner = run } = options
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`${FONT_PATH} is missing; run \`bannerfont build\` or \`bannerfont font\` first`)
  }
  const { code, output } = await runner("uv", ["run", "python", "tests/font/run.py"])
  return { ok: code === 0, results: parseResults(output), output }
}
