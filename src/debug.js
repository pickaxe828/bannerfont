export function setup() {
    Object.prototype.tap = function (level = "debug") { return console[level](this), this }
}