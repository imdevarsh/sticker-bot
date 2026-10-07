import { randomBytes } from "node:crypto";
import { redirect } from "@sveltejs/kit";
import { dev } from "$app/env";
import {
  BASE_URL,
  JWT_SIGNING_SECRET,
  SLACK_CLIENT_ID,
  SLACK_TEAM,
} from "$app/env/private";
import jwt from "jsonwebtoken";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ cookies }) => {
  if (JWT_SIGNING_SECRET.length < 32)
    throw new Error("JWT_SIGNING_SECRET must have at least 32 characters");
  const state = randomBytes(32).toString("hex");
  const nonce = randomBytes(32).toString("hex");
  const redirectUri = BASE_URL + "/sign-in/slack-handler";
  // No persistent records for abandoned logins. Slack codes are single-use.
  cookies.set(
    "oauth_attempt",
    jwt.sign({ state, nonce }, JWT_SIGNING_SECRET, {
      algorithm: "HS256",
      audience: "slack-login",
      expiresIn: "10 minutes",
    }),
    {
      path: "/sign-in",
      httpOnly: true,
      secure: !dev,
      sameSite: "lax",
      maxAge: 600,
    },
  );
  const params = new URLSearchParams({
    response_type: "code",
    scope: "openid profile",
    client_id: SLACK_CLIENT_ID,
    state,
    team: SLACK_TEAM,
    nonce,
    redirect_uri: redirectUri,
  });
  redirect(303, `https://slack.com/openid/connect/authorize?${params}`, {
    external: ["https://slack.com"],
  });
};
