import fs from "node:fs"

/** Clears the intermediate SVG directory (default ./out) and recreates it empty. */
export function prune(dir: string = "./out"): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
