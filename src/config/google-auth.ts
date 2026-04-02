import { google } from "googleapis";
import { env, requireGoogle } from "./env.js";

export function createOAuth2Client() {
  requireGoogle();
  const oauth2 = new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret
  );
  oauth2.setCredentials({ refresh_token: env.google.refreshToken });
  return oauth2;
}
