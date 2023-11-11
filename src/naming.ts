import fs from "fs"

const PUA_SPECIAL_CHAR = "EFFF"

const mapping = JSON.parse(
    fs.readFileSync("./src/mappings.json").toString()
)

// "ABC" -> "62_63_64"
export function charCode(str: string, suffix: string) {
    return [...str]
        .map((char) => char.charCodeAt(0).toString(16) + suffix)
        .reduce((previous, current) => previous + current)
}

export function getName(code: string) {
    console.log(mapping["layer_code"][Number(code.slice(1))] as string)
    let result =
        "u" +
        charCode(mapping["layer_code"][Number(code.slice(1))] as string, "_") +
        charCode(parseInt(code.charAt(0), 16).toString(10), "_") +
        PUA_SPECIAL_CHAR
    return result
}

export function getName_King(code: string) {
    return "u" + "e" + code
}