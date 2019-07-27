import * as AWS from "aws-sdk";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    try {
        const objs = await s3.listObjects({
            Bucket: "time-locker-analyzer-playresultbucket-t2ke5sj5sed",
        }).promise();
        await core(objs.Contents!, 0);
    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }
})();

async function core(objs: AWS.S3.Object[], index: number): Promise<void> {
    if (index >= objs.length) {
        return;
    }
    const obj = objs[index];

    console.log(obj.Key);
    try {
        const c = await s3.getObject({
            Bucket: "time-locker-analyzer-playresultbucket-t2ke5sj5sed",
            Key: obj.Key!,
        }, (err, data) => { }).promise();
        const playResult: sut.IPlayResult = JSON.parse(c.Body!.toString("UTF-8"));

        playResult.character = sut.extractCharacter(playResult.title);
        console.log(playResult.character);

        await s3.putObject({
            Bucket: "time-locker-analyzer-playresultbucket-t2ke5sj5sed",
            Key: obj.Key!,
            Body: JSON.stringify(playResult),
        }).promise();
    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }

    setTimeout(async () => {
        await core(objs, index + 1);
    }, 0);
}