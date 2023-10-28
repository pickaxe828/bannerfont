import fs from "fs"
import { stringify } from "querystring"

const PUA_SPECIAL_CHAR = "EFFF"

const mapping = JSON.parse(
    fs.readFileSync("./src/mappings.json").toString()
)

export function charCode(str: string, suffix: string) {
    return [...str]
        .map((char) => char.charCodeAt(0).toString(16) + suffix)
        .reduce((previous, current) => previous + current)
}

export function getName(code: string) {
    let result =
        "u" +
        charCode(mapping["layer_code"][Number(code.slice(1))] as string, "_") +
        charCode(parseInt(code.charAt(0), 16).toString(10), "_") +
        PUA_SPECIAL_CHAR
    return result
}