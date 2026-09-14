import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

export function extractBearerToken(authorizationHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!header) {
    return undefined;
  }

  return BEARER_PREFIX.exec(header)?.[1];
}

export function isValidBearerToken(candidate: string | undefined, expected: string): boolean {
  if (!candidate) {
    return false;
  }

  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);

  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(candidateBuf, expectedBuf);
}

export function isAuthenticatedRequest(req: IncomingMessage, expectedToken: string): boolean {
  return isValidBearerToken(extractBearerToken(req.headers.authorization), expectedToken);
}
