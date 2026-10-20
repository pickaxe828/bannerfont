import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { prune } from "./prune.ts"

describe("prune", () => {
  it("empties an existing directory and keeps it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bannerfont-prune-"))
    fs.writeFileSync(path.join(dir, "a.svg"), "x")
    fs.mkdirSync(path.join(dir, "sub"))
    fs.writeFileSync(path.join(dir, "sub", "b.svg"), "x")

    prune(dir)

    assert.deepEqual(fs.readdirSync(dir), [])
  })

  it("creates the directory when it is absent", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bannerfont-prune-")), "out")

    prune(dir)

    assert.ok(fs.statSync(dir).isDirectory())
  })
})
