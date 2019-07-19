import * as fs from "fs";
import { OAuth } from "oauth";
import * as Evernote from "./evernote-access";

function newOAuth(): OAuth {
    const cred: IConsumerCredential = JSON.parse(fs.readFileSync("./nogit/evernote-credential.json", "UTF-8"));
    const url = "https://www.evernote.com/oauth";
    const ret = new OAuth(
        url,
        url,
        cred.consumerKey,
        cred.consumerSecret,
        "1.0",
        "http://localhost/evernote-oauth-callback",
        "HMAC-SHA1",
        );
    ret.setClientOptions({
        requestTokenHttpMethod: "GET",
        accessTokenHttpMethod: "GET",
        followRedirects: true,
    });
    return ret;
}

const oauth = newOAuth();

interface IConsumerCredential {
    applicationName: string;
    consumerKey: string;
    consumerSecret: string;
    sandbox: boolean;
}

interface IRequestToken {
    oAuthToken: string;
    oAuthTokenSecret: string;
    parsedQueryString: any;
}

async function getRequestToken(): Promise<IRequestToken> {
    return new Promise((resolve, reject) => {
        oauth.getOAuthRequestToken({}, (
            err: {statusCode: number, data?: any},
            oAuthToken: string,
            oAuthTokenSecret: string,
            parsedQueryString: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    oAuthToken,
                    oAuthTokenSecret,
                    parsedQueryString,
                });
            });
        });
}

function userAhthorizeUrl(token: IRequestToken): string {
    return `https://www.evernote.com/OAuth.action?oauth_token=${token.oAuthToken}`;
}

async function getAccessToken(temporaryToken: IRequestToken, oAuthVerifier: string): Promise<IRequestToken> {
    return new Promise((resolve, reject) => {
        oauth.getOAuthAccessToken(
            temporaryToken.oAuthToken,
            temporaryToken.oAuthTokenSecret,
            oAuthVerifier, (
            err: {statusCode: number, data?: any},
            oAuthToken: string,
            oAuthTokenSecret: string,
            parsedQueryString: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    oAuthToken,
                    oAuthTokenSecret,
                    parsedQueryString,
                });
            });
    });
}

async function main() {
    try {
        // const cred = await getRequestToken();
        // console.log(cred);

        // const token = JSON.parse(fs.readFileSync("./nogit/evernote-credential.json", "UTF-8"));
        // console.log(userAhthorizeUrl(token));

        const token = JSON.parse(fs.readFileSync("./nogit/evernote-credential.json", "UTF-8"));
        const res = await getAccessToken(token, token.oAuthVerifier);
        console.log(res);

    } catch (err) {
        console.log("!!!!!!!!");
        console.log(err);
    }
}
main();