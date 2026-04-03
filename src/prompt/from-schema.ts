import type { ArgSchema } from "../parser/types.ts";
import { text } from "./text.ts";
import { select } from "./select.ts";
import { autocomplete } from "./autocomplete.ts";
import { multiSelect } from "./multi-select.ts";

/**
 * Walks an ArgSchema and interactively prompts for any required flags that
 * are not present in `provided`.
 *
 * Mapping rules:
 *   - boolean flags: skipped (required booleans are not meaningful to prompt for)
 *   - static completion source with ≤8 choices: select
 *   - static completion source with >8 choices: autocomplete
 *   - dynamic completion source: autocomplete with live fetch
 *   - no completion source: text
 *   - multiple flags with static source: multi-select
 *
 * Returns a plain object whose keys are flag names and values are the prompted
 * values (strings or string[] for multiple flags). Callers are responsible for
 * type coercion (e.g. string → number) before merging with parsed args.
 */
export async function fromSchema(
  schema: ArgSchema,
  provided: Set<string>,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const flags = schema.flags ?? {};

  for (const [name, def] of Object.entries(flags)) {
    // Only prompt for required non-boolean flags not already provided
    if (!def.required || def.type === "boolean") continue;
    if (provided.has(name)) continue;

    const message = def.description ?? `Enter a value for --${name}`;

    if (def.multiple && def.complete?.type === "static") {
      // Multiple flag with static choices → multi-select
      result[name] = await multiSelect({ message, choices: def.complete.values });
    } else if (def.complete?.type === "static") {
      // Single flag with static choices
      if (def.complete.values.length <= 8) {
        result[name] = await select({ message, choices: def.complete.values });
      } else {
        result[name] = await autocomplete({ message, choices: def.complete.values });
      }
    } else if (def.complete?.type === "dynamic") {
      // Dynamic completion source → autocomplete with live fetch
      const fetcher = def.complete.fetch;
      result[name] = await autocomplete({
        message,
        choices: (query, signal) => fetcher({ partial: query, flags: result }),
      });
    } else {
      // No completion source → plain text input
      result[name] = await text({ message });
    }

    // Coerce string → number for number flags
    if (def.type === "number" && typeof result[name] === "string") {
      result[name] = Number(result[name]);
    }
  }

  return result;
}

/**
 * Converts prompted values to argv tokens that can be appended to an existing
 * argv array and re-parsed through the normal resolve() path.
 *
 * E.g. `{ name: "Alice", count: 3 }` → `["--name", "Alice", "--count", "3"]`
 * Arrays (multiple flags) produce one `--flag value` pair per element.
 */
export function promptedToArgv(prompted: Record<string, unknown>): string[] {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(prompted)) {
    if (Array.isArray(value)) {
      for (const v of value) argv.push(`--${key}`, String(v));
    } else if (value !== undefined && value !== null) {
      argv.push(`--${key}`, String(value));
    }
  }
  return argv;
}
