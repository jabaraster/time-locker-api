import * as AWS from "aws-sdk";
import * as fs from "fs";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    const res = await sut.getCharacterSummary(JSON.parse(fs.readFileSync("./test/event.json", "UTF-8")));
    console.log(res.body);
})();