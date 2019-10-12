"use strict";

const Jimp = require("jimp");
const fs = require("fs");

(async () => {
  const ret = await Jimp.read(fs.readFileSync("nogit/sample.jpg"));
  ret.crop(20, 190, 340, 200).write("nogit/clipped.jpg");
})();