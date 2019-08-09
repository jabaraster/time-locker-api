import * as AWS from "aws-sdk";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    const res = await sut.getCharacterAverageScore();
    console.log(res.body);
})();