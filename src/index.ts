import { APIGatewayEvent, APIGatewayProxyResult } from "aws-lambda";
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
const athena: AWS.Athena = new AWS.Athena({
  region: "ap-northeast-1",
});

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
  character: string;
  mode: Rekognition.TimeLockerMode;
  score: number;
  title: string;
  armaments: IArmaments[];
  reason: string[];
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
 * Export API declarations.
 *****************************************/
async function getScoreAverage_(): Promise<APIGatewayProxyResult> {
  const executionRes = await athena.startQueryExecution({
    ResultConfiguration: {
      OutputLocation: `s3://${process.env.ATHENA_RESULT_BUCKET}/`,
    },
    QueryString: `
SELECT
  character
  , mode
  , count(*) play_count
  , avg(score) score_average
FROM
  "time-locker"."time_locker_analyzer_playresultbucket_t2ke5sj5sed"
where
  character <> ''
  and cardinality(armaments) > 0
group by
  character
  , mode
order by
  mode
  , score_average desc
    `,
  }).promise();

  await waitAthena(executionRes.QueryExecutionId!, 1);

  const queryRes = await athena.getQueryResults({
    QueryExecutionId: executionRes.QueryExecutionId!,
  }).promise();

  const rs = queryRes.ResultSet!;
  console.log(JSON.stringify(rs.ResultSetMetadata!.ColumnInfo, null, "  "));

  const bodyHtml = "<tbody>"
  + rs.Rows!.map((row, rowIdx) => {
    if (rowIdx === 0) {
      return `
<tr>
  <th class="col-xs-5">${row.Data![0].VarCharValue}</th>
  <th class="col-xs-2">${row.Data![1].VarCharValue}</th>
  <th class="col-xs-2">${row.Data![2].VarCharValue}</th>
  <th class="col-xs-3">${row.Data![3].VarCharValue}</th>
</tr>`;
    } else {
      return `
<tr>
  <td>${row.Data![0].VarCharValue}</td>
  <td>${row.Data![1].VarCharValue}</td>
  <td>${row.Data![2].VarCharValue}</td>
  <td>${parseInt(row.Data![3].VarCharValue!, 10)}</td>
</tr>`;
    }
  }).join("")
  + "</tbody>";

  return ok(`
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Jabara's Time Locker Score Average</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css" integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <style>
    th {
      word-break: break-all;
    }
    </style>
  </head>
  <body>
    <table class="table table-striped">${bodyHtml}</table>
  </body>
</html>
  `, {
    "Content-Type": "text/html",
  });
}

async function evernoteWebhookEndpoint_(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  console.log(JSON.stringify(event.queryStringParameters, null, "  "));

  const queryStringParameters = event.queryStringParameters;
  if (!queryStringParameters) {
    return badRequest({
      message: "Query string is null.",
    });
  }
  const reason = queryStringParameters.reason;
  if (reason !== "create" && reason !== "update") {
    return ok({
      message: `No operation. Because reason is '${reason}'.`,
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

  const user = await EA.getUser();
  const ret = await processNote(user, noteGuid);
  return ok({
    message: `${ret.length} image analyzed.`,
  });
}

async function analyzeScreenShotApi_(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const data = JSON.parse(event.body!).dataInBase64;
  const ret = await processImage(Buffer.from(data, "base64"));
  return ok(ret);
}

async function analyzeEvernoteNoteApi_(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  if (!event.queryStringParameters || !event.queryStringParameters!.noteGuid) {
    return badRequest({
      message: "Query parameter 'noteGuid' is missing.",
    });
  }
  const noteGuid = event.queryStringParameters!.noteGuid;
  const user = await EA.getUser();
  const res = await processNote(user, noteGuid);
  return ok(res);
}

/*****************************************
 * Export APIs.
 *****************************************/
const getScoreAverage = handler(getScoreAverage_);
export { getScoreAverage };

const evernoteWebhookEndpoint = handler2(evernoteWebhookEndpoint_);
export { evernoteWebhookEndpoint };

const analyzeScreenShotApi = handler2(analyzeScreenShotApi_);
export { analyzeScreenShotApi };

const analyzeEvernoteNoteApi = handler2(analyzeEvernoteNoteApi_);
export { analyzeEvernoteNoteApi };

/*****************************************
 * Export functions.
 *****************************************/
export async function processNote(user: Evernote.User, noteGuid: string): Promise<IPlayResult[]> {
  const note = await EA.getNote(noteGuid);
  if (!note.resources) {
    return [];
  }
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
    character: "",
    score: score.score,
    title: "",
    armaments: armaments.armaments.map((arm, idx) => {
      return {
        name: arm.name,
        level: idx < levels.processedResult.length ? parseInt(levels.processedResult[idx].DetectedText!, 10) : null,
      };
    }),
    reason: [],
    evernoteMeta: {
    },
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

export function extractReason(title: string): string[] {
  const sentences = title.split("。");
  if (sentences.length < 2) {
    return [];
  }
  return sentences[1].split("、");
}

export function extractCharacter(title: string): string {
  const r = title.match(/^\[(.+)\]/);
  return r ? r[1] : "";
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
    playResult.character = extractCharacter(note.title),
    playResult.title = note.title;
    playResult.reason = extractReason(note.title),
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

async function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, milliseconds);
  });
}

async function waitAthena(queryExecutionId: AWS.Athena.QueryExecutionId, testCount: number): Promise<void> {
  if (testCount > 10) {
    throw new Error("Timeout.");
  }
  const cfg = {
    QueryExecutionId: queryExecutionId,
  };
  console.log(`Atheaクエリの完了を待ちます. 試行回数: ${testCount}`);
  const res = await athena.getQueryExecution(cfg).promise();
  if (res.QueryExecution!.Status!.State === "SUCCEEDED") {
    return;
  }
  console.log(`  結果: ${res.QueryExecution!.Status!.State}`);
  await sleep(1000);
  return await waitAthena(queryExecutionId, testCount + 1);
}

function handler(func: () => Promise<APIGatewayProxyResult>): () => Promise<APIGatewayProxyResult> {
  return async () => {
    try {
      return func();
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
      return internalServerError({ errorMessage: err.message });
    }
  };
}
function handler2(
  func: (e: APIGatewayEvent) => Promise<APIGatewayProxyResult>,
  ): (e: APIGatewayEvent) => Promise<APIGatewayProxyResult> {
  return async (e: APIGatewayEvent) => {
    try {
      return func(e);
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
      return internalServerError({ errorMessage: err.message });
    }
  };
}