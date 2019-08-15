import * as AWS from "aws-sdk";
import * as fs from "fs";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    // await sut.sendErrorMail(new Error());
    const res = await sut.getCharacterList();
    console.log(res.body);
})();