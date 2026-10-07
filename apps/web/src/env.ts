import { defineEnvVars } from "@sveltejs/kit/env";

const required = (value: string | undefined) => {
  if (!value) throw new Error("A required environment variable is missing");
  return value;
};
const httpsURL = (value: string | undefined) => {
  const url = new URL(required(value));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Expected an HTTPS URL without credentials");
  return url.href;
};

export const variables = defineEnvVars({
  JWT_SIGNING_SECRET: {
    schema: (value) => {
      const secret = required(value);
      if (secret.length < 32)
        throw new Error("JWT_SIGNING_SECRET must have at least 32 characters");
      return secret;
    },
  },
  BASE_URL: {
    schema: (value) => {
      const url = new URL(required(value));
      if (
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          )) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error(
          "BASE_URL must be an HTTPS origin (HTTP localhost is allowed for development)",
        );
      return url.origin;
    },
  },
  SLACK_CLIENT_ID: { schema: required },
  SLACK_CLIENT_SECRET: { schema: required },
  SLACK_TEAM: { schema: required },
  PUBLIC_SLACK_CHANNELS: { schema: required, public: true },
  PUBLIC_SLACK_TEAM_DOMAIN: {
    schema: (value) => {
      const domain = required(value);
      if (!/^[a-z0-9-]+\.slack\.com$/.test(domain))
        throw new Error("Expected a Slack workspace domain");
      return domain;
    },
    public: true,
  },
  PUBLIC_EMOJI_CACHE_GET_URL: { schema: httpsURL, public: true },
});
