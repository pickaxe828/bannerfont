// Pure option resolution for the CLI: flag, prompt or default.

export interface ResolveOptions<T> {
  /** The value given on the command line, if any. */
  flag: T | undefined
  /** True when stdin and stdout are a TTY, so a prompt can be answered. */
  interactive: boolean
  /** Asks the user; receives the default as the initial value. */
  ask: (initial: T) => Promise<T>
  fallback: T
}

/**
 * A flag always wins and never prompts. Without a flag, a TTY gets a prompt and anything else
 * gets the default.
 */
export async function resolveValue<T>({ flag, interactive, ask, fallback }: ResolveOptions<T>): Promise<T> {
  if (flag !== undefined) return flag
  return interactive ? ask(fallback) : fallback
}

/** Default number of colours per image, including the transparent layer. */
export const DEFAULT_COLORS = 3

/** Parses `-c/--colors`; the default is 3. Anything but a positive integer is an error. */
export function parseColors(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_COLORS
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--colors must be a positive integer, got "${value}"`)
  }
  return n
}
