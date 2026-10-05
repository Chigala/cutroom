import { receive } from "../state/project.ts";
import { toast } from "../state/toast.ts";
import { host } from "./host.ts";

/** "Import clips…": the system file picker, then the same import a drop does. */
export async function importClips(): Promise<void> {
  const result = await host.project.pickAndImport();
  if (!result) return;
  if (!result.ok) toast(result.error, "warn");
  else {
    receive(result.commit);
    toast(result.commit.message);
  }
}
