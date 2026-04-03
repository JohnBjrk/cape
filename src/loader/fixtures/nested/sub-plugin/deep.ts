import { defineCommand } from "../../../../cli.ts";

export default defineCommand({
  name: "deep",
  description: "A deeply nested plugin",
  async run(_args, runtime) {
    runtime.print("deep!");
  },
});
