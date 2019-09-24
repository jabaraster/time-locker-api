import * as fs from "fs";
import * as sut from "../src/rekognition";

(async () => {
    try {
        const res = await sut.extractScore(fs.readFileSync("./nogit/invalid.jpg"));
        console.log(res);
    } catch (e) {
        console.log("!!! error !!!");
        console.log(e);
    }
})();