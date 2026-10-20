#!/usr/bin/env node
// Nothing is compiled: tsx runs the TypeScript sources directly.
import { register } from "tsx/esm/api"

register()
await import("../src/cli.ts")
