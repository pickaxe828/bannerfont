import paper from "paper"
import fs from "fs"
import Jimp form "jimp"

console.log(process.argv[2])

var size = new paper.Size(300, 300)
paper.setup(size);

var path = new paper.Path();
path.strokeColor = '#348BF0';

var start = new paper.Point(100, 100);
var end = new paper.Point(200, 200);

path.moveTo(start);
path.lineTo(end);

console.log('width', path.bounds.width, 'height', path.bounds.height);

var svg = paper.project.exportSVG({asString:true});
fs.writeFileSync('punchline.svg', svg);