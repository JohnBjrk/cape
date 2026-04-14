import { defineCommand } from "../cli.config.ts";

export const migrateCommand = defineCommand({
  name: "migrate",
  description: "Run database migrations",
  schema: {
    flags: {
      steps: { type: "number", default: 3, description: "Number of migrations to run" },
    },
  },
  async run(args, runtime) {
    const migrations = Array.from(
      { length: args.flags.steps },
      (_, i) => `migration_00${i + 1}`,
    );
    await runtime.output.withProgressBar(migrations.length, async (tick) => {
      for (const migration of migrations) {
        await Bun.sleep(0);
        runtime.log.verbose(`Applied ${migration}`);
        tick();
      }
    });
    runtime.output.success(`Applied ${migrations.length} migrations`);
  },
});
