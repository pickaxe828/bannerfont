// The `bannerfont` command line: build, extract, pixilate, font, test and prune.
// Citty parses the arguments, Clack draws the UI. The stages themselves live in extract.ts,
// pixilate.ts and font.ts; this file only resolves options and reports.
// A command ends in "Done" (or its own message) when its body returns, and in "Failed" with a non-zero
// exit code when its body throws or when it is given a flag it does not declare.
import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts"
import { defineCommand, runMain, type ArgsDef, type ParsedArgs } from "citty"

import { DEFAULT_CACHE_DIR, DEFAULT_IMAGES_DIR, DEFAULT_MC_VERSION, runExtract } from "./extract.ts"
import { FONT_PATH, SVG_DIR, buildFont, testFont } from "./font.ts"
import {
  DEFAULT_COLORS,
  DEFAULT_QUALITY,
  QUALITIES,
  QUALITY_PRESETS,
  pixilateSettings,
  parseColors,
  parseQuality,
  resolveValue,
  unknownFlags,
  type Quality,
} from "./options.ts"
import { pixilatePaths } from "./pixilate.ts"
import { prune } from "./prune.ts"

const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)

/** Passes a prompt's answer on, or exits non-zero when the user cancelled it. */
function unlessCancelled<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled")
    process.exit(1)
  }
  return value as Exclude<T, symbol>
}

const askText = (message: string) => async (initial: string) =>
  unlessCancelled(await text({ message, initialValue: initial, defaultValue: initial }))

/** The flag when given; otherwise a prompt on a TTY, or the default elsewhere. */
const flagOrAsk = (flag: string | undefined, message: string, fallback: string) =>
  resolveValue({ flag, interactive: interactive(), ask: askText(message), fallback })

const mcVersion = (flag: string | undefined) => flagOrAsk(flag, "Minecraft version", DEFAULT_MC_VERSION)

/** Which PNG file or folder to trace: the positional arguments, or one prompted for. */
async function pixilateInputs(given: string[]): Promise<string[]> {
  if (given.length > 0) return given
  return [await flagOrAsk(undefined, "PNG file or folder to trace", DEFAULT_IMAGES_DIR)]
}

interface CommandSpec<A extends ArgsDef> {
  name: string
  description: string
  args?: A
  /** Does the work. Throw to fail; return the closing message to replace "Done". */
  run: (args: ParsedArgs<A>) => Promise<string | void>
}

/** A command that shows an intro and an outro, and turns an unknown flag or a thrown error into a failure. */
function stage<A extends ArgsDef>({ name, description, args, run }: CommandSpec<A>) {
  return defineCommand({
    meta: { name, description },
    args,
    run: async (context) => {
      intro(`bannerfont ${name}`)
      try {
        const unknown = unknownFlags(context.args, args)
        if (unknown.length > 0) {
          throw new Error(`Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} (see \`bannerfont ${name} --help\`)`)
        }
        outro((await run(context.args)) ?? "Done")
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err))
        outro("Failed")
        process.exitCode = 1
      }
    },
  })
}

const stringArg = <O extends { alias?: string | string[]; default?: string } = {}>(description: string, options?: O) =>
  ({ type: "string" as const, description, ...options }) as { type: "string"; description: string } & O

const mcVersionArg = {
  "mc-version": stringArg(`Minecraft release to read the textures from (default ${DEFAULT_MC_VERSION})`),
}
const cacheArg = {
  cache: stringArg("Folder for downloaded client jars", { default: DEFAULT_CACHE_DIR }),
}
const colorsArg = {
  quality: stringArg(`Preset for colors per image and for gradients: ${QUALITIES.join(" or ")} (default ${DEFAULT_QUALITY})`, {
    alias: "q",
  }),
  colors: stringArg(`Colors per image, including the transparent layer (default ${DEFAULT_COLORS}); replaces the preset's colors`, {
    alias: ["c", "colours"],
  }),
}

const askQuality = async (initial: Quality) =>
  unlessCancelled(
    await select({
      message: "Quality",
      initialValue: initial,
      options: QUALITIES.map((value) => ({
        value,
        label: value,
        hint: `${QUALITY_PRESETS[value].colors} colors, ${QUALITY_PRESETS[value].gradientColors} for gradients`,
      })),
    }),
  )

/**
 * The colors for the tracing. Both flags are checked before any prompt. A `--quality` flag wins and never
 * prompts; `-c` alone also skips the prompt, because it already says what the user wants.
 */
async function pixilateOptions(args: { quality?: string; colors?: string }) {
  const flag = parseQuality(args.quality)
  if (args.colors !== undefined) parseColors(args.colors)
  const quality = await resolveValue({
    flag: flag ?? (args.colors !== undefined ? DEFAULT_QUALITY : undefined),
    interactive: interactive(),
    ask: askQuality,
    fallback: DEFAULT_QUALITY,
  })
  return pixilateSettings(quality, args.colors)
}

async function extractStage(options: { version: string; output: string; cache: string }) {
  log.step(`Extracting banner PNGs from Minecraft ${options.version} into ${options.output}`)
  const { written, missing } = await runExtract(options)
  const summary = `${written} PNGs written, ${missing} patterns missing`
  if (missing > 0) log.warn(summary)
  else log.success(summary)
}

async function pixilateStage(paths: string[], output: string, settings: { colors: number; gradientColors: number }) {
  log.step(`Tracing ${paths.join(", ")} into SVGs in ${output}`)
  const { written, failed } = await pixilatePaths(paths, { output, ...settings })
  if (failed.length > 0) {
    for (const { path, message } of failed) log.error(`${path}: ${message}`)
    throw new Error(`${failed.length} file(s) failed to pixilate (${written} written)`)
  }
  log.success(`${written} SVGs written`)
}

async function fontStage() {
  log.step(`Compiling ${SVG_DIR}/*.svg into ${FONT_PATH}`)
  await buildFont()
  log.success(`Wrote ${FONT_PATH}`)
}

/** Runs the font tests and shows one line per result. Throws when they fail or when the font is missing. */
async function testStage() {
  log.step("Running the font tests")
  const { ok, results, output } = await testFont()
  const shortName = (id: string) => id.replace(/^tests\.font\./, "")
  for (const { id, status, message, seconds } of results) {
    const line = `${shortName(id)} (${seconds.toFixed(2)}s)`
    if (status === "pass") log.success(line)
    else if (status === "skip") log.warn(`${line}: skipped${message ? `: ${message}` : ""}`)
    else log.error(`${line}: ${status}${message ? `\n${message.trim()}` : ""}`)
  }
  const failed = results.filter((r) => r.status === "fail" || r.status === "error").length
  // No results at all means the runner died before any test ran: show what it printed
  if (!ok) throw new Error(results.length === 0 ? `Font tests failed\n${output.trim()}` : `${failed} font test(s) failed`)
  log.success(`Font tests passed (${results.length} run, ${results.filter((r) => r.status === "skip").length} skipped)`)
}

const extractCommand = stage({
  name: "extract",
  description: "Build the banner PNGs from the Minecraft client jar",
  args: {
    ...mcVersionArg,
    output: stringArg("Where the PNGs go", { alias: "o", default: DEFAULT_IMAGES_DIR }),
    ...cacheArg,
  },
  run: async (args) => {
    const version = await mcVersion(args["mc-version"])
    await extractStage({ version, output: args.output, cache: args.cache })
  },
})

const pixilateCommand = stage({
  name: "pixilate",
  description: "Trace banner PNGs (files or folders) into SVGs",
  args: {
    output: stringArg("Where the SVGs go", { alias: "o", default: SVG_DIR }),
    ...colorsArg,
  },
  run: async (args) => {
    const settings = await pixilateOptions(args)
    await pixilateStage(await pixilateInputs(args._.map(String)), args.output, settings)
  },
})

const fontCommand = stage({
  name: "font",
  description: `Compile ${SVG_DIR}/*.svg into ${FONT_PATH}`,
  run: fontStage,
})

const testCommand = stage({
  name: "test",
  description: `Run the font tests against ${FONT_PATH}`,
  run: testStage,
})

const pruneCommand = stage({
  name: "prune",
  description: `Clear the intermediate SVGs in ${SVG_DIR}`,
  run: async () => {
    prune()
    log.success(`Cleared ${SVG_DIR}`)
  },
})

const buildCommand = stage({
  name: "build",
  description: "Full build: extract, pixilate, font, then the font tests",
  args: { ...mcVersionArg, ...cacheArg, ...colorsArg },
  run: async (args) => {
    const settings = await pixilateOptions(args)
    const version = await mcVersion(args["mc-version"])
    await extractStage({ version, output: DEFAULT_IMAGES_DIR, cache: args.cache })
    await pixilateStage([DEFAULT_IMAGES_DIR], SVG_DIR, settings)
    await fontStage()
    // The font stays on disk when the tests fail, but the build still fails
    await testStage()
    return "Built"
  },
})

const subCommands = {
  build: buildCommand,
  extract: extractCommand,
  pixilate: pixilateCommand,
  font: fontCommand,
  test: testCommand,
  prune: pruneCommand,
}

/** With no command on a TTY, ask which one to run; otherwise citty prints the usage and exits non-zero. */
async function chooseRawArgs(rawArgs: string[]): Promise<string[]> {
  if (rawArgs.length > 0 || !interactive()) return rawArgs
  intro("bannerfont")
  const choice = unlessCancelled(
    await select({
      message: "What do you want to do?",
      options: Object.entries(subCommands).map(([value, cmd]) => ({
        value,
        label: value,
        hint: (cmd.meta as { description: string }).description,
      })),
    }),
  )
  return [choice]
}

const main = defineCommand({
  meta: { name: "bannerfont", description: "Turn Minecraft banner textures into a COLRv1 color font" },
  subCommands,
})

await runMain(main, { rawArgs: await chooseRawArgs(process.argv.slice(2)) })
