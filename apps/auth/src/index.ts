// The Worker's entry: only the default export (the runtime treats every named export as an entrypoint).
import type { Env } from "./auth.ts";
import { handle } from "./handle.ts";

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
