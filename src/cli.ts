// The `bannerfont` command line: build, extract, pixilate, font, test and prune.
// Citty parses the arguments, Clack draws the UI. The stages themselves live in extract.ts,
// pixilate.ts and font.ts; this file only resolves options and reports.
import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts"
import { defineCommand, runMain } from "citty"

import { DEFAULT_CACHE_DIR, DEFAULT_IMAGES_DIR, DEFAULT_MC_VERSION, runExtract } from "./extract.ts"
import { FONT_PATH, SVG_DIR, buildFont, testFont } from "./font.ts"
import { DEFAULT_COLORS, parseColors, resolveValue } from "./options.ts"
import { pixilatePaths } from "./pixilate.ts"
import { prune } from "./prune.ts"

const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)

/** Fails the process after a cancelled prompt. */
function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled")
    process.exit(1)
  }
  return value as Exclude<T, symbol>
}

const askText = (message: string) => async (initial: string) =>
  answer(await text({ message, initialValue: initial, defaultValue: initial }))

const mcVersion = (flag: string | undefined) =>
  resolveValue({ flag, interactive: interactive(), ask: askText("Minecraft version"), fallback: DEFAULT_MC_VERSION })

/** Runs a command body: any thrown error is shown and sets a non-zero exit code. */
function command(title: string, body: () => Promise<void>) {
  return async () => {
    intro(`bannerfont ${title}`)
    try {
      await body()
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      outro("Failed")
      process.exitCode = 1
    }
  }
}

const str = (description: string, alias?: string | string[]) => ({ type: "string" as const, description, alias })

const mcVersionArg = {
  "mc-version": str(`Minecraft release to read the textures from (default ${DEFAULT_MC_VERSION})`),
}
const cacheArg = {
  cache: str(`Folder for downloaded client jars (default ${DEFAULT_CACHE_DIR})`),
}
const colorsArg = {
  colors: str(`Colours per image, including the transparent layer (default ${DEFAULT_COLORS})`, ["c", "colours"]),
}

async function extractStage(options: { version: string; output: string; cache: string }) {
  log.step(`Extracting banner PNGs from Minecraft ${options.version} into ${options.output}`)
  const { written, missing } = await runExtract(options)
  const summary = `${written} PNGs written, ${missing} patterns missing`
  if (missing > 0) log.warn(summary)
  else log.success(summary)
}

async function pixilateStage(paths: string[], output: string, colors: number) {
  log.step(`Tracing ${paths.join(", ")} into SVGs in ${output}`)
  const { written, failed } = await pixilatePaths(paths, { output, colors })
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

/** Runs the font tests. Returns false when they fail; throws when the font is missing. */
async function testStage(): Promise<boolean> {
  log.step("Running the font tests")
  const { ok, output } = await testFont()
  if (ok) {
    log.message(output.trim())
    log.success("Font tests passed")
  } else {
    log.error(`Font tests failed\n${output.trim()}`)
  }
  return ok
}

const extract = defineCommand({
  meta: { name: "extract", description: "Build the banner PNGs from the Minecraft client jar" },
  args: {
    ...mcVersionArg,
    output: str(`Where the PNGs go (default ${DEFAULT_IMAGES_DIR})`, "o"),
    ...cacheArg,
  },
  run: ({ args }) =>
    command("extract", async () => {
      const version = await mcVersion(args["mc-version"])
      await extractStage({ version, output: args.output ?? DEFAULT_IMAGES_DIR, cache: args.cache ?? DEFAULT_CACHE_DIR })
      outro("Done")
    })(),
})

const pixilate = defineCommand({
  meta: { name: "pixilate", description: "Trace banner PNGs (files or folders) into SVGs" },
  args: {
    output: str(`Where the SVGs go (default ./${SVG_DIR})`, "o"),
    ...colorsArg,
  },
  run: ({ args }) =>
    command("pixilate", async () => {
      const colors = parseColors(args.colors)
      const given = args._.map(String)
      const paths =
        given.length > 0
          ? given
          : [
              await resolveValue<string>({
                flag: undefined,
                interactive: interactive(),
                ask: askText("PNG file or folder to trace"),
                fallback: DEFAULT_IMAGES_DIR,
              }),
            ]
      await pixilateStage(paths, args.output ?? `./${SVG_DIR}`, colors)
      outro("Done")
    })(),
})

const font = defineCommand({
  meta: { name: "font", description: `Compile ${SVG_DIR}/*.svg into ${FONT_PATH}` },
  run: command("font", async () => {
    await fontStage()
    outro("Done")
  }),
})

const test = defineCommand({
  meta: { name: "test", description: `Run the font tests against ${FONT_PATH}` },
  run: command("test", async () => {
    if (!(await testStage())) {
      outro("Failed")
      process.exitCode = 1
      return
    }
    outro("Done")
  }),
})

const prune_ = defineCommand({
  meta: { name: "prune", description: `Clear the intermediate SVGs in ${SVG_DIR}` },
  run: command("prune", async () => {
    prune(`./${SVG_DIR}`)
    log.success(`Cleared ./${SVG_DIR}`)
    outro("Done")
  }),
})

const build = defineCommand({
  meta: { name: "build", description: "Full build: extract, pixilate, font, then the font tests" },
  args: { ...mcVersionArg, ...cacheArg, ...colorsArg },
  run: ({ args }) =>
    command("build", async () => {
      const colors = parseColors(args.colors)
      const version = await mcVersion(args["mc-version"])
      await extractStage({ version, output: DEFAULT_IMAGES_DIR, cache: args.cache ?? DEFAULT_CACHE_DIR })
      await pixilateStage([DEFAULT_IMAGES_DIR], `./${SVG_DIR}`, colors)
      await fontStage()
      // The font stays on disk when the tests fail, but the build still fails
      if (!(await testStage())) {
        outro(`Failed (${FONT_PATH} was kept)`)
        process.exitCode = 1
        return
      }
      outro("Built")
    })(),
})

const subCommands = { build, extract, pixilate, font, test, prune: prune_ }

export const main = defineCommand({
  meta: { name: "bannerfont", description: "Turn Minecraft banner textures into a COLRv1 colour font" },
  subCommands,
})

/** With no command on a TTY, ask which one to run; otherwise citty prints the usage and exits non-zero. */
async function chooseRawArgs(rawArgs: string[]): Promise<string[]> {
  if (rawArgs.length > 0 || !interactive()) return rawArgs
  intro("bannerfont")
  const choice = answer(
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

await runMain(main, { rawArgs: await chooseRawArgs(process.argv.slice(2)) })
