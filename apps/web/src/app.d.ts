// See https://svelte.dev/docs/kit/types#app.d.ts

import type { JWTData } from "#lib/types.ts";

// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      auth: JWTData | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
