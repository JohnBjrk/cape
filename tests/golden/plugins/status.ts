import { defineCommand } from "../../.my-tool/index.ts";

export default defineCommand({
  name: "status",
  description: "Show deployment status",
  schema: {
    flags: {
      // example: { type: "string", description: "An example flag" },
    },
  },
  async run(args, runtime) {

    runtime.print("Running status...");
  },
});
