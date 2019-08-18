import * as AWS from "aws-sdk";
import * as fs from "fs";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    const res = await sut.queryCharacterScoreRanking("MUCUS");
    res.forEach((r) => {
        console.log("----------");
        console.log(r.mode + ":" + r.score);
        console.log(r.armaments);
    });
})();