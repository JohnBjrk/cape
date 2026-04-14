import { defineCommand } from "../cli.config.ts";

export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service to deploy" },
      env:     { type: "string", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    const result = await runtime.output.withSpinner(
      `Deploying ${args.flags.service} to ${args.flags.env}...`,
      async (spinner) => {
        spinner.update("Building image...");
        await Bun.sleep(0);
        spinner.update("Pushing to registry...");
        await Bun.sleep(0);
        return { tag: "v1.4.2" };
      },
    );
    runtime.output.success(
      `Deployed ${args.flags.service} ${result.tag} to ${args.flags.env}`,
    );
  },
});
