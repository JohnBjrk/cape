const defineCommand = (def: any) => def;

export default defineCommand({
  name: "status",
  description: "Show deployment status",
  schema: {
    flags: {
      env: { type: "string", alias: "e", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    runtime.print(`Checking status for ${args.flags.env}...`);
  },
});
