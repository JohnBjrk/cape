// defineCommand is a no-op identity helper — no package install needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defineCommand = (def: any) => def;

export default defineCommand({
  name: "status",
  description: "Show deployment status",
  schema: {
    flags: {
      // example: { type: "string", description: "An example flag" },
    },
  },
  async run(args, runtime) {

  // Note: runtime.config is untyped (Record<string, unknown>)

    runtime.print("Running status...");
  },
});
