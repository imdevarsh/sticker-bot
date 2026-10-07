import type { JWTData } from "#lib/types.ts";
import { error } from "@sveltejs/kit";

export function assertUserExists(
  authLocal: App.Locals["auth"],
): asserts authLocal is JWTData {
  if (!authLocal) error(401, "Please sign in again");
}
