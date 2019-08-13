import * as AWS from "aws-sdk";
import * as fs from "fs";

(async () => {
  const rekognition = new AWS.Rekognition({
    region: "ap-northeast-1",
  });
  const baseDir = "../../../save/Time Locker/";
  const clippedDir = "clipped/";
  fs.readdirSync(baseDir + clippedDir).forEach(async (path) => {
    console.log(`${path}を処理します.`);

    const fullPath = baseDir + clippedDir + path;
    const res = await rekognition.detectText({
      Image: {
        Bytes: fs.readFileSync(fullPath),
      },
    }).promise();

    const detections = res.TextDetections!.filter((detection) => {
      return detection!.Type === "LINE" && detection!.Geometry!.BoundingBox!.Top! > 0.8;
    });
    detections.sort((d0, d1) => d1.Confidence! - d0.Confidence! );

    const modelName = detections[0].DetectedText!.replace(/ l/, "").replace(/ II/, "");
    console.log(`${modelName}`);
    try {
      fs.copyFileSync(fullPath, baseDir + "model-proccesed/" + modelName + ".png");
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
    }
  });
})();