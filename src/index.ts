import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as AWS from "aws-sdk";
import { BoundingBox, TextDetection } from "aws-sdk/clients/rekognition";
import { Evernote } from "evernote";
import * as fs from "fs";
import * as Moment from "moment-timezone";
import * as EA from "./evernote-access";
import * as Rekognition from "./rekognition";
import { GameMode } from "./types";
import * as Types from "./types";
import { badRequest, internalServerError, ok, okJson } from "./web-response";

const lambda: AWS.Lambda = new AWS.Lambda({
  region: "ap-northeast-1",
});
const s3: AWS.S3 = new AWS.S3();
const athena: AWS.Athena = new AWS.Athena({
  region: "ap-northeast-1",
  params: {
    format: "raw",
  },
});
const PLAY_RESULT_ATHENA_TABLE = process.env.PLAY_RESULT_BUCKET
  ? process.env.PLAY_RESULT_BUCKET!.replace(/-/g, "_")
  : "";

const PLAY_RESULT_BUCKET_NAME = process.env.PLAY_RESULT_BUCKET
  ? process.env.PLAY_RESULT_BUCKET!
  : "";

const ARMAMENT_NAMES = [
  "TWIN_SHOT",
  "WIDE_SHOT",
  "SIDE_SHOT",
  "HOMING_SHOT",
  "BEAM",
  "ROCKET",
  "MINE_BOT",
  "ICE_CANON",
  "LINE",
  "MISSILE",
  "GUARD_BIT",
  "SUPPORTER",
];
const CHARACTER_NAMES = {
  "ACUTE WIDE LOCKER": "dummy",
  "ALLIGATOR": "dummy",
  "ALLO SAURUS": "dummy",
  "ANT BEAR": "dummy",
  "APPLIV WALKER": "dummy",
  "AUTO AIM BOT": "dummy",
  "AUTO ICE LASER": "dummy",
  "BACK SHOOTER": "dummy",
  "BACK SPRAY SHOOTER": "dummy",
  "BEAM DRAGON": "dummy",
  "BEAM PSYCHIC": "dummy",
  "BEAM WALKER": "dummy",
  "BIG LINE LOCKER": "dummy",
  "BIO RIDER": "dummy",
  "D RIFLE LOCKER": "dummy",
  "DIFFUSER": "dummy",
  "DIMETRODON": "dummy",
  "DOUBLE SNIPER": "dummy",
  "FARTER": "dummy",
  "FLAP SNIPER": "dummy",
  "FLAT LOCKER": "dummy",
  "FREEZER": "dummy",
  "GAME CAST": "dummy",
  "GORI WRAP": "dummy",
  "GREEN MARKER": "dummy",
  "HOMING HOPPER": "dummy",
  "HOMING ICE BOT": "dummy",
  "HUMMER HEAD": "dummy",
  "HUNTER KILLER": "dummy",
  "HUSKY": "dummy",
  "ICE BEAM LOCKER": "dummy",
  "ICE LINE LOCKER": "dummy",
  "ICE PTERANODON": "dummy",
  "JUSTIN": "dummy",
  "LAUNCHER": "dummy",
  "LAUNCHER 2": "dummy",
  "MAD LOCKER": "dummy",
  "MINE DRIVER": "dummy",
  "MINE LOCKER": "dummy",
  "MINIGUN LOCKER": "dummy",
  "MISSILE MASTER": "dummy",
  "MISSILE MASTER 2": "dummy",
  "MUCUS": "dummy",
  "PANDA": "dummy",
  "PEE RASCAL": "dummy",
  "PENGUIN": "dummy",
  "PLESIO SAUR": "dummy",
  "PREDATOR": "dummy",
  "PSYCHIC LOCKER": "dummy",
  "PTERANODON": "dummy",
  "QUAD LOCKER": "dummy",
  "RIFLE LOCKER": "dummy",
  "ROCKET LOCKER": "dummy",
  "RODEO STAMPEDE I": "dummy",
  "RODEO STAMPEDE Ⅱ": "dummy",
  "SHIKIISHI LOCKER": "dummy",
  "SIDE LOCKER": "dummy",
  "SKATER": "dummy",
  "SPEED-MSL DOG": "dummy",
  "SPEED-RCT DIATRYMA": "dummy",
  "SPRAY WALKER": "dummy",
  "STEGO SAUR": "dummy",
  "SUPPORTER BEAR": "dummy",
  "T-REX": "dummy",
  "THE DOG": "dummy",
  "THE LOCKER": "dummy",
  "TORTOISE": "dummy",
  "TRACKER": "dummy",
  "TRIKE": "dummy",
  "TWINKIE DRONE": "dummy",
  "WAR DRONE": "dummy",
  "WAR FROG": "dummy",
  "WAR MANMOTH": "dummy",
  "WAR TOY": "dummy",
  "WHALE": "dummy",
  "WIDE BREAKER": "dummy",
  "WIDE ICE LOCKER": "dummy",
  "WIDE JUSTIN": "dummy",
  "WIDE RHINO": "dummy",
  "X-LASER": "dummy",
  "X-SHOOTER": "dummy",
};

/*****************************************
 * Type definitions.
 *****************************************/
interface IEvernoteMeta {
  noteGuid?: string;
  mediaGuid?: string;
  userId?: number;
  username?: string;
}
interface IPlayResult {
  created: string;
  character: string;
  mode: GameMode;
  score: number;
  armaments: IArmament[];
  missSituation: string;
  reasons: string[];
}
interface IPlayResultFromEvernote extends IPlayResult {
  title: string;
  evernoteMeta: IEvernoteMeta;
  armamentsMeta: IArmamentBounding[];
  levelsMeta: Rekognition.IExtractArmamentsLevelResponse;
}
interface IArmament {
  name: string;
  level: number | null;
}
interface IArmamentBounding {
  name: string;
  boundingBox: BoundingBox;
}
interface IMessage {
  message: string;
}
interface IScoreData {
  highScore: number;
  playCount: number;
  averageScore: number;
}
interface ICharacterScoreData extends ICharacterData<IScoreData | undefined> {
}
interface ICharacterSummaryApiResponseElement {
  scoreSummary: IScoreData;
  scoreRanking: IPlayResult[];
}
interface ICharacterData<T> extends IModeData<T> {
  character: string;
}
interface ICharacterScoreRanking extends IPlayResult {
  scoreRank: number;
}
interface IImageForScoreRekognition {
  dataInBase64: string;
  width: number;
  height: number;
}
interface IArmamentsExtracterResonse {
  imageForLevelRekognition: IImageForScoreRekognition;
  armaments: IArmamentBounding[];
}
interface IModeData<T> {
  hard: T;
  normal: T;
}
interface IDailyScoreData extends IScoreData {
  playDate: string;
}
interface IDailyPlayResultResponse {
  summary: IModeData<IDailyScoreData[]>;
  detail: IModeData<IPlayResult[]>;
}
interface IApiCoreResult<R> {
  result?: R;
  responseHeaders?: { [key: string]: string };
  responseFunction: (body: any, headers?: { [jjjjjjkey: string]: string }) => APIGatewayProxyResult;
}

/*****************************************
 * Export API declarations.
 *****************************************/
async function getScorePerArmlevelCore(): Promise<IApiCoreResult<string>> {
  const query = `
select
  arms.name
  , mode
  , sum(score)/sum(arms.level) as score_per_armlevel
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
  cross join unnest(armaments) as t(arms)
where
  cardinality(armaments) > 0
group by
  arms.name
  , mode
order by
  mode
  , score_per_armlevel
`;

  const rs = await executeAthenaQuery(query);

  return {
    responseFunction: ok,
    responseHeaders: {
      "Content-Type": "text/html",
    },
    result: `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Score per armlevel | Jabara's Time Locker</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css"
          integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <link rel="stylesheet" href="https://static.time-locker.jabara.info/css/common.min.css">
  </head>
  <body>
    <div class="container">
      <h1>Score per armlevel</h1>
      <table class="table">
        ${toTableRow(rs, valueGetter)}
      </table>
    </div>
  </body>
</html>
  `,
  };
}

async function evernoteWebhookEndpointCore(event: APIGatewayProxyEvent): Promise<IApiCoreResult<IMessage>> {
  console.log(JSON.stringify(event.queryStringParameters, null, "  "));

  const queryStringParameters = event.queryStringParameters;
  if (!queryStringParameters) {
    return {
      result: { message: "Query string is null." },
      responseFunction: badRequest,
    };
  }
  const reason = queryStringParameters.reason;
  if (reason !== "create" && reason !== "update") {
    return {
      result: { message: `No operation. Because reason is '${reason}'.` },
      responseFunction: ok,
    };
  }

  const notebookGuid = queryStringParameters.notebookGuid;
  if (!notebookGuid) {
    return {
      result: { message: `GUID for notebook is empty.` },
      responseFunction: badRequest,
    };
  }
  const notebook = await EA.getTimeLockerNotebook();
  if (notebook.guid !== notebookGuid) {
    return {
      result: { message: `No operation. Because, note is not Time Locker note'.` },
      responseFunction: ok,
    };
  }

  const noteGuid = queryStringParameters.guid;
  if (!noteGuid) {
    return {
      result: { message: `GUID for note is empty.` },
      responseFunction: badRequest,
    };
  }

  const user = await EA.getUser();
  const ret = await processNote(user, noteGuid);
  console.log("正常終了.");
  ret.forEach((r, i) => {
    console.log(`${i + 1}: ${r.title}`);
  });
  return {
    result: { message: `${ret.length} image analyzed.` },
    responseFunction: ok,
  };
}

async function analyzeScreenShotApiCore(event: APIGatewayProxyEvent): Promise<IApiCoreResult<IPlayResultFromEvernote>> {
  const data = JSON.parse(event.body!).dataInBase64;
  const ret = await processImage(Buffer.from(data, "base64"));
  return {
    result: ret,
    responseFunction: ok,
  };
}

async function analyzeEvernoteNoteApiCore(
  event: APIGatewayProxyEvent,
): Promise<IApiCoreResult<IPlayResultFromEvernote[] | IMessage>> {

  if (!event.queryStringParameters || !event.queryStringParameters!.noteGuid) {
    return {
      result: { message: "Query parameter 'noteGuid' is missing." },
      responseFunction: badRequest,
    };
  }
  const noteGuid = event.queryStringParameters!.noteGuid;
  const user = await EA.getUser();
  const res = await processNote(user, noteGuid);
  return {
    result: res,
    responseFunction: ok,
  };
}

async function homePageCore(): Promise<IApiCoreResult<string>> {
  return {
    responseFunction: ok,
    responseHeaders: {
      "Content-Type": "text/html",
    },
    result: `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title></title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css"
          integrity="sha384-HSMxcRTRxnN+Bdg0JdbxYKrThecOKuH5zCYotlSAcp1+c8xmyTe9GYg1l9a69psu" crossorigin="anonymous">
    <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.6.3/css/all.css"
          integrity="sha384-UHRtZLI+pbxtHCWp1t77Bi1L4ZtiqrqD80Kn4Z8NTSRyMA2Fd33n5dQ8lWUE00s/" crossorigin="anonymous"/>
    <link rel="stylesheet" href="https://static.time-locker.jabara.info/css/common.min.css">
  </head>
  <body>
    <script src="https://static.time-locker.jabara.info/js/index.min.js"></script>
    <script>
    Elm.Index.init();
    </script>
  </body>
</html>
  `,
  };
}

async function getCharacterSummaryCore(
  evt: APIGatewayProxyEvent,
): Promise<IApiCoreResult<ICharacterData<ICharacterSummaryApiResponseElement | null>>> {

  const characterName = getParameter(evt.pathParameters, "characterName");
  if (!characterName) {
    return {
      responseFunction: badRequest,
    };
  }

  const [ranking, scores] = await Promise.all([
    queryCharacterScoreRanking(characterName),
    queryCharacterScoreSummary(characterName),
  ]);
  const mapper: (rank: ICharacterScoreRanking) => IPlayResult = (rank) => {
    return {
      created: rank.created,
      character: rank.character,
      mode: rank.mode,
      score: rank.score,
      armaments: rank.armaments,
      missSituation: rank.missSituation,
      reasons: rank.reasons,
    };
  };
  const hard = scores.hard
    ? {
      scoreSummary: scores.hard!,
      scoreRanking: ranking
        .filter((rank) => rank.mode === GameMode.Hard)
        .map(mapper),
    }
    : null;
  const normal = scores.normal
    ? {
      scoreSummary: scores.normal!,
      scoreRanking: ranking
        .filter((rank) => rank.mode === GameMode.Normal)
        .map(mapper),
    }
    : null;
  return {
    result: {
      character: characterName,
      hard,
      normal,
    },
    responseFunction: okJson,
  };
}

async function getCharacterListCore(): Promise<IApiCoreResult<ICharacterScoreData[]>> {
  const query = `
select
  character
  , mode
  , count(*)
  , max(coalesce(score, 0))
  , avg(coalesce(score, 0))
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where 1=1
  and character <> ''
  and cardinality(armaments) > 0
group by
  character
  , mode
  `;
  const rs = await executeAthenaQuery(query);
  const ret = rowsToCharacterScoreDataList(rs);
  return {
    result: ret,
    responseFunction: okJson,
  };
}

async function getScoreRankingCore(): Promise<IApiCoreResult<IModeData<ICharacterScoreRanking[]>>> {
  const query = `
select * from
  (select
      ${SQL_COLUMNS_SCORE_RANKING}
  from
    "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
  where 1=1
    and cardinality(armaments) > 0
  )
where 1=1
  and score_rank <= 10
order by
  mode
  , score_rank
  `;
  const ranking = (await queryToRows(query)).map(rowToCharacterScoreRanking);
  return {
    result: {
      hard: ranking.filter((rank) => rank.mode === GameMode.Hard),
      normal: ranking.filter((rank) => rank.mode === GameMode.Normal),
    },
    responseFunction: okJson,
  };
}

async function getTotalPlayStateCore(): Promise<IApiCoreResult<IModeData<IScoreData>>> {
  const query = `
select
  mode
  , count(*) playCount
  , max(coalesce(score, 0)) highScore
  , avg(coalesce(score, 0)) averageScore
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where 1=1
  and cardinality(armaments) > 0
group by
  mode
order by
  mode
  `;
  const scores: Array<[GameMode, IScoreData]> = (await queryToRows(query)).map((row) => {
    const data = row.Data!;
    const r: IScoreData = {
      playCount: parseInt(data[1].VarCharValue!, 10),
      highScore: parseInt(data[2].VarCharValue!, 10),
      averageScore: parseFloat(data[3].VarCharValue!),
    };
    return [Types.parseGameMode(data[0].VarCharValue), r];
  });
  const hards = scores.filter((s) => s[0] === GameMode.Hard);
  const normals = scores.filter((s) => s[0] === GameMode.Normal);
  return {
    result: {
      hard: hards.length > 0 ? hards[0][1] : { playCount: 0, highScore: 0, averageScore: 0 },
      normal: normals.length > 0 ? normals[0][1] : { playCount: 0, highScore: 0, averageScore: 0 },
    },
    responseFunction: okJson,
  };
}

async function getDailyPlayResultCore(): Promise<IApiCoreResult<IDailyPlayResultResponse>> {
  const [summary, detail] = await Promise.all([
    getDailyPlaySummary(),
    getDetailPlayResults(),
  ]);
  return {
    result: {
      summary,
      detail,
    },
    responseFunction: okJson,
  };
}

/*****************************************
 * Export APIs.
 *****************************************/
const getScorePerArmlevel = handler(getScorePerArmlevelCore);
export { getScorePerArmlevel };

const evernoteWebhookEndpoint = handler2(evernoteWebhookEndpointCore);
export { evernoteWebhookEndpoint };

const analyzeScreenShotApi = handler2(analyzeScreenShotApiCore);
export { analyzeScreenShotApi };

const analyzeEvernoteNoteApi = handler2(analyzeEvernoteNoteApiCore);
export { analyzeEvernoteNoteApi };

const homePage = handler(homePageCore);
export { homePage };

const getCharacterList = handler(getCharacterListCore);
export { getCharacterList };

const getCharacterSummary = handler2(getCharacterSummaryCore);
export { getCharacterSummary };

const getScoreRanking = handler(getScoreRankingCore);
export { getScoreRanking };

const getTotalPlayState = handler(getTotalPlayStateCore);
export { getTotalPlayState };

const getDailyPlayResult = handler(getDailyPlayResultCore);
export { getDailyPlayResult };

export async function patch(): Promise<void> {
  return await updateS3Object((result) => {
    const missSituation = extractMissSituation(result.title);
    if (result.missSituation === missSituation) {
      return false;
    }
    result.missSituation = missSituation;
    console.log(`${result.missSituation} <- ${result.title}`);
    return true;
  });
}

/*****************************************
 * Workers.
 *****************************************/
async function getDetailPlayResults(): Promise<IModeData<IPlayResult[]>> {
  const min = `${Moment().add(-5, "day").format("YYYY-MM-DD")}T00:00:00:000Z`;
  const query = `
select
  ${SQL_COLUMNS_PLAY_RESULT}
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where 1=1
  and cardinality(armaments) > 0
  and created >= '${min}'
order by
  mode
  , created desc
  `;

  const results = (await queryToRows(query)).map(rowToCharacterScoreRanking);
  return {
    hard: results.filter((r) => r.mode === GameMode.Hard),
    normal: results.filter((r) => r.mode === GameMode.Normal),
  };
}

async function getDailyPlaySummary(): Promise<IModeData<IDailyScoreData[]>> {
  const query = `
select
  substring(created, 1, 10) playDate
  , mode
  , count(*) playCount
  , max(coalesce(score, 0)) highScore
  , avg(coalesce(score, 0)) averageScore
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where 1=1
  and cardinality(armaments) > 0
group by
  substring(created, 1, 10)
  , mode
order by
  playDate desc
  , mode
`;
  const ret = (await queryToRows(query)).map((row) => {
    const data = row.Data!;
    return {
      playDate: data[0].VarCharValue!,
      mode: Types.parseGameMode(data[1].VarCharValue),
      playCount: parseInt(data[2].VarCharValue!, 10),
      highScore: parseInt(data[3].VarCharValue!, 10),
      averageScore: parseFloat(data[4].VarCharValue!),
    };
  });
  return {
    hard: ret.filter((r) => r.mode === GameMode.Hard),
    normal: ret.filter((r) => r.mode === GameMode.Normal),
  };
}
async function queryCharacterScoreSummary(characterName: string): Promise<ICharacterScoreData> {
  if (!validateCharacterName(characterName)) {
    console.log(`Invalid character name. -> ${characterName}`);
    return {
      character: characterName,
      hard: undefined,
      normal: undefined,
    };
  }
  const query = `
select
  character
  , mode
  , count(*)
  , max(coalesce(score, 0))
  , avg(coalesce(score, 0))
from
  "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
where 1=1
  and character = '${characterName}'
  and cardinality(armaments) > 0
group by
  character
  , mode
  `;
  const rs = await executeAthenaQuery(query);
  const ary = rowsToCharacterScoreDataList(rs);
  switch (ary.length) {
    case 0: return {
      character: characterName,
      hard: undefined,
      normal: undefined,
    };
    case 1: return ary[0];
    default: throw new Error(`Result is too many. expected 1, but actual [${ary.length}]`);
  }
}

async function queryCharacterScoreRanking(characterName: string): Promise<ICharacterScoreRanking[]> {
  if (!validateCharacterName(characterName)) {
    console.log(`Invalid character name. -> ${characterName}`);
    return [];
  }
  const query = `
select * from
  (select
   ${SQL_COLUMNS_SCORE_RANKING}
  from
    "time-locker"."${PLAY_RESULT_ATHENA_TABLE}"
  where 1=1
    and character = '${characterName}'
    and cardinality(armaments) > 0
  )
where 1=1
  and score_rank <= 20
order by
  mode
  , score_rank
  `;
  const rs = await executeAthenaQuery(query);
  return toRows(rs).map(rowToCharacterScoreRanking);
}

async function processNote(user: Evernote.User, noteGuid: string): Promise<IPlayResultFromEvernote[]> {
  const note = await EA.getNote(noteGuid);
  if (!note.resources) {
    return [];
  }
  const resources = note.resources.filter((resource) => resource.mime.startsWith("image/"));
  return await Promise.all(resources.map(processResource(user, note)));
}

async function processImage(imageData: Buffer): Promise<IPlayResultFromEvernote> {
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
    created: new Date().toISOString(),
    missSituation: "",
    mode: score.mode,
    character: "",
    score: score.score,
    title: "",
    armaments: armaments.armaments.map((arm, idx) => {
      return {
        name: arm.name,
        level: idx < levels.processedResult.length
          ? correctDetectionMistake(arm.name, parseInt(levels.processedResult[idx].DetectedText!, 10))
          : null,
      };
    }),
    reasons: [],
    evernoteMeta: {
    },
    armamentsMeta: armaments.armaments,
    levelsMeta: levels,
  };
}

function armamentBoundingComparer(a0: IArmamentBounding, a1: IArmamentBounding): number {
  const dev = a0.boundingBox.Top! - a1.boundingBox.Top!;
  if (Math.abs(dev) > 3) {
    return dev;
  }
  return a0.boundingBox.Left! - a1.boundingBox.Left!;
}

function textDetectionComparer(t0: TextDetection, t1: TextDetection): number {
  const b0 = t0.Geometry!.BoundingBox!;
  const b1 = t1.Geometry!.BoundingBox!;
  const dev = b0.Top! - b1.Top!;
  if (Math.abs(dev) > 0.01) {
    return dev;
  }
  return b0.Left! - b1.Left!;
}

export async function screenShotAnalyzerTestPage(_: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
  if (r) {
    return r[1];
  }
  const tokens = title.split(":");
  if (tokens.length >= 2) {
    return tokens[0];
  }
  return "";
}

export function extractMissSituation(title: string): string {
  const sentence = title.split("。")[0];
  const tokens = sentence.split(":");
  if (tokens.length >= 2) {
    return tokens[1]; // tokens[0]がキャラ名
  }
  const r = sentence.match(/^\[.+\](.+)/);
  if (r) {
    return r[1];
  }
  return sentence;
}

async function sendErrorMail(err: Error): Promise<void> {
  const ses = new AWS.SES({
    region: "us-east-1",
  });
  await ses.sendEmail({
    Source: "time-locker-info@jabara.info",
    Destination: {
      ToAddresses: ["ah+time-locker@jabara.info"],
    },
    Message: {
      Subject: {
        Data: "[Time Locker]Evernote Weghookの処理に失敗しました.",
        Charset: "UTF-8",
      },
      Body: {
        Text: {
          Data: `
            発生日: ${new Date()}
            エラー: ${JSON.stringify(err)}
          `,
          Charset: "UTF-8",
        },
      },
    },
  }, () => { /*dummy*/ }).promise();
}

function processResource(
  user: Evernote.User,
  note: Evernote.Note,
): (r: Evernote.Resource) => Promise<IPlayResultFromEvernote> {

  return async (resource) => {
    const data = await EA.getResourceData(resource.guid);
    const playResult = await processImage(Buffer.from(data));
    playResult.created = new Date(note.created).toISOString();
    playResult.character = getCorrectCharacterName(extractCharacter(note.title));
    playResult.title = note.title;
    playResult.reasons = extractReason(note.title);
    playResult.evernoteMeta = {
      noteGuid: note.guid,
      mediaGuid: resource.guid,
      userId: user.id,
      username: user.username,
    };
    playResult.missSituation = extractMissSituation(note.title);

    try {
      await s3.putObject({
        Bucket: PLAY_RESULT_BUCKET_NAME,
        Key: `${resource.guid}.json`,
        Body: JSON.stringify(playResult),
      }).promise();
    } catch (err) {
      console.error(err);
    }

    return playResult;
  };
}

async function callArmamentsExtracter(imageData: Buffer): Promise<IArmamentsExtracterResonse> {
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
  if (testCount > 40) {
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
      await sleep(500);
      return await waitAthena(queryExecutionId, testCount + 1);
    }
  }
}

function handler<R>(func: () => Promise<IApiCoreResult<R>>): () => Promise<APIGatewayProxyResult> {
  return async () => {
    try {
      const res = await func();
      return res.responseFunction(res.result, res.responseHeaders);
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
      console.log(JSON.stringify(err));
      await sendErrorMail(err);
      return internalServerError({ errorMessage: err.message });
    }
  };
}

function handler2<R>(
  func: (e: APIGatewayProxyEvent) => Promise<IApiCoreResult<R>>,
): (e: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (e: APIGatewayProxyEvent) => {
    try {
      const res = await func(e);
      return res.responseFunction(res.result, res.responseHeaders);
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
      console.log(JSON.stringify(err));
      await sendErrorMail(err);
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
    return `
<th class="${f(idx)} ${column.Name}${isNumberTypeColumn(column) ? " number" : ""}">
${column.Name}
</th>`;
  }).join("")}
  </tr>
</thead>
`;

  const rows = toRows(rs);
  const bodyHtml = `
<tbody>
  ${rows.map((row) => {
    return `<tr>${row.Data!.map((columnValue, columnIndex) => {
      const column = columns[columnIndex];
      return `
 <td class="${column.Name}${isNumberTypeColumn(column) ? " number" : ""}">
 ${valueCallback ? valueCallback(columnValue, columns[columnIndex]) : columnValue}
 </td>`;
    }).join("")}</tr>`;
  }).join("")}
</tbody>
`;
  return headerHtml + bodyHtml;
}

function isNumberTypeColumn(column: AWS.Athena.ColumnInfo): boolean {
  switch (column.Type) {
    case "double": return true;
    case "bigint": return true;
    case "integer": return true;
    default: return false;
  }
}

async function queryToRows(query: string): Promise<AWS.Athena.Row[]> {
  return toRows(await executeAthenaQuery(query));
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

  return queryRes.ResultSet!;
}

async function updateS3Object(updater: (src: IPlayResultFromEvernote) => boolean): Promise<void> {
  const MAX_KEYS = 1000;
  const f = async (offset: number, output: AWS.S3.ListObjectsV2Output, index: number): Promise<void> => {
    const objs = output.Contents!;
    if (index >= objs.length) {
      if (output.IsTruncated) {
        const res = await s3.listObjectsV2({
          Bucket: PLAY_RESULT_BUCKET_NAME,
          ContinuationToken: output.NextContinuationToken,
          MaxKeys: MAX_KEYS,
        }).promise();
        await f(offset + objs.length, res, 0);
      }
      return;
    }
    const obj = objs[index];
    console.log(`--------(${offset + index + 1}/${offset + objs.length})${
      output.IsTruncated ? "(exist continuation)" : ""} ${obj.Key}`);

    try {
      const c = await s3.getObject({
        Bucket: PLAY_RESULT_BUCKET_NAME,
        Key: obj.Key!,
      }, () => { /* dummy function */ }).promise();
      const playResult: IPlayResultFromEvernote = JSON.parse(c.Body!.toString("UTF-8"));
      if (updater(playResult)) {
        console.log(`  更新します.`);
        await s3.putObject({
          Bucket: PLAY_RESULT_BUCKET_NAME,
          Key: obj.Key!,
          Body: JSON.stringify(playResult),
        }).promise();
      }
    } catch (err) {
      console.log("!!! error !!!");
      console.log(err);
    }

    setTimeout(() => {
      f(offset, output, index + 1);
    }, 0);
  };
  try {
    const res = await s3.listObjectsV2({
      Bucket: PLAY_RESULT_BUCKET_NAME,
      MaxKeys: MAX_KEYS,
    }).promise();
    await f(0, res, 0);

  } catch (err) {
    console.log("!!! error !!!");
    console.log(err);
  }
}

function valueGetter(d: AWS.Athena.Datum, c: AWS.Athena.ColumnInfo): string {
  if (c.Name === "character") {
    return `
<div class="character-image-container">
  <img src="https://static.time-locker.jabara.info/img/${encodeURI(d.VarCharValue!)}@65x65.png"
       class="character"/>
  <span class="character-name">${d.VarCharValue}</span>
</div>
`;
  } else {
    return c.Type === "double" ? parseInt(d.VarCharValue!, 10).toString() : d.VarCharValue!;
  }
}

function toRows(rs: AWS.Athena.ResultSet): AWS.Athena.RowList {
  const ret = rs.Rows!;
  ret.shift();
  return ret;
}

function getParameter(param: any, parameterName: string): string {
  if (!param) {
    return "";
  }
  const ret = param![parameterName];
  return ret ? decodeURIComponent(ret) : "";
}

function validateCharacterName(characterName: string): boolean {
  return characterName in CHARACTER_NAMES;
}

function rowsToCharacterScoreDataList(rs: AWS.Athena.ResultSet): ICharacterScoreData[] {
  const idx: { [key: string]: ICharacterScoreData } = {};
  const ret: ICharacterScoreData[] = [];
  toRows(rs).forEach((row) => {
    const data = row.Data!;
    const name = data[0].VarCharValue!;

    if (!(name in idx)) {
      idx[name] = {
        character: name,
        hard: undefined,
        normal: undefined,
      };
      ret.push(idx[name]);
    }
    const elem = idx[name];
    const modeData: IScoreData = {
      playCount: parseInt(data[2].VarCharValue!, 10),
      highScore: parseInt(data[3].VarCharValue!, 10),
      averageScore: parseFloat(data[4].VarCharValue!),
    };
    if (data[1].VarCharValue === "Hard") {
      elem.hard = modeData;
    } else {
      elem.normal = modeData;
    }
  });
  ret.sort((e0, e1) => {
    return e0.character.localeCompare(e1.character);
  });
  return ret;
}

function complementArmaments(arms: IArmament[]): IArmament[] {
  const ret: IArmament[] = [];
  ARMAMENT_NAMES.forEach((armName) => {
    const inParam = arms.find((arm) => arm.name === armName);
    if (inParam) {
      ret.push(inParam);
    } else {
      ret.push({ name: armName, level: 0 });
    }
  });
  ret.forEach((r) => r.name = r.name.replace(/_/g, " "));
  return ret;
}

const SQL_COLUMNS_PLAY_RESULT = `
    created
    , character
    , mode
    , coalesce(score, 0) as score
    , missSituation
    , cast(reasons as json)
    , cast(armaments as json)
`;
const SQL_COLUMNS_SCORE_RANKING = `
    created
    , character
    , mode
    , coalesce(score, 0) as score
    , missSituation
    , cast(reasons as json)
    , cast(armaments as json)
    , row_number() over (partition by mode order by score desc) as score_rank
`;
function rowToCharacterScoreRanking(row: AWS.Athena.Row): ICharacterScoreRanking {
  const data = row.Data!;
  let i = 0;
  return {
    created: data[0].VarCharValue!,
    character: data[++i].VarCharValue!,
    mode: Types.parseGameMode(data[++i].VarCharValue),
    score: parseInt(data[++i].VarCharValue!, 10),
    missSituation: colValS(++i, data, ""),
    reasons: colVal(++i, data, [], JSON.parse),
    armaments: colVal(++i, data, [], parseArmaments),
    scoreRank: colVal(++i, data, 0, parseInt),
  };
}

function colVal<T>(
  idx: number,
  data: AWS.Athena.Datum[],
  nullValue: T,
  valueTransformer: (s: string) => T): T {
    return data.length <= idx ? nullValue : valueTransformer(data[idx].VarCharValue!);
  }

function colValS(
  idx: number,
  data: AWS.Athena.Datum[],
  nullValue: string,
): string {
    return data.length <= idx ? nullValue : data[idx].VarCharValue!;
  }

function parseArmaments(s?: string): IArmament[] {
  // SQL中でarmaments(型はarray<row<name:string,level:bigint>>)をjsonにキャストすると[string,number]で返って来てしまう.
  // かと言ってキャストしないとJSONでない文字列が返って来るので使えない.
  // aws-sdkのなんともイヤな仕様. 将来の仕様拡充を期待したい.
  const armaments = JSON.parse(s!);
  return complementArmaments(armaments.map((arm: any) => {
    return { name: arm[0], level: arm[1] };
  }));
}

export function getCorrectCharacterName(src: string): string {
  const upper = src.toUpperCase();
  if (upper in CHARACTER_NAMES) {
    return src;
  }
  return Object.keys(CHARACTER_NAMES).map((characterName) => {
    return { characterName, distance: levenshtein(upper, characterName) };
  }).sort((a0, a1) => a0.distance - a1.distance)[0].characterName;
}

/***
 * https://camelmasa.hatenadiary.org/entry/20110203/1296758709
 */
function levenshtein(s1: string, s2: string): number {
  // http://kevin.vanzonneveld.net
  // +            original by: Carlos R. L. Rodrigues (http://www.jsfromhell.com)
  // +            bugfixed by: Onno Marsman
  // +             revised by: Andrea Giammarchi (http://webreflection.blogspot.com)
  // + reimplemented by: Brett Zamir (http://brett-zamir.me)
  // + reimplemented by: Alexander M Beedie
  // *                example 1: levenshtein('Kevin van Zonneveld', 'Kevin van Sommeveld');
  // *                returns 1: 3

  if (s1 === s2) {
    return 0;
  }

  const s1Len = s1.length;
  const s2Len = s2.length;
  if (s1Len === 0) {
    return s2Len;
  }
  if (s2Len === 0) {
    return s1Len;
  }

  const ss1 = s1.split("");

  let v0 = new Array(s1Len + 1);
  let v1 = new Array(s1Len + 1);

  let s1Idx = 0;
  let s2Idx = 0;
  let cost = 0;
  for (s1Idx = 0; s1Idx < s1Len + 1; s1Idx++) {
    v0[s1Idx] = s1Idx;
  }
  let charS1 = "";
  let charS2 = "";
  for (s2Idx = 1; s2Idx <= s2Len; s2Idx++) {
    v1[0] = s2Idx;
    charS2 = s2[s2Idx - 1];

    for (s1Idx = 0; s1Idx < s1Len; s1Idx++) {
      charS1 = ss1[s1Idx];
      cost = (charS1 === charS2) ? 0 : 1;
      let mMin = v0[s1Idx + 1] + 1;
      const b = v1[s1Idx] + 1;
      const c = v0[s1Idx] + cost;
      if (b < mMin) {
        mMin = b;
      }
      if (c < mMin) {
        mMin = c;
      }
      v1[s1Idx + 1] = mMin;
    }
    const vTmp = v0;
    v0 = v1;
    v1 = vTmp;
  }
  return v0[s1Len];
}

function correctDetectionMistake(armamentName: string, level: number): number {
  switch (armamentName) {
    case "BEAM":
    case "GUARD_BIT":
    case "ICE_CANON":
    case "LINE":
    case "MINE_BOT":
    case "MISSILE":
    case "ROCKET":
    case "SUPPORTER":
      if (level === 7) {
        return 1;
      }
  }
  return level;
}