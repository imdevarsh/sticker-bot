import { createPublicKey, type JsonWebKeyInput } from "node:crypto";
import jwt from "jsonwebtoken";

export async function verifySlackIdentity(
  token: string,
  clientId: string,
  teamId: string,
  nonce: string,
) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== "RS256" || !decoded.header.kid)
    throw new Error("Invalid ID token");
  const response = await fetch("https://slack.com/openid/connect/keys", {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Could not retrieve Slack signing keys");
  const { keys } = (await response.json()) as {
    keys: (JsonWebKeyInput["key"] & { kid?: string })[];
  };
  const key = keys.find(
    (key) => key.kid === decoded.header.kid && key.kty === "RSA",
  );
  if (!key) throw new Error("Unknown Slack signing key");
  const payload = jwt.verify(token, createPublicKey({ key, format: "jwk" }), {
    algorithms: ["RS256"],
    issuer: "https://slack.com",
    audience: clientId,
  });
  if (
    typeof payload === "string" ||
    payload.nonce !== nonce ||
    payload["https://slack.com/team_id"] !== teamId ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number" ||
    payload.iat > Date.now() / 1000 + 60
  )
    throw new Error("Invalid Slack identity");
  return payload;
}
