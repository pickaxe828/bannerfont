import { charCode, getName } from "./naming.ts";

let result = getName("a21")

console.log(result)
console.log(result
    .replace("u", "")
    .split("_")
    .map(str => String.fromCodePoint(parseInt(str, 16)))
    .reduce((prev, curr) => 
        prev + 
        String.fromCodePoint(0x200d) + // Zero-width-joiner to use CCMP
        curr) 
)