import fs from "node:fs"

import { SVG_DIR } from "./font.ts"

/** Clears the intermediate SVG directory and recreates it empty. */
export function prune(dir: string = SVG_DIR): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
