import type { JWTData } from "#lib/types.ts";
import { error, redirect } from "@sveltejs/kit";
import { createSession, SESSION_SECONDS } from "#lib/server/session.ts";
import { verifySlackIdentity } from "#lib/server/slack-identity.ts";
import { dev } from "$app/env";
import {
  BASE_URL,
  JWT_SIGNING_SECRET,
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_TEAM,
} from "$app/env/private";
import jwt from "jsonwebtoken";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || code.length > 4096 || !state || !/^[a-f0-9]{64}$/.test(state))
    return new Response("Invalid params", { status: 400 });
  const attemptToken = cookies.get("oauth_attempt");
  cookies.delete("oauth_attempt", { path: "/sign-in" });
  if (!attemptToken) error(400, "Please start sign-in again");
  let attempt;
  try {
    attempt = jwt.verify(attemptToken, JWT_SIGNING_SECRET, {
      algorithms: ["HS256"],
      audience: "slack-login",
    });
  } catch {
    error(400, "Sign-in expired; please start again");
  }
  if (
    typeof attempt === "string" ||
    attempt.state !== state ||
    typeof attempt.nonce !== "string"
  )
    error(400, "Invalid sign-in state");
  const slackReq = await fetch("https://slack.com/api/openid.connect.token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: BASE_URL + "/sign-in/slack-handler",
    }),
  });
  const slackReqJSON = await slackReq.json();
  if (
    !slackReq.ok ||
    !slackReqJSON.ok ||
    typeof slackReqJSON.id_token !== "string"
  )
    error(502, "Please try again");
  let jwtData;
  try {
    jwtData = await verifySlackIdentity(
      slackReqJSON.id_token,
      SLACK_CLIENT_ID,
      SLACK_TEAM,
      attempt.nonce,
    );
  } catch {
    error(403, "Slack identity could not be verified for this workspace");
  }

  cookies.set(
    "token",
    await createSession({
      user: jwtData.sub!,
      name:
        typeof jwtData.name === "string"
          ? jwtData.name
          : typeof jwtData.given_name === "string"
            ? jwtData.given_name
            : "<Unknown>",
      image:
        typeof jwtData.picture === "string" &&
        jwtData.picture.startsWith("https://")
          ? jwtData.picture
          : null,
    } satisfies JWTData),
    {
      path: "/",
      httpOnly: true,
      secure: !dev,
      sameSite: "lax",
      maxAge: SESSION_SECONDS,
    },
  );

  redirect(307, "/app");
};
