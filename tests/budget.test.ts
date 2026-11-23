// ABOUTME: The context budget of spec section 12: static front-load bytes per command, verdict sizes, and their size independence.
// ABOUTME: Also holds every skill's frontmatter and injected command to the exact form spec 9.4 gives.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { COMMANDS, type Command } from "../skills/orc/status.mts";
import { builtCli, configText, Fixture, localWithTickets, type EntrySpec } from "./fixture.ts";

const SKILLS = join(import.meta.dirname, "..", "skills");
/**
 * The budgets are guard rails against bloat creeping back, not targets to squeeze to: a justified raise is fine,
 * and a rule is never dropped or blurred to fit one. Size independence, below, is a design property and stays strict.
 */
// 8,000: the leftover-worktree and rejected-push rules are shared by the build and the landing, so they live once here,
// as do the banner rule and the issue rule with its ByHand pointer, each earned by a run that went wrong without it.
const CORE_BUDGET = 8_000;
const REFERENCE_BUDGET = 8_000;

interface SkillBudget {
  command: Command;
  /** Bytes of the command's SKILL.md. */
  skill: number;
  /** Bytes of its SKILL.md, the shared core (not for /orc) and its reference.md. */
  frontLoad: number;
}

const SKILL_BUDGETS: readonly SkillBudget[] = [
  { command: "orc", skill: 2_600, frontLoad: 2_600 },
  // 12,500 and 13,000: the core states the stale-verdict, re-invocation, banner and issue rules and the unsafe-argument outcome in full.
  { command: "orc-next", skill: 5_200, frontLoad: 12_500 },
  { command: "orc-spec", skill: 6_000, frontLoad: 13_000 },
  { command: "orc-tickets", skill: 6_000, frontLoad: 13_000 },
  { command: "orc-discuss", skill: 12_000, frontLoad: 25_500 },
  { command: "orc-build", skill: 12_000, frontLoad: 25_500 },
  { command: "orc-land", skill: 12_000, frontLoad: 25_500 },
  { command: "orc-setup", skill: 13_000, frontLoad: 27_000 },
];

/** The injected command of spec 9.4, exactly as each skill holds it. */
function injectedCommand(command: Command): string {
  return `!\`node "\${CLAUDE_SKILL_DIR}/../orc/status.mts" ${command}${command === "orc" ? "" : " --core"}\``;
}

function skillText(command: Command): string {
  return readFileSync(join(SKILLS, command, "SKILL.md"), "utf8");
}

function bytes(path: string): number {
  return existsSync(path) ? readFileSync(path).byteLength : 0;
}

function frontLoad(command: Command): { skill: number; total: number } {
  const skill = bytes(join(SKILLS, command, "SKILL.md"));
  const core = command === "orc" ? 0 : bytes(join(SKILLS, "orc", "conventions.md"));
  return { skill, total: skill + core + bytes(join(SKILLS, command, "reference.md")) };
}

describe("static front-load", () => {
  test("every command has one budget row", () => {
    assert.deepEqual(SKILL_BUDGETS.map((row) => row.command).sort(), [...COMMANDS].sort());
  });

  test("the shared core fits its budget", () => {
    const core = bytes(join(SKILLS, "orc", "conventions.md"));
    assert.ok(core > 0, "skills/orc/conventions.md exists");
    assert.ok(core <= CORE_BUDGET, `the core is ${core} bytes, over ${CORE_BUDGET}`);
  });

  test("every reference file fits its budget", () => {
    for (const command of COMMANDS) {
      const size = bytes(join(SKILLS, command, "reference.md"));
      assert.ok(size <= REFERENCE_BUDGET, `${command}/reference.md is ${size} bytes, over ${REFERENCE_BUDGET}`);
    }
  });

  for (const row of SKILL_BUDGETS) {
    test(`${row.command}: within its budget of ${row.skill} and ${row.frontLoad} bytes`, () => {
      const measured = frontLoad(row.command);
      assert.ok(measured.skill > 0, "its SKILL.md exists");
      assert.ok(measured.skill <= row.skill, `SKILL.md is ${measured.skill} bytes, over ${row.skill}`);
      assert.ok(measured.total <= row.frontLoad, `the front-load is ${measured.total} bytes, over ${row.frontLoad}`);
    });
  }

  test("every skill ends with its injected command exactly as spec 9.4 gives it", () => {
    const wrong = COMMANDS.filter((command) => !skillText(command).endsWith(`\n## Verdict\n\n${injectedCommand(command)}\n`));
    assert.deepEqual(wrong, []);
  });

  test("every skill's frontmatter grants the injected command and registers the permission hook of spec 9.4, nothing wider", () => {
    const frontmatter = [
      `allowed-tools: Bash(node "\${CLAUDE_SKILL_DIR}/../orc/status.mts" *)`,
      "hooks:",
      "  PreToolUse:",
      '    - matcher: "Bash"',
      "      hooks:",
      "        - type: command",
      '          if: "Bash(node *)"',
      `          command: '[ -n "$CLAUDE_PROJECT_DIR" ] && cd -P "$CLAUDE_PROJECT_DIR" && up="$(git -c safe.bareRepository=explicit rev-parse --show-cdup)" && cd "./$up" && [ -f .claude/skills/orc/status.mts ] && node ./.claude/skills/orc/status.mts hook'`,
      "---",
    ].join("\n");
    const wrong = COMMANDS.filter((command) => !skillText(command).includes(`disable-model-invocation: true\n${frontmatter}\n`));
    assert.deepEqual(wrong, []);
  });
});

/** The text verdict with its stamp line left out, since the stamp holds HEAD and the time. */
function verdictText(fixture: Fixture, args: string[]): string {
  return fixture
    .text(args)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("Stamp: "))
    .join("\n");
}

describe("verdict sizes", () => {
  const STEP = ["orc-setup", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"] as const;

  function check(fixture: Fixture, tickets: number, entries: number): void {
    for (const command of STEP) {
      const size = Buffer.byteLength(fixture.text([command]));
      const budget = 3_000 + 120 * tickets;
      assert.ok(size <= budget, `${command}: ${size} bytes, over ${budget}`);
    }
    const next = Buffer.byteLength(fixture.text(["orc-next"]));
    assert.ok(next <= 4_000 + 120 * tickets, `orc-next: ${next} bytes`);
    const orc = Buffer.byteLength(fixture.text(["orc"]));
    assert.ok(orc <= 2_000 + 100 * entries + 120 * tickets, `orc: ${orc} bytes`);
  }

  test("a ticketed entry's verdicts fit their budgets", () => {
    check(localWithTickets(), 3, 2);
  });

  test("a built entry's verdicts fit their budgets", () => {
    check(builtCli(localWithTickets()), 3, 2);
  });
});

describe("size independence", () => {
  const pad = (n: number): string => String(n).padStart(3, "0");

  /**
   * Twenty ids for the first two entries (`cli`, specced with three tickets and one built, and `draft`, discussed),
   * then `extraEntries` more entries sharing `extraIds` ids. Each added id is a requirement or decision of an added
   * entry or a `-> project` decision, and every other added entry has a spec and a ticket of its own.
   */
  function project(extraEntries: number, extraIds: number): Fixture {
    const requirements = [...Array.from({ length: 10 }, (_, i) => `- REQ-${pad(i + 1)}: First entry need ${i + 1} (spec: cli)`), "- REQ-011: Draft need (spec: draft)"];
    const decisions = [...Array.from({ length: 8 }, (_, i) => `- D-${pad(i + 1)}: First entry choice ${i + 1} -> spec cli`), "- D-009: Plain Node -> project"];
    const entries: EntrySpec[] = [
      { name: "cli", fields: ["Seams: CLI only", "Landing: local-merge", "Spec: .scratch/cli/spec.md", "Branch: spec/cli"] },
      { name: "draft", fields: ["Seams: none yet", "Landing: local-merge"] },
    ];
    const fixture = new Fixture();
    for (let e = 1; e <= extraEntries; e++) {
      const name = `extra-${e}`;
      const specced = e % 2 === 0;
      entries.push({ name, fields: specced ? ["Landing: local-merge", `Spec: .scratch/${name}/spec.md`, `Branch: spec/${name}`] : [] });
      if (specced) {
        fixture.write(`.scratch/${name}/spec.md`, `# ${name}\n\nRegistry: none\n`);
        fixture.write(`.scratch/${name}/issues/01-ticket.md`, "# 01: Ticket\n\nBlocked by: None\n\nStatus: ready-for-agent\n");
      }
    }
    for (let i = 0; i < extraIds; i++) {
      const id = pad(12 + i);
      const name = `extra-${(i % extraEntries) + 1}`;
      if (i % 3 === 0) requirements.push(`- REQ-${id}: Extra need (spec: ${name})`);
      else if (i % 3 === 1) decisions.push(`- D-${id}: Extra choice -> spec ${name}`);
      else decisions.push(`- D-${id}: Extra project choice -> project`);
    }
    fixture.vendorSkills();
    fixture.write("docs/orc/config.json", configText("local"));
    fixture.write("docs/orc/registry.md", ["# Registry", "", "## Requirements", ...requirements, "", "## Decisions", ...decisions, "", "## Roadmap", ...entries.flatMap((entry, index) => [`${index + 1}. ${entry.name}`, ...(entry.fields ?? []).map((f) => `   - ${f}`)]), ""].join("\n"));
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-001, REQ-002, D-001\n");
    for (const n of ["01", "02", "03"]) {
      fixture.write(`.scratch/cli/issues/${n}-ticket.md`, `# ${n}: Ticket ${n}\n\nBlocked by: ${n === "01" ? "None" : "01"}\n\nSatisfies: REQ-001\n\nStatus: ready-for-agent\n`);
    }
    fixture.commit("docs: set up the project");
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/a.js", "1").commit("feat: ticket 01", "cli/01");
    fixture.git("switch", "-q", "main");
    return fixture;
  }

  /** The text verdict without its stamp, and with the project-decision count, the one number allowed to grow, blanked. */
  function flat(fixture: Fixture, args: string[]): string {
    return verdictText(fixture, args).replace(/ProjectDecisions: \d+/g, "ProjectDecisions: N");
  }

  const small = project(0, 0);
  const large = project(28, 280);

  test("the fixture grows from 20 ids and two entries to 300 ids and 30 entries", () => {
    const registry = (fixture: Fixture): string => readFileSync(join(fixture.root, "docs/orc/registry.md"), "utf8");
    const ids = (fixture: Fixture): number => registry(fixture).match(/^- (?:REQ|D)-/gm)?.length ?? 0;
    const entries = (fixture: Fixture): number => registry(fixture).match(/^\d+\. /gm)?.length ?? 0;
    const project = (fixture: Fixture): number => registry(fixture).match(/-> project$/gm)?.length ?? 0;
    assert.deepEqual([ids(small), entries(small), project(small)], [20, 2, 1]);
    assert.deepEqual([ids(large), entries(large), project(large)], [300, 30, 94]);
  });

  for (const command of ["orc-next", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"] as const) {
    test(`${command}: the first entry's verdict is byte for byte the same`, () => {
      const args = command === "orc-next" ? [command] : [command, "cli"];
      assert.equal(flat(large, args), flat(small, args));
    });
  }

  test("orc-spec: a discussed entry's go is the same but for the project-decision count", () => {
    assert.match(verdictText(small, ["orc-spec", "draft"]), /^ {2}ProjectDecisions: 1 \(registry --project\)$/m);
    assert.match(verdictText(large, ["orc-spec", "draft"]), /^ {2}ProjectDecisions: 94 \(registry --project\)$/m);
    assert.equal(flat(large, ["orc-spec", "draft"]), flat(small, ["orc-spec", "draft"]));
  });

  test("orc: the report grows by one roadmap line per added entry and nothing else", () => {
    const before = verdictText(small, ["orc"]).split("\n");
    const after = verdictText(large, ["orc"]).split("\n");
    const added = after.filter((line) => /^ {6}\d+\. extra-\d+ {2}(?:not-started|ticketed, 0 of 1 tickets built)$/.test(line));
    assert.equal(added.length, 28);
    assert.deepEqual(after.filter((line) => !added.includes(line)), before);
  });
});
