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

/**
 * Quality presets: how many colors the tracing keeps per image and for the gradient patterns
 * (13 and 14). More colors give a closer picture and a bigger font. `standard` is the original
 * behavior; `gradientColors` must stay equal to `DETAILED_COLORS` in pixilate.ts for it.
 */
export const QUALITY_PRESETS = {
  standard: { colors: DEFAULT_COLORS, gradientColors: 10 },
  // Lossless: the textures have at most 80 opaque colors (525 in the gradients), so these keep every
  // pixel exactly. More colors would give the same font (587 KB), only slower to build.
  high: { colors: 128, gradientColors: 600 },
} as const

export type Quality = keyof typeof QUALITY_PRESETS

export const QUALITIES = Object.keys(QUALITY_PRESETS) as Quality[]

export const DEFAULT_QUALITY: Quality = "standard"

/** Parses `-q/--quality`. Returns undefined when the flag is absent; anything but a preset name is an error. */
export function parseQuality(value: string | undefined): Quality | undefined {
  if (value === undefined) return undefined
  if (!(QUALITIES as string[]).includes(value)) {
    throw new Error(`--quality must be one of ${QUALITIES.join(", ")}, got "${value}"`)
  }
  return value as Quality
}

/** The colors for a preset. An explicit `-c/--colors` replaces the preset's colors but not its gradient colors. */
export function pixilateSettings(quality: Quality, colors?: string | number) {
  const preset = QUALITY_PRESETS[quality]
  return { colors: colors === undefined ? preset.colors : parseColors(colors), gradientColors: preset.gradientColors }
}

/** The flags citty accepts for a command, as declared in its `args`. */
export type DeclaredFlags = Record<string, { type?: string; alias?: string | string[] }>

/** citty treats `mc-version` and `mcVersion` as the same flag, so compare without case and dashes. */
const normalize = (flag: string) => flag.replace(/-/g, "").toLowerCase()

/**
 * Citty keeps flags it does not know in the parsed arguments instead of rejecting them, so
 * `build -o dir` would silently ignore `-o`. Returns the flags (with their dashes) that the
 * command does not declare, in the order they appear.
 */
export function unknownFlags(parsed: Record<string, unknown>, declared: DeclaredFlags = {}): string[] {
  const known = new Set<string>()
  for (const [name, def] of Object.entries(declared)) {
    known.add(normalize(name))
    for (const alias of [def.alias ?? []].flat()) known.add(normalize(alias))
  }
  return Object.keys(parsed)
    .filter((key) => key !== "_" && !known.has(normalize(key)))
    .map((key) => (key.length === 1 ? `-${key}` : `--${key}`))
}
