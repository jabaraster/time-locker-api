import { APIGatewayProxyResult } from "aws-lambda";

export function ok(body: any, headers?: {[key: string]: string}): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export function badRequest(body: any): APIGatewayProxyResult {
  return {
    statusCode: 400,
    body: JSON.stringify(body),
  };
}

export function internalServerError(body: any): APIGatewayProxyResult {
  return {
    statusCode: 500,
    body: JSON.stringify(body),
  };
}