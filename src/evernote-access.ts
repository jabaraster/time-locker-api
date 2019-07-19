/**
 * EvernoteのSDKがTypeScriptでかなり使いにくい.
 * どうも、実際のインターフェイスと@types/evernoteが合っていない.
 * 仕方がないので実際のインターフェイスは
 * const evernote = require("evernote");
 * で得て型情報を無くしてTypeScriptのコンパイルエラーを防ぎつつ
 * import { Evernote } from "evernote";
 * で外部に対しての型情報を与えるようにしている.
 */

import { Evernote } from "evernote";
import * as fs from "fs";
// tslint:disable-next-line: no-var-requires
const evernote = require("evernote");

function newEvernoteClient(): any {
    return new evernote.Client({
        token: process.env.EVERNOTE_TOKEN,
        consumerKey: process.env.EVERNOTE_CONSUMER_KEY,
        consumerSecret: process.env.EVERNOTE_CONSUMER_SECRET,
        sandbox: false,
    });
}

const client = newEvernoteClient();

async function getTimeLockerNotebook(): Promise<Evernote.Notebook> {
    const books: Evernote.Notebook[] = await client.getNoteStore().listNotebooks();
    const book = books.find((b) => b.name === "Time Locker");
    if (!book) {
        throw new Error("Notebook [Time Locker] not found.");
    }
    return book;
}

export { getTimeLockerNotebook };

export async function createNote(title: string, content: string): Promise<Evernote.Note> {
    const book = await getTimeLockerNotebook();
    const newNote = new evernote.Types.Note({
        title,
        content,
        notebookGuid: book.guid,
    });
    return await client.getNoteStore().createNote(newNote);
}

export async function getTimeLockerNotesMetadata(
    offset: number = 0,
    maxNoteCount: number = 100,
): Promise<Evernote.NotesMetadataList> {
    const book = await getTimeLockerNotebook();
    const filter = new evernote.NoteStore.NoteFilter({
        notebookGuid: book.guid,
    });
    const resultSpec = new evernote.NoteStore.NotesMetadataResultSpec({
        includeTitle: true,
        includeCreated: true,
        includeNotebookGuid: true,
    });
    return await client.getNoteStore().findNotesMetadata(filter, offset, maxNoteCount, resultSpec);
}

export async function createTimeLockerNotebook(): Promise<Evernote.Notebook> {
    const newNotebook = new evernote.Types.Notebook({
        name: "Time Locker",
    });
    return await client.getNoteStore().createNotebook(newNotebook);
}

/**
 * リソースのデータは含まれないので注意.
 * @param guid 
 */
export async function getNote(guid: string): Promise<Evernote.Note> {
    return await client.getNoteStore().getNote(guid, true, false, false, false);
}

export async function getResourceData(guid: string): Promise<Buffer> {
    const data = await client.getNoteStore().getResourceData(guid);
    return Buffer.from(data, "base64");
}

export async function getUser(): Promise<Evernote.User> {
    return await client.getUserStore().getUser();
}