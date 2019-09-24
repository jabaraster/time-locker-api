import { Rekognition } from "aws-sdk";
import { TextDetection } from "aws-sdk/clients/rekognition";
import { GameMode } from "./types";

const rekognition = new Rekognition({
    region: "ap-northeast-1",
});

export interface TimeLockerScore {
    score: number;
    mode: GameMode;
}

export interface TimeLockerArmament {
    twinShot: number;
    wideShot: number;
    sideShot: number;
    homingShot: number;
    rocket: number;
    beam: number;
    mineBot: number;
    iceCanon: number;
    missile: number;
    line: number;
    guardBit: number;
    supporter: number;
}

export async function extractScore(image: Buffer): Promise<TimeLockerScore> {
    const res = await rekognition.detectText({
        Image: {
            Bytes: image,
        },
    }).promise();

    const hard = res.TextDetections!.some((detection) => detection.DetectedText === "HARD");
    return {
        score: extractScoreCore(res),
        mode: hard ? GameMode.Hard : GameMode.Normal,
    };
}

function extractScoreCore(res: Rekognition.Types.DetectTextResponse): number {
    const tds = res.TextDetections!;
    let ret = 0;
    ret = parseInt(tds[2].DetectedText!, 10);
    if (!isNaN(ret)) {
        return ret;
    }
    ret = parseInt(tds[1].DetectedText!, 10);
    return ret;
}

export interface IExtractArmamentsLevelResponse {
    plainResult: AWS.Rekognition.TextDetectionList;
    processedResult: AWS.Rekognition.TextDetectionList;
}

export async function extractArmamentsLevel(image: Buffer): Promise<IExtractArmamentsLevelResponse> {
    const res = await rekognition.detectText({
        Image: {
            Bytes: image,
        },
    }).promise();

    // ノイズを排除した後に重複を排除.
    // 重複排除の戦略は以下の通り.
    // ・同じ位置の情報とみなせるオブジェクトをグルーピングし、グループ内で最も高い確信度のものを採用する.
    const groups: TextDetection[][] = [];
    res.TextDetections!.filter((t: TextDetection) => {
        return t.DetectedText !== "C" && t.DetectedText !== "c" /*&& t.Confidence! > 50*/;
    }).forEach((t: TextDetection) => {
        const group = groups.find((grp) => {
            const box = t.Geometry!.BoundingBox!;
            const boxInGroup = grp[0].Geometry!.BoundingBox!;
            const leftDev = boxInGroup.Left! - box.Left!;
            const topDev = boxInGroup.Top! - box.Top!;
            return Math.abs(leftDev) < 0.01 && Math.abs(topDev) < 0.01;
        });
        if (group) {
            group.push(t);
        } else {
            groups.push([t]);
        }
    });
    const processed = groups.map((group: TextDetection[]) => {
        group.sort((t0, t1) => {
            return t1.Confidence! - t0.Confidence!;
        });
        return group[0];
    });
    return {
        plainResult: res.TextDetections!,
        processedResult: processed,
    };
}

if (require.main === module) {
    (async () => {
        const path = "/Users/jabaraster/save/Time Locker/5B41A792-3EB2-4242-B1D8-D8A41F6238DC.jpg";
        const res = await extractScore(require("fs").readFileSync(path));
        console.log(res);
    })();
}