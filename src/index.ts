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
const PLAY_RESULT_ATHENA_TABLE = process.env.PLAY_RESULT_BUCKET!.replace(/-/g, "_");

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
  reasons: string[];
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
async function updateS3Objects_(): Promise<APIGatewayProxyResult> {
  await updateS3Object((playResult) => {
    const a = playResult as any;
    if (!a.reasons) {
      a.reasons = a.reason;
    }
  });
  return ok({});
}

async function getCharacterAverageScore_(): Promise<APIGatewayProxyResult> {
  const query = `
select
  character
  , mode
  , count(*) play_count
  , avg(score) score_average
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where
  character <> ''
  and cardinality(armaments) > 0
group by
  character
  , mode
order by
  mode
  , score_average desc
`;

  const rs = await executeAthenaQuery(query);

  return ok(`
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Character average score | Jabara's Time Locker</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css" integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <style>
    th {
      word-break: break-all;
    }
    .play_count, .score_average {
      text-align: right;
    }
    </style>
  </head>
  <body>
    <table class="table table-striped">
      ${toTableRow(rs, (d, c) => {
        return c.Type === "double" ? parseInt(d.VarCharValue!, 10).toString() : d.VarCharValue!;
      }, [7, 2, 1, 2])}
    </table>
  </body>
</html>
  `, {
    "Content-Type": "text/html",
  });
}

async function getCharacterHighscore_(): Promise<APIGatewayProxyResult> {
  const query = `
select
  character
  , mode
  , max(score) highscore
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where
  character <> ''
group by
  mode
  , character
order by
  mode
  , highscore desc
`;

  const rs = await executeAthenaQuery(query);

  return ok(`
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Character highscore | Jabara's Time Locker</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css" integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <style>
    th {
      word-break: break-all;
    }
    .highscore {
      text-align: right;
    }
    </style>
  </head>
  <body>
    <table class="table table-striped">
      ${toTableRow(rs, (d, c) => {
        return c.Type === "double" ? parseInt(d.VarCharValue!, 10).toString() : d.VarCharValue!;
      })}
    </table>
  </body>
</html>
  `, {
    "Content-Type": "text/html",
  });
}

async function getScorePerArmlevel_(): Promise<APIGatewayProxyResult> {
  const query = `
select
  arms.name
  , sum(score)/sum(arms.level) as score_per_armlevel
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
  cross join unnest(armaments) as t(arms)
where
  cardinality(armaments) > 0
group by
  arms.name
order by
  score_per_armlevel
`;

  const rs = await executeAthenaQuery(query);

  return ok(`
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Score per armlevel | Jabara's Time Locker</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css" integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <style>
    th {
      word-break: break-all;
    }
    .score_per_armlevel {
      text-align: right;
    }
    </style>
  </head>
  <body>
    <table class="table table-striped">
      ${toTableRow(rs, (d, c) => {
        return c.Type === "double" ? parseInt(d.VarCharValue!, 10).toString() : d.VarCharValue!;
      })}
    </table>
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
const getCharacterAverageScore = handler(getCharacterAverageScore_);
export { getCharacterAverageScore };

const getCharacterHighscore = handler(getCharacterHighscore_);
export { getCharacterHighscore };

const getScorePerArmlevel = handler(getScorePerArmlevel_);
export { getScorePerArmlevel };

const evernoteWebhookEndpoint = handler2(evernoteWebhookEndpoint_);
export { evernoteWebhookEndpoint };

const analyzeScreenShotApi = handler2(analyzeScreenShotApi_);
export { analyzeScreenShotApi };

const analyzeEvernoteNoteApi = handler2(analyzeEvernoteNoteApi_);
export { analyzeEvernoteNoteApi };

const updateS3Objects = handler(updateS3Objects_);
export { updateS3Objects };

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
    reasons: [],
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
    playResult.reasons = extractReason(note.title),
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
  if (testCount > 20) {
    throw new Error("Timeout.");
  }
  const cfg = {
    QueryExecutionId: queryExecutionId,
  };
  console.log(`Atheaクエリの完了を待ちます. 試行回数: ${testCount}`);
  const res = await athena.getQueryExecution(cfg).promise();
  switch (res.QueryExecution!.Status!.State) {
    case "SUCCEEDED":
      return;
    case "FAILED":
      throw Error(JSON.stringify(res.QueryExecution!.Status));
    default: {
      console.log(`  結果: ${res.QueryExecution!.Status!.State}`);
      await sleep(1000);
      return await waitAthena(queryExecutionId, testCount + 1);
    }
  }
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

function toTableRow(
  rs: AWS.Athena.ResultSet,
  valueCallback: ((data: AWS.Athena.Datum, columnInfo: AWS.Athena.ColumnInfo) => string) | null,
  columnWidth: number[] | null = null,
  ): string {

  const rsMeta = rs.ResultSetMetadata!;
  const columns = rsMeta.ColumnInfo!;
  if (columnWidth) {
    if (columnWidth.length !== columns.length) {
      throw new Error("カラム幅の指定が不正です.");
    }
    if (columnWidth.reduce((pre, cur) => pre + cur, 0) !== 12) {
      throw new Error("カラム幅の指定が不正です.");
    }
  }
  const f = (idx: number) => {
    return columnWidth ? `col-xs-${columnWidth[idx]}` : "";
  };
  const headerHtml = `
<thead>
  <tr>
  ${rsMeta.ColumnInfo!.map((column, idx) => {
    return `<th class="col-xs-${f(idx)} ${column.Name}">${column.Name}</th>`;
  }).join("")}
  </tr>
</thead>
`;

  const rows = rs.Rows!;
  rows.shift(); // 先頭にカラム名が入っているので除く.
  const bodyHtml = `
<tbody>
  ${rows.map((row) => {
    return `<tr>${row.Data!.map((columnValue, columnIndex) => {
      return `<td class="${columns[columnIndex].Name}">${valueCallback ? valueCallback(columnValue, columns[columnIndex]) : columnValue}</td>`;
    }).join("")}</tr>`;
  }).join("")}
</tbody>
`;
  return headerHtml + bodyHtml;
}

async function executeAthenaQuery(query: string): Promise<AWS.Athena.ResultSet> {
  const executionRes = await athena.startQueryExecution({
    ResultConfiguration: {
      OutputLocation: `s3://${process.env.ATHENA_RESULT_BUCKET}/`,
    },
    QueryString: query,
  }).promise();

  await waitAthena(executionRes.QueryExecutionId!, 1);

  const queryRes = await athena.getQueryResults({
    QueryExecutionId: executionRes.QueryExecutionId!,
  }).promise();

  const rs = queryRes.ResultSet!;
  console.log(JSON.stringify(rs.ResultSetMetadata!.ColumnInfo, null, "  "));

  return rs;
}

async function updateS3Object(updater: (src: IPlayResult) => void): Promise<void> {
    const f = async (objs: AWS.S3.Object[], index: number): Promise<void> => {
        if (index >= objs.length) {
            return;
        }
        const obj = objs[index];
        console.log(`-------- ${obj.Key}`);

        try {
            const c = await s3.getObject({
                Bucket: process.env.PLAY_RESULT_BUCKET!,
                Key: obj.Key!,
            }, (err, data) => { /* dummy function */ }).promise();
            const playResult: IPlayResult = JSON.parse(c.Body!.toString("UTF-8"));
            updater(playResult);
            await s3.putObject({
                Bucket: process.env.PLAY_RESULT_BUCKET!,
                Key: obj.Key!,
                Body: JSON.stringify(playResult),
            }).promise();
        } catch (err) {
            console.log("!!! error !!!");
            console.log(err);
        }

        setTimeout(() => {
            f(objs, index + 1);
        }, 0);
    };
    try {
        const objs = await s3.listObjects({
            Bucket: process.env.PLAY_RESULT_BUCKET!,
        }).promise();
        await f(objs.Contents!, 0);

    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }
}
