import * as AWS from "aws-sdk";
import { Evernote } from "evernote";
import * as EA from "../src/evernote-access";
import * as sut from "../src/index";

const s3 = new AWS.S3();

(async () => {
    const res = await sut.getScoreAverage();
    console.log(res.body);
})();

export async function processNotes() {
    try {
        const user = await EA.getUser();
        const notes = await EA.getTimeLockerNotesMetadata(300, 100);
        await processNotesCore(user, notes, 0);

    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }
}

async function processNotesCore(user: Evernote.User, notes: Evernote.NotesMetadataList, index: number): Promise<void> {
    if (index >= notes.notes.length) {
        return;
    }
    try {
        console.log(`${index + 1}/${notes.notes.length} Total: ${notes.totalNotes} StartIndex: ${notes.startIndex}`);
        await sut.processNote(user, notes.notes[index].guid);
    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }

    setTimeout(async () => {
        await processNotesCore(user, notes, index + 1);
    }, 0);
}

export async function updateTitleFromEvernote() {
    try {
        const objs = await s3.listObjects({
            Bucket: "time-locker-analyzer-playresultbucket-t2ke5sj5sed",
        }).promise();
        await updateTitleFromEvernoteCore(objs.Contents!, 0);
    } catch (err) {
        console.log("!!! error !!!");
        console.log(err);
    }
}

async function updateTitleFromEvernoteCore(objs: AWS.S3.Object[], index: number): Promise<void> {
    if (index >= objs.length) {
        return;
    }
    const obj = objs[index];

    console.log(`-------- ${obj.Key}`);
    try {
        const c = await s3.getObject({
            Bucket: "time-locker-analyzer-playresultbucket-t2ke5sj5sed",
            Key: obj.Key!,
        }, (err, data) => { /* dummy function */ }).promise();
        const playResult: sut.IPlayResult = JSON.parse(c.Body!.toString("UTF-8"));

        if (playResult.evernoteMeta.noteGuid && !playResult.character) {
            const note = await EA.getNote(playResult.evernoteMeta.noteGuid);
            playResult.character = sut.extractCharacter(note.title);
            console.log(playResult.character);
        }

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
        await updateTitleFromEvernoteCore(objs, index + 1);
    }, 0);
}