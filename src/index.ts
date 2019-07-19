import { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import * as AWS from "aws-sdk";
import { BoundingBox, TextDetection } from "aws-sdk/clients/rekognition";
import { Evernote } from "evernote";
import * as fs from "fs";
import * as EA from "./evernote-access";
import * as Rekognition from "./rekognition";
import { badRequest, internalServerError, ok } from "./web-response";

const lambda: AWS.Lambda = new AWS.Lambda({
  region: "ap-northeast-1",
});
const s3: AWS.S3 = new AWS.S3();

/*****************************************
 * Export type definitions.
 *****************************************/

export interface IEvernoteMeta {
  noteGuid?: string;
  mediaGuid?: string;
  userId?: number;
  username?: string;
}
export interface IPlayResult {
  created: Date;
  mode: Rekognition.TimeLockerMode;
  score: number;
  title: string;
  armaments: IArmaments[];
  evernoteMeta: IEvernoteMeta;
  armamentsMeta: IArmamentBounding[];
  levelsMeta: Rekognition.IExtractArmamentsLevelResponse;
}
export interface IArmaments {
  name: string;
  level: number | null;
}
export interface IArmamentBounding {
  name: string;
  boundingBox: BoundingBox;
}

/*****************************************
 * Export APIs.
 *****************************************/

export async function evernoteWebhookEndpoint(event: APIGatewayEvent, _: Context): Promise<APIGatewayProxyResult> {
  try {
    const queryStringParameters = event.queryStringParameters;
    if (!queryStringParameters) {
      return badRequest({
        message: "Query string is null.",
      });
    }
    const reason = queryStringParameters.reason;
    if (reason !== "create") {
      return ok({
        message: `No operation. Because reason not '${reason}'.`,
      });
    }

    const notebookGuid = queryStringParameters.notebookGuid;
    if (!notebookGuid) {
      return badRequest({
        message: `GUID for notebook is empty.`,
      });
    }
    const notebook = await EA.getTimeLockerNotebook();
    if (notebook.guid !== notebookGuid) {
      return ok({
        message: `No operation. Because, note is not Time Locker note'.`,
      });
    }

    const noteGuid = queryStringParameters.guid;
    if (!noteGuid) {
      return badRequest({
        message: `GUID for note is empty.`,
      });
    }

    const ret = await processNote(noteGuid);
    return ok({
      message: `${ret.length} image analyzed.`,
    });
  } catch (err) {
    console.log("!!!error occurred !!!");
    console.log(err);
    return internalServerError({});
  }
}

export async function analyzeScreenShotApi(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const data = JSON.parse(event.body!).dataInBase64;
  const ret = await processImage(Buffer.from(data, "base64"));
  return ok(ret);
}

export async function analyzeEvernoteNoteApi(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.queryStringParameters || !event.queryStringParameters!.noteGuid) {
      return badRequest({
        message: "Query parameter 'noteGuid' is missing.",
      });
    }
    const noteGuid = event.queryStringParameters!.noteGuid;
    const res = await processNote(noteGuid);
    return ok(res);

  } catch (err) {
    console.log(err);
    return internalServerError({
      error: err,
    });
  }
}

/*****************************************
 * Export functions.
 *****************************************/

export async function processNote(noteGuid: string): Promise<IPlayResult[]> {
  const noteAsync = EA.getNote(noteGuid);
  const userAsync = EA.getUser();
  const note = await noteAsync;
  const user = await userAsync;
  const resources = note.resources.filter((resource) => resource.mime.startsWith("image/"));
  return await Promise.all(resources.map(processResource(user, note)));
}

export async function processImage(imageData: Buffer): Promise<IPlayResult> {
  const [score, armaments] = await Promise.all([
    Rekognition.extractScore(imageData),
    callArmamentsExtracter(imageData),
  ]);
  armaments.armaments.sort(armamentBoundingComparer);

  const levels = await Rekognition.extractArmamentsLevel(
    Buffer.from(armaments.imageForLevelRekognition.dataInBase64,
      "base64",
    ));
  levels.plainResult.sort(textDetectionComparer);
  levels.processedResult.sort(textDetectionComparer);

  return {
    created: new Date(),
    mode: score.mode,
    score: score.score,
    title: "",
    evernoteMeta: {
    },
    armaments: armaments.armaments.map((arm, idx) => {
      return {
        name: arm.name,
        level: idx < levels.processedResult.length ? parseInt(levels.processedResult[idx].DetectedText!, 10) : null,
      };
    }),
    armamentsMeta: armaments.armaments,
    levelsMeta: levels,
  };
}

export function armamentBoundingComparer(a0: IArmamentBounding, a1: IArmamentBounding): number {
  const dev = a0.boundingBox.Top! - a1.boundingBox.Top!;
  if (Math.abs(dev) > 3) {
    return dev;
  }
  return a0.boundingBox.Left! - a1.boundingBox.Left!;
}

export function textDetectionComparer(t0: TextDetection, t1: TextDetection): number {
  const b0 = t0.Geometry!.BoundingBox!;
  const b1 = t1.Geometry!.BoundingBox!;
  const dev = b0.Top! - b1.Top!;
  if (Math.abs(dev) > 0.01) {
    return dev;
  }
  return b0.Left! - b1.Left!;
}

export async function screenShotAnalyzerTestPage(_: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const c = fs.readFileSync("./test.html", "UTF-8");
  return ok(
    c,
    { "Content-Type": "text/html; charset=UTF-8" },
    );
}

/*****************************************
 * Workers.
 *****************************************/
interface ImageForScoreRekognition {
  dataInBase64: string;
  width: number;
  height: number;
}
interface ArmamentsExtracterResonse {
  imageForLevelRekognition: ImageForScoreRekognition;
  armaments: IArmamentBounding[];
}

function processResource(user: Evernote.User, note: Evernote.Note): (r: Evernote.Resource) => Promise<IPlayResult> {
  return async (resource) => {
    const data = await EA.getResourceData(resource.guid);
    const playResult = await processImage(Buffer.from(data));
    playResult.created = new Date(note.created);
    playResult.title = note.title;
    playResult.evernoteMeta = {
      noteGuid: note.guid,
      mediaGuid: resource.guid,
      userId: user.id,
      username: user.username,
    };

    try {
      await s3.putObject({
        Bucket: process.env.PLAY_RESULT_BUCKET!,
        Key: `${resource.guid}.json`,
        Body: JSON.stringify(playResult),
      }).promise();
    } catch (err) {
      console.error(err);
    }

    return playResult;
  };
}

async function callArmamentsExtracter(imageData: Buffer): Promise<ArmamentsExtracterResonse> {
  const res = await lambda.invoke({
    FunctionName: process.env.ARMAMENT_EXTRACTER_LAMBDA_NAME!,
    InvocationType: "RequestResponse",
    Payload: JSON.stringify({ dataInBase64: imageData.toString("base64") }),
  }).promise();
  if (res.FunctionError) {
    throw new Error(JSON.stringify(res));
  }
  const payload = JSON.parse(res.Payload! as string);
  const body = JSON.parse(payload.body);
  body.armaments = Object.keys(body.armaments).map((key) => {
    return {
      name: key,
      boundingBox: body.armaments[key].boundingBox,
    };
  });
  return body;
}