import { redirect } from "@sveltejs/kit";
import { revokeSession } from "#lib/server/session.ts";

import type { Actions } from "./$types";

export const actions = {
  logout: async (event) => {
    const token = event.cookies.get("token");
    if (token) await revokeSession(token);
    event.cookies.delete("token", { path: "/" });
    throw redirect(303, "/");
  },
} satisfies Actions;
