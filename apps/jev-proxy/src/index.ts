// The Worker's entry: only the default export (the runtime treats every named export as an entrypoint).
import { type Env, handle } from "./proxy.ts";

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
