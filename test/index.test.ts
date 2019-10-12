import * as fs from "fs";
import * as sut from "../src/rekognition";

(async () => {
    try {
        const ret = await sut.extractScore(fs.readFileSync("nogit/sample.jpg"));
        console.log(ret);
    } catch (e) {
        console.log("!!! error !!!");
        console.log(e);
    }
})();