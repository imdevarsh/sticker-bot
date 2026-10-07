import type { Handle } from "@sveltejs/kit/hooks";
import { error, redirect } from "@sveltejs/kit";
import { readSession } from "#lib/server/session.ts";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.auth = null;
  const token = event.cookies.get("token");
  if (token) {
    try {
      event.locals.auth = await readSession(token);
    } catch {
      error(503, "Sign-in is temporarily unavailable. Please try again.");
    }
    if (!event.locals.auth) event.cookies.delete("token", { path: "/" });
  }
  if (event.url.pathname.startsWith("/app") && !event.locals.auth) {
    if (event.url.pathname.startsWith("/app/api/"))
      error(401, "Please sign in again");
    redirect(303, "/");
  }
  const response = await resolve(event);
  if (event.locals.auth || event.url.pathname.startsWith("/sign-in")) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
  }
  return response;
};
