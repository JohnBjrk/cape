import { defineCommand } from "../../../src/index.ts";
import { join, dirname } from "node:path";

export default defineCommand({
  name: "script",
  description: "Run a package.json script",
  schema: {
    flags: {
      name: {
        type: "string",
        required: true,
        description: "Script to run",
        complete: {
          type: "dynamic",
          fetch: async () => {
            const root = await findProjectRoot();
            const scripts = await readScripts(root);
            return Object.keys(scripts);
          },
        },
      },
    },
  },
  async run(args, runtime) {
    const root = await findProjectRoot();
    const scripts = await readScripts(root);
    const name = args.flags.name;

    if (!(name in scripts)) {
      runtime.printError(`No script "${name}" found in package.json`);
      runtime.printError(`Available: ${Object.keys(scripts).join(", ")}`);
      runtime.exit(1);
    }

    const code = await runtime.exec.interactive(["bun", "run", name], { cwd: root });
    if (code !== 0) runtime.exit(code);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk up from cwd until a directory containing .cape.toml is found. */
async function findProjectRoot(): Promise<string> {
  let dir = process.cwd();
  while (true) {
    if (await Bun.file(join(dir, ".cape.toml")).exists()) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd(); // filesystem root — fall back to cwd
    dir = parent;
  }
}

/** Read the `scripts` field from package.json in the given directory. */
async function readScripts(root: string): Promise<Record<string, string>> {
  const f = Bun.file(join(root, "package.json"));
  if (!(await f.exists())) return {};
  const pkg = (await f.json()) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}
