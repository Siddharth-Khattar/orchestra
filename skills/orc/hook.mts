// ABOUTME: orc's permission hook: reads a PreToolUse call on stdin and allows it only when it runs the sibling status.mts.
// ABOUTME: Prints the allow decision or nothing, always exits 0 and never writes to stderr (spec 9.4).

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** One argument as the skills type it: a flag, a bare word with no shell-special character, or a single-quoted value. */
const HOOK_ARGUMENT = "(?:--[a-z]+|[A-Za-z0-9][A-Za-z0-9._/-]*|'[\\p{L}\\p{M}\\p{N}_./#: -]+')";
const HOOK_CALL = new RegExp(`^node "(/[^"$\`\\\\\\n]+)"(?: ${HOOK_ARGUMENT})*$`, "u");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The answer to a PreToolUse call: allow when the Bash command is `node "<absolute path>" <arguments>`, the path
 * resolving to the status script and every argument one the skills type; otherwise nothing, so the normal permission
 * flow decides. Nothing in the command can reach a shell: no operator, substitution, glob, redirect or other quote.
 */
export function hookDecision(inputText: string, scriptPath: string): string {
  let input: unknown;
  try {
    input = JSON.parse(inputText);
  } catch {
    return "";
  }
  if (!isRecord(input) || input.tool_name !== "Bash" || !isRecord(input.tool_input)) return "";
  const command = input.tool_input.command;
  if (typeof command !== "string") return "";
  const path = HOOK_CALL.exec(command)?.[1];
  if (path === undefined) return "";
  const self = realpathOr(scriptPath);
  if (!existsSync(path) || realpathOr(path) !== self) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "orc's own read-only status script" } });
}

/** The hook's output is read as a decision, so it prints the decision alone or nothing at all, and swallows every error. */
function runHook(args: readonly string[]): string {
  if (args.length !== 0) return "";
  try {
    return hookDecision(readFileSync(0, "utf8"), join(import.meta.dirname, "status.mts"));
  } catch {
    return "";
  }
}

/** `import.meta.main` arrived in Node 24.2.0; on an older Node the hook compares its own path. */
function isMain(): boolean {
  const main: boolean | undefined = import.meta.main;
  if (main !== undefined) return main;
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(realpathOr(script)).href === import.meta.url;
}

if (isMain()) {
  process.stdout.write(runHook(process.argv.slice(2)));
  process.exitCode = 0;
}
