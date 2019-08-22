import * as AWS from "aws-sdk";
import * as fs from "fs";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    const res = await sut.getTotalPlayState();
    console.log(res.body);
})();