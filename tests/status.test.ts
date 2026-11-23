// ABOUTME: Tests for skills/orc/status.mts: the parsers as pure functions, and every verdict against temporary git repos.
// ABOUTME: git runs for real with an isolated config; gh is a fake that answers GraphQL, so no test needs the network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, test } from "node:test";

import {
  citedIds,
  countPending,
  detailQuery,
  hookDecision,
  isUserInvoked,
  lightQuery,
  lockedChanges,
  lookupKeys,
  nodeIsSupported,
  parseArgs,
  parseBlockedBy,
  parseConfig,
  parseGraphql,
  parseLocalTicket,
  parseLock,
  parseLog,
  parsePartOf,
  parsePendingComment,
  parsePullRequests,
  parseRegistry,
  parseSpecIssue,
  parseStatusPaths,
  parseWorktrees,
  pointer,
  projectDecisions,
  renderLookup,
  requirementsOf,
  resolveTarget,
  runStatus,
  specIds,
  supersededBy,
  systemRunner,
  systemRunnerWith,
  LOG_FORMAT,
  TIMED_OUT,
  type Runner,
  type Verdict,
} from "../skills/orc/status.mts";

import {
  builtCli,
  configText,
  environment,
  fakeGh,
  type FakeIssue,
  Fixture,
  FixtureLess,
  GH_LOGGED_OUT,
  GH_MISSING,
  GIT_ENV,
  githubRepo,
  goOf,
  graphqlCalls,
  issueNode,
  localWithTickets,
  LOCK,
  lockText,
  parseLookup,
  parseVerdict,
  pickOf,
  realGit,
  registryText,
  REQUIREMENTS,
  resolveLocal,
  runner,
  SCRIPT_PATH,
  SPECCED_GITHUB,
  SPECCED_LOCAL,
  stateOf,
  stopOf,
  tempDir,
  TICKETS,
  UNFETCHED_HEAD,
  UPSTREAM,
  withoutPageInfo,
} from "./fixture.ts";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("parseRegistry", () => {
  const text = [
    "# Registry",
    "",
    "<!-- Index of ids.",
    "- REQ-99: inside a comment (spec: nowhere)",
    "1. not-an-entry -->",
    "",
    "## Requirements",
    "- REQ-01: Add a counter (spec: add)",
    "- REQ-02: Show counters (spec: show, add)",
    "- REQ-03: Names may contain spaces (supersedes REQ-01) (spec: add)",
    "",
    "## Decisions",
    "- D-01: Plain ESM -> project",
    "- D-02: Temp file then rename -> docs/adr/0001-atomic-write.md",
    "- D-03: Sort by code unit -> spec show",
    "- D-04: From the map (supersedes D-03) -> wayfinder #7",
    "- D-05: Show only -> spec show",
    "",
    "## Roadmap",
    "1. add",
    "   - Spec: #12",
    "   - Branch: spec/add",
    "   - Seams: CLI subprocess only",
    "   - Landing: pr-agent",
    "2. billing",
    "   - Dropped: out of scope for v1",
    "3. show",
    "   - Delivers: REQ-01",
    "   - Delivers: REQ-03",
    "   - Landing: local-merge",
    "",
  ].join("\n");
  const registry = parseRegistry(text);

  test("reads id lines with their tails and their line numbers", () => {
    assert.deepEqual(
      registry.ids.map((l) => [l.id, l.line, l.supersedes, l.kind === "requirement" ? l.specs.join(",") : l.link]),
      [
        ["REQ-01", 8, null, "add"],
        ["REQ-02", 9, null, "show,add"],
        ["REQ-03", 10, "REQ-01", "add"],
        ["D-01", 13, null, "project"],
        ["D-02", 14, null, "docs/adr/0001-atomic-write.md"],
        ["D-03", 15, null, "spec show"],
        ["D-04", 16, "D-03", "wayfinder #7"],
        ["D-05", 17, null, "spec show"],
      ],
    );
    assert.equal(registry.ids[0]?.text, "- REQ-01: Add a counter (spec: add)");
  });

  test("reads roadmap entries and their fields, skipping HTML comments", () => {
    assert.deepEqual(
      registry.entries.map((e) => [e.number, e.name, e.spec, e.landing, e.discussed, e.dropped, e.delivers]),
      [
        [1, "add", "#12", "pr-agent", true, false, []],
        [2, "billing", null, null, false, true, []],
        [3, "show", null, "local-merge", true, false, ["REQ-01", "REQ-03"]],
      ],
    );
    assert.deepEqual(registry.entries[0]?.block, ["1. add", "   - Spec: #12", "   - Branch: spec/add", "   - Seams: CLI subprocess only", "   - Landing: pr-agent"]);
    assert.deepEqual(registry.problems, []);
  });

  test("superseded ids, live requirements, the ids /orc-spec lists and the project decisions it counts", () => {
    assert.deepEqual([...supersededBy(registry)], [["REQ-01", "REQ-03"], ["D-03", "D-04"]]);
    const [add, , show] = registry.entries;
    assert.ok(add && show);
    assert.deepEqual(requirementsOf(registry, add), ["REQ-02", "REQ-03"]);
    assert.deepEqual(requirementsOf(registry, show), ["REQ-02", "REQ-03"]);
    assert.deepEqual(specIds(registry, show), ["REQ-02", "REQ-03", "D-05"]);
    assert.deepEqual(projectDecisions(registry), ["D-01"]);
  });

  test("reports each malformed line by number and kind instead of failing", () => {
    const bad = parseRegistry(
      [
        "## Requirements",
        "- REQ-01: no tail here",
        "- D-01: wrong section -> project",
        "- REQ-02: fine (spec: a)",
        "- REQ-02: twice (spec: a)",
        "- something else",
        "## Decisions",
        "- D-02: odd link -> somewhere else",
        "- D-03: missing link",
        "- D-04: ghost (supersedes D-09) -> project",
        "## Roadmap",
        "1. cli",
        "   - Landing: yolo",
        "   - Landing: local-merge",
        "   - Colour: blue",
        "   - Delivers: REQ-42",
        "2. cli",
        "   - Seams: of the duplicate",
        "3. ../../Not_Kebab",
        "   - Spec: ../../outside/spec.md",
        "stray text",
      ].join("\n"),
    );
    assert.deepEqual(
      bad.problems.map((p) => [p.line, p.kind, p.ignoresEntry]),
      [
        [2, "bad-tail", false],
        [3, "wrong-section", false],
        [5, "duplicate-id", false],
        [6, "not-an-id-line", false],
        [8, "bad-link", false],
        [9, "bad-tail", false],
        [13, "bad-landing", false],
        [14, "repeated-field", false],
        [15, "unknown-field", false],
        [17, "duplicate-entry", true],
        [19, "not-kebab-case", true],
        [21, "not-an-entry-line", false],
        [10, "unknown-supersedes", false],
        [12, "unknown-delivers", false],
      ],
    );
    // An ignored entry never reaches the roadmap, so its name is never used as a path, a branch or a target.
    assert.deepEqual(bad.entries.map((entry) => [entry.name, entry.discussed, entry.landing, entry.seams]), [["cli", true, null, null]]);
  });

  test("a registry with Windows line endings reads the same, its lookup lines without the \\r", () => {
    const crlf = parseRegistry(text.replace(/\n/g, "\r\n"));
    assert.deepEqual(crlf, registry);
  });

  test("the template's empty sections are an empty roadmap, while a file with no Roadmap heading is broken", () => {
    const empty = parseRegistry("# Registry\n\n## Requirements\n\n## Decisions\n\n## Roadmap\n");
    assert.equal(empty.hasRoadmap, true);
    assert.deepEqual(empty.problems, []);
    assert.deepEqual(parseRegistry("").problems, [{ line: null, kind: "no-roadmap", ignoresEntry: false }]);
    assert.equal(parseRegistry("# Registry\n\n### Roadmap\n1. cli\n").hasRoadmap, false);
  });

  test("the lookup prints each key's line exactly, superseded ones marked, entries as their block", () => {
    const result = lookupKeys(registry, ["REQ-02", "REQ-01", "show", "D-77"]);
    assert.deepEqual(renderLookup(result), [
      "- REQ-02: Show counters (spec: show, add)",
      "- REQ-01: Add a counter (spec: add) (superseded by REQ-03)",
      "3. show",
      "   - Delivers: REQ-01",
      "   - Delivers: REQ-03",
      "   - Landing: local-merge",
      "D-77: not in the registry",
    ]);
    assert.deepEqual(result.keys[3], { key: "D-77", lines: null, supersededBy: null });
    assert.deepEqual(renderLookup(lookupKeys(registry, [], true)), ["- D-01: Plain ESM -> project"]);
  });
});

// ---------------------------------------------------------------------------
// Other parsers
// ---------------------------------------------------------------------------

describe("parseConfig", () => {
  test("reads every key of a complete config", () => {
    const result = parseConfig(configText("local", { test: null, buildStart: "always" }));
    assert.ok(result.ok);
    assert.deepEqual(result.value.missingKeys, []);
    assert.deepEqual(result.value.badKeys, []);
    assert.equal(result.value.values.test, null);
    assert.equal(result.value.values.buildStart, "always");
  });

  test("names missing keys and unknown values, and keeps the valid ones", () => {
    const result = parseConfig(JSON.stringify({ tracker: "gitlab", profile: "mvp", reviewFixRounds: -1, test: "npm test && rm -rf /", upstream: { discuss: "../x" } }));
    assert.ok(result.ok);
    assert.deepEqual(result.value.values, { profile: "mvp" });
    assert.deepEqual(result.value.badKeys, ["tracker", "reviewFixRounds", "test", "upstream.discuss"]);
    assert.ok(result.value.missingKeys.includes("buildStart"));
    assert.ok(result.value.missingKeys.includes("upstream.setup"));
  });

  test("a file that is not a JSON object fails", () => {
    assert.equal(parseConfig("{").ok, false);
    assert.equal(parseConfig("[]").ok, false);
  });
});

describe("small parsers", () => {
  test("parseBlockedBy reads none, numbers, titles with digits and qualified refs", () => {
    assert.deepEqual(parseBlockedBy(null, "cli"), []);
    assert.deepEqual(parseBlockedBy("None (can start immediately)", "cli"), []);
    assert.deepEqual(parseBlockedBy("02 (`tally --version` end to end on Node 24)", "cli"), ["cli/02"]);
    assert.deepEqual(parseBlockedBy("01 (CLI skeleton), 02 (`tally show`)", "cli"), ["cli/01", "cli/02"]);
    assert.deepEqual(parseBlockedBy("other/3", "cli"), ["other/03"]);
  });

  test("parseLocalTicket reads the title, status, blockers and Satisfies: ids; Status: built is not resolved", () => {
    const ticket = parseLocalTicket("cli", ".scratch/cli/issues", "02-version.md", "# 02: Version\r\n\r\nBlocked by: 01\r\nSatisfies: REQ-01, D-02\r\nStatus: built\r\n");
    assert.deepEqual(ticket, {
      ref: "cli/02",
      title: "Version",
      resolved: false,
      blockers: { ok: true, value: ["cli/01"] },
      satisfies: ["REQ-01", "D-02"],
      path: ".scratch/cli/issues/02-version.md",
      author: null,
    });
    assert.equal(parseLocalTicket("cli", "d", "notes.md", "# x"), null);
    assert.equal(parseLocalTicket("cli", "d", "01-a.md", "**Status:** Done")?.resolved, true);
  });

  test("countPending counts the lines after the marker, and every - line when the marker is missing", () => {
    assert.equal(countPending("<!-- orc:pending-decisions -->\n- auth/02: a\n- auth/03: b\nnot a line\n"), 2);
    assert.equal(countPending("- auth/02: a\r\n"), 1);
    assert.equal(countPending("<!-- orc:pending-decisions -->\n"), 0);
  });

  test("citedIds reads the spec's Registry: line only", () => {
    assert.deepEqual(citedIds("# Spec\n\n**Registry:** REQ-01, D-03\n\nMentions REQ-09 elsewhere"), ["REQ-01", "D-03"]);
    assert.deepEqual(citedIds(null), []);
  });

  test("parseLock reads each skill's commit, and isUserInvoked reads the frontmatter", () => {
    assert.deepEqual(parseLock(LOCK).get("to-spec"), { commit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", source: "mattpocock/skills" });
    assert.deepEqual([...parseLock("not json")], []);
    assert.deepEqual([...parseLock(null)], []);
    assert.equal(isUserInvoked("---\nname: x\ndisable-model-invocation: true\n---\nbody"), true);
    assert.equal(isUserInvoked("---\nname: x\n---\ndisable-model-invocation: true"), false);
  });

  test("parseLog reads real git output with the files each commit changed", () => {
    const fixture = new Fixture();
    fixture.write("a.txt", "1").commit("feat: one", "cli/01", "cli/02");
    fixture.write(".scratch/cli/notes/n.md", "n").commit("docs: notes");
    const commits = parseLog(fixture.git("log", LOG_FORMAT, "--name-only"));
    assert.deepEqual(
      commits.map((c) => [c.isMerge, c.refs, c.files]),
      [
        [false, [], [".scratch/cli/notes/n.md"]],
        [false, ["cli/01", "cli/02"], ["a.txt"]],
      ],
    );
  });

  test("parseStatusPaths and parseWorktrees", () => {
    assert.deepEqual(parseStatusPaths(" M a.txt\0R  new.txt\0old.txt\0?? dir/x y.md\0"), ["a.txt", "new.txt", "old.txt", "dir/x y.md"]);
    assert.deepEqual(parseWorktrees("worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/x\nHEAD b\ndetached\nlocked claude agent x (pid 1)\n"), [
      { path: "/r", branch: "main", locked: false },
      { path: "/r/.claude/worktrees/x", branch: null, locked: true },
    ]);
  });

  test("nodeIsSupported compares against 24.3.0", () => {
    assert.equal(nodeIsSupported("v24.3.0"), true);
    assert.equal(nodeIsSupported("v24.18.0"), true);
    assert.equal(nodeIsSupported("v25.0.0"), true);
    assert.equal(nodeIsSupported("v24.2.9"), false);
    assert.equal(nodeIsSupported("v22.20.0"), false);
  });

  test("parseArgs takes a command first, one target, --json and --core", () => {
    assert.deepEqual(parseArgs(["orc-build", "auth/01", "--json"]).argument, "auth/01");
    assert.equal(parseArgs(["auth"]).usage, "unknown command auth");
    assert.equal(parseArgs(["orc", "a", "b"]).usage, "at most one target");
    assert.equal(parseArgs(["orc", "--core", "--json"]).usage, "--core goes with the text form, not with --json");
    assert.equal(parseArgs(["orc", "--verbose"]).usage, "unknown flag --verbose");
    assert.deepEqual(parseArgs(["registry", "REQ-01", "auth"]).keys, ["REQ-01", "auth"]);
    assert.equal(parseArgs(["registry"]).usage, "registry needs a key or --project");
    assert.deepEqual([parseArgs(["registry", "--project"]).project, parseArgs(["registry", "--project"]).usage], [true, null]);
    assert.equal(parseArgs(["orc", "--project"]).usage, "--project goes with registry, not with a command");
    assert.deepEqual([parseArgs(["hook"]).kind, parseArgs(["hook"]).usage], ["hook", null]);
    assert.equal(parseArgs(["hook", "x"]).usage, "hook takes nothing but the tool call on stdin");
  });
});

describe("the permission hook", () => {
  const root = tempDir();
  const orc = join(root, ".claude", "skills", "orc");
  mkdirSync(orc, { recursive: true });
  const self = join(orc, "status.mts");
  writeFileSync(self, "");
  mkdirSync(join(root, ".claude", "skills", "orc-build"));
  const viaSkill = `${root}/.claude/skills/orc-build/../orc/status.mts`;
  const input = (command: string, tool = "Bash"): string => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command }, cwd: root });
  const allowed = (command: string, tool = "Bash"): boolean => hookDecision(input(command, tool), self) !== "";

  test("allows exactly orc's own script, called the way the skills write it, with safe arguments", () => {
    const decision: unknown = JSON.parse(hookDecision(input(`node "${viaSkill}" orc-build 'memo-cli' --core`), self));
    assert.deepEqual(decision, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "orc's own read-only status script" } });
    for (const args of ["orc", "orc-build --json", "registry 'memo' REQ-01 D-02", "registry --project", "orc '#12'", "locked '1a2b3c4 2026-11-22T09:14:03Z' 'memo'", "orc-discuss 'next-one' --new --core", "orc 'cli/02'"]) {
      assert.ok(allowed(`node "${viaSkill}" ${args}`), args);
    }
    assert.ok(allowed(`node "${self}" orc`));
  });

  test("anything else gets no decision, so the normal permission flow applies", () => {
    const other = join(root, "other.mts");
    writeFileSync(other, "");
    const link = join(root, "link.mts");
    symlinkSync(self, link);
    const refused = [
      `node "${viaSkill}" orc; touch x`,
      `node "${viaSkill}" orc && node -e 1`,
      `node "${viaSkill}" orc | cat`,
      `node "${viaSkill}" orc '$(touch x)'`,
      `node "${viaSkill}" orc "x"`,
      `node "${viaSkill}" orc \`touch x\``,
      `node "${viaSkill}" orc > out.txt`,
      `node "${viaSkill}" orc 'a'b'`,
      `node "${viaSkill}" orc *`,
      `node "${viaSkill}" -e 1`,
      `node "${viaSkill}" orc\ntouch x`,
      `node "${viaSkill}"  orc`,
      `node -e 1 "${viaSkill}" orc`,
      `node --import x "${viaSkill}" orc`,
      `node "${other}" orc`,
      `node "${root}/.claude/skills/orc/../missing/status.mts" orc`,
      `node ".claude/skills/orc/status.mts" orc`,
      `nodejs "${viaSkill}" orc`,
      `FOO=1 node "${viaSkill}" orc`,
    ];
    for (const command of refused) assert.equal(hookDecision(input(command), self), "", command);
    // A symlink resolves to the script itself, which is what runs.
    assert.ok(allowed(`node "${link}" orc`));
    assert.equal(hookDecision(input(`node "${viaSkill}" orc`, "Write"), self), "");
    for (const text of ["", "not json", "[]", JSON.stringify({ tool_name: "Bash" }), JSON.stringify({ tool_name: "Bash", tool_input: { command: 3 } })]) {
      assert.equal(hookDecision(text, self), "", text);
    }
  });
});

describe("the permission hook against hostile input", () => {
  // A checkout whose path holds a space and glob characters, with look-alike scripts beside the real one.
  const root = join(tempDir(), "a checkout [1]");
  const orc = join(root, ".claude", "skills", "orc");
  mkdirSync(orc, { recursive: true });
  const self = join(orc, "status.mts");
  writeFileSync(self, "// orc");
  const nested = join(root, "vendor", "clone", ".claude", "skills", "orc");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "status.mts"), "// planted");
  const copy = join(orc, "status.mts.bak");
  writeFileSync(copy, "// orc");
  const hardLink = join(orc, "linked.mts");
  linkSync(self, hardLink);
  symlinkSync(join(root, "vendor"), join(orc, "out"));
  const call = (command: unknown): string => hookDecision(JSON.stringify({ tool_name: "Bash", tool_input: { command } }), self);
  const own = `node "${self}"`;

  test("a checkout path with a space and glob characters is allowed inside its double quotes", () => {
    assert.notEqual(call(`${own} orc-build 'memo' --core`), "");
    assert.notEqual(call(`node "${orc}/../orc/status.mts" orc`), "");
  });

  test("only the script itself: no other file, however its path is spelled", () => {
    const refused = [
      `node "${nested}/status.mts" orc`,
      `node "${orc}/out/clone/.claude/skills/orc/status.mts" orc`,
      `node "${orc}/../../../vendor/clone/.claude/skills/orc/status.mts" orc`,
      `node "${copy}" orc`,
      `node "${hardLink}" orc`,
      `node "${self}/" orc`,
      `node "${self}/../status.mts.bak" orc`,
      `node "${orc}" orc`,
      `node "${self.toUpperCase()}" orc`,
      `node '${self}' orc`,
      `node ${self} orc`,
      `node "~/status.mts" orc`,
      `node "file://${self}" orc`,
    ];
    for (const command of refused) assert.equal(call(command), "", command);
  });

  test("nothing a shell would act on, in the path or after it", () => {
    const refused = [
      `node "${root}/$(touch x)/.claude/skills/orc/status.mts" orc`,
      `node "${root}/\`touch x\`/.claude/skills/orc/status.mts" orc`,
      `node "${root}/$HOME/status.mts" orc`,
      `node "${self}\\" orc`,
      `node "${self}"" orc`,
      `node "${self}"x orc`,
      `node "${self}\n" orc`,
      `${own} orc &`,
      `${own} orc & touch x`,
      `${own} orc || touch x`,
      `${own} orc 2>&1`,
      `${own} orc < /etc/passwd`,
      `${own} orc >> out`,
      `${own} orc <(touch x)`,
      `${own} orc $HOME`,
      `${own} orc \${HOME}`,
      `${own} orc ~`,
      `${own} orc {a,b}`,
      `${own} orc a=b`,
      `${own} orc ?`,
      `${own} orc [a]`,
      `${own} orc !!`,
      `${own} orc #12`,
      `${own} orc 'a\nb'`,
      `${own} orc 'a\rb'`,
      `${own} orc 'a\tb'`,
      `${own} orc 'it''s'`,
      `${own} orc $'a'`,
      `${own} orc '\u2019'`,
      `${own} orc "$(touch x)"`,
      `${own} orc\ttouch`,
      `${own} orc\r`,
      `${own} orc `,
      ` ${own} orc`,
      `${own} orc -- -e`,
      `${own} orc -x`,
      `${own} orc --Core`,
      `${own} orc --env-file=x`,
      `${own} orc --import=x`,
      `${own}\u00a0orc`,
      `${own} orc\u2028touch x`,
    ];
    for (const command of refused) assert.equal(call(command), "", JSON.stringify(command));
  });

  test("a directory the checkout commits with a shell-special name never carries a path to the script", () => {
    // Each one exists, so the path resolves to the script itself: only the path's character rule refuses it.
    for (const name of ['a"; touch x; "', "$(touch x)", "`touch x`", "a\\", "a\nb"]) {
      mkdirSync(join(root, name));
      const command = `node "${root}/${name}/../.claude/skills/orc/status.mts" orc`;
      assert.equal(call(command), "", JSON.stringify(command));
    }
  });

  test("no interpreter flag, environment or wrapper before the script", () => {
    const refused = [
      `node -e "1" "${self}" orc`,
      `node -r ./x "${self}" orc`,
      `node --import ./x "${self}" orc`,
      `node --env-file=.env "${self}" orc`,
      `node --experimental-strip-types "${self}" orc`,
      `node -- "${self}" orc`,
      `NODE_OPTIONS=--require=./x ${own} orc`,
      `env NODE_OPTIONS=-r./x ${own} orc`,
      `PATH=.:$PATH ${own} orc`,
      `command ${own} orc`,
      `exec ${own} orc`,
      `sudo ${own} orc`,
      `time ${own} orc`,
      `/usr/bin/node "${self}" orc`,
      `./node "${self}" orc`,
      `node.exe "${self}" orc`,
      `Node "${self}" orc`,
      `bun "${self}" orc`,
      `deno run "${self}" orc`,
      `npx tsx "${self}" orc`,
      `bash -c 'node "${self}" orc'`,
      `(${own} orc)`,
      `{ ${own} orc; }`,
      `cd /tmp && ${own} orc`,
    ];
    for (const command of refused) assert.equal(call(command), "", command);
  });

  test("malformed, oversized or mistyped input decides nothing, and never throws", () => {
    const inputs = [
      "", " ", "null", "0", "\"node\"", "[]", "{}", "{", "\u0000",
      JSON.stringify({ tool_name: "Bash" }),
      JSON.stringify({ tool_name: "Bash", tool_input: null }),
      JSON.stringify({ tool_name: "Bash", tool_input: [] }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: [own] } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: { toString: "x" } } }),
      JSON.stringify({ tool_name: "bash", tool_input: { command: `${own} orc` } }),
      JSON.stringify({ tool_name: ["Bash"], tool_input: { command: `${own} orc` } }),
      JSON.stringify({ tool_input: { command: `${own} orc` } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { cmd: `${own} orc` } }),
      JSON.stringify([{ tool_name: "Bash", tool_input: { command: `${own} orc` } }]),
      `${JSON.stringify({ tool_name: "Bash", tool_input: { command: `${own} orc` } })} trailing`,
    ];
    for (const text of inputs) assert.equal(hookDecision(text, self), "", text.slice(0, 80));
    assert.equal(call(`${own} ${"a".repeat(2_000_000)}; touch x`), "");
    assert.equal(call(`${own}${" 'a'".repeat(200_000)} |`), "");
    assert.notEqual(call(`${own}${" 'a'".repeat(50_000)}`), "");
    // A script path that no longer resolves allows nothing.
    assert.equal(hookDecision(JSON.stringify({ tool_name: "Bash", tool_input: { command: `node "${join(root, "gone.mts")}" orc` } }), join(root, "gone.mts")), "");
  });
});

describe("the hook command in every skill's frontmatter", () => {
  // The eight skills hold the same line, which the budget test pins; this runs it under sh with a node that records where it ran.
  const hookCommand = /^ {10}command: '(.+)'$/m.exec(readFileSync(join(import.meta.dirname, "..", "skills", "orc", "SKILL.md"), "utf8"))?.[1] ?? "";
  const bin = tempDir();
  const log = join(bin, "ran.log");
  // The physical directory ($(pwd -P) would drop a trailing newline), so a cd that walked a symlink's logical parents shows where node really started.
  writeFileSync(join(bin, "node"), `#!/bin/sh\ncd -P . && printf '%s %s\\n' "$PWD" "$*" >> "${log}"\n`, { mode: 0o755 });
  const SCRIPT = ".claude/skills/orc/status.mts";
  /** Runs the hook command with the given project directory and returns where node ran, or null when it never started. */
  const hookRun = (projectDir: string | undefined, cwd = tmpdir()): { ran: string | null; status: number | null; stdout: string } => {
    rmSync(log, { force: true });
    const env: NodeJS.ProcessEnv = { ...GIT_ENV, PATH: `${bin}:${GIT_ENV.PATH ?? ""}` };
    if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
    const result = spawnSync("sh", ["-c", hookCommand], { cwd, encoding: "utf8", env, input: "{}" });
    return { ran: existsSync(log) ? readFileSync(log, "utf8") : null, status: result.status, stdout: result.stdout };
  };
  const withScript = (dir: string): string => {
    mkdirSync(join(dir, ".claude", "skills", "orc"), { recursive: true });
    writeFileSync(join(dir, SCRIPT), "// orc");
    return dir;
  };

  test("runs the checkout's own script from its root: from the root, a subdirectory and a linked worktree", () => {
    assert.notEqual(hookCommand, "", "the frontmatter holds a hook command");
    const fixture = new Fixture();
    withScript(fixture.root);
    fixture.commit("chore: install orc");
    const deep = join(fixture.root, "src", "deep");
    mkdirSync(deep, { recursive: true });
    const worktree = join(tempDir(), "linked");
    fixture.git("worktree", "add", "-q", "-b", "side", worktree);
    for (const [projectDir, root] of [[fixture.root, fixture.root], [deep, fixture.root], [worktree, worktree]] as const) {
      const result = hookRun(projectDir);
      assert.equal(result.ran, `${realpathSync(root)} ./${SCRIPT} hook\n`, projectDir);
    }
  });

  test("a project directory that is a symlink into the checkout runs the checkout's script, never one above the symlink", () => {
    const fixture = new Fixture();
    withScript(fixture.root);
    fixture.commit("chore: install orc");
    const deep = join(fixture.root, "sub", "deep");
    mkdirSync(deep, { recursive: true });
    // Walking the symlink's own parents as many levels as the checkout's subdirectory is deep lands on this decoy.
    const outer = withScript(tempDir());
    mkdirSync(join(outer, "x"));
    symlinkSync(deep, join(outer, "x", "lnk"));
    symlinkSync(fixture.root, join(outer, "whole"));
    for (const projectDir of [join(outer, "x", "lnk"), join(outer, "whole")]) assert.equal(hookRun(projectDir).ran, `${realpathSync(fixture.root)} ./${SCRIPT} hook\n`, projectDir);
  });

  test("a project directory whose name ends in a newline runs its own script, never its sibling's", () => {
    const base = tempDir();
    const sibling = withScript(join(base, "nl"));
    const named = join(base, "nl\n");
    mkdirSync(named);
    assert.equal(realGit(["-C", named, "init", "-q", "-b", "main"]).status, 0);
    assert.ok(existsSync(join(sibling, SCRIPT)));
    assert.equal(hookRun(named).ran, null, "no script in the repository itself, so node never starts");
    withScript(named);
    assert.equal(hookRun(named).ran, `${realpathSync(named)} ./${SCRIPT} hook\n`);
  });

  test("no node starts without the variable, outside a repository, in a bare repository or without the script", () => {
    const source = localWithTickets();
    const planted = join(new Fixture().root, "vendor", "planted");
    assert.equal(realGit(["clone", "-q", "--bare", source.root, planted]).status, 0);
    for (const [key, value] of [["core.bare", "false"], ["core.worktree", planted]] as const) assert.equal(realGit(["-C", planted, "config", key, value]).status, 0);
    withScript(planted);
    // The hook runs in the session's current directory, which may be another checkout holding a script of its own.
    const elsewhere = new Fixture();
    withScript(elsewhere.root);
    elsewhere.commit("chore: a script of its own");
    const cases: [string, string | undefined][] = [
      ["unset", undefined],
      ["empty", ""],
      ["outside a repository", withScript(tempDir())],
      ["a bare repository planted as files", planted],
      ["a repository without orc's script", new Fixture().root],
      ["a missing directory", join(tempDir(), "gone")],
    ];
    for (const [what, projectDir] of cases) {
      const result = hookRun(projectDir, elsewhere.root);
      assert.equal(result.ran, null, what);
      assert.equal(result.stdout, "", what);
      assert.ok(result.status !== 0 && result.status !== 2, `${what}: a failed step exits non-zero, never 2, which would block the call`);
    }
  });
});

describe("GitHub GraphQL parsers", () => {
  test("the queries declare only the variables they use, and fill owner and repo through -F", () => {
    const light = lightQuery({ specs: [12], prHeads: ["spec/auth"], pullRequestFacts: true });
    assert.match(light.query, /^query\(\$owner: String!, \$name: String!\) \{ repository\(owner: \$owner, name: \$name\) \{ mergeCommitAllowed defaultBranchRef \{ name \} i12: issue/);
    assert.match(light.query, /pullRequests\(first: 100, headRefName: "spec\/auth", states: \[OPEN, MERGED\]\)/);
    assert.deepEqual(light.variables, { owner: "{owner}", name: "{repo}" });
    const search = detailQuery({ partOf: [12], target: null, titleSearch: null });
    assert.match(search.query, /^query\(\$q12: String!\) \{ s12: search\(query: \$q12/);
    assert.deepEqual(search.variables, { q12: 'repo:{owner}/{repo} is:issue in:body "Part of #12"' });
  });

  test("a query answer with a failed alias keeps the rest, naming the failure", () => {
    const answer = parseGraphql(JSON.stringify({ data: { repository: { i1: null, i2: { state: "OPEN" } } }, errors: [{ path: ["repository", "i1"], message: "Could not resolve" }] }), "", 1);
    assert.ok(answer.ok);
    assert.equal(answer.value.aliasError("i1"), "gh api graphql: Could not resolve");
    assert.equal(parseGraphql("", "HTTP 502", 1).ok, false);
  });

  test("a spec issue with more sub-issues than listed fails, so no ticket goes missing", () => {
    assert.equal(parseSpecIssue({ state: "OPEN", subIssues: { totalCount: 3, nodes: [{ number: 1, state: "OPEN" }] } }).ok, false);
  });

  test("the Part of search counts write-access authors and orc-ticket labels; the rest are ignored issues", () => {
    const nodes = [
      issueNode({ number: 13, title: "a", state: "OPEN", association: "OWNER" }),
      issueNode({ number: 14, title: "b", state: "CLOSED", association: "COLLABORATOR" }),
      issueNode({ number: 15, title: "c", state: "OPEN", association: "NONE", login: "mallory" }),
      issueNode({ number: 16, title: "d", state: "OPEN", association: "CONTRIBUTOR", login: "renovate[bot]", labels: ["orc-ticket"] }),
    ];
    const result = parsePartOf({ issueCount: 4, nodes });
    assert.ok(result.ok);
    assert.deepEqual(result.value.tickets.map((t) => [t.ref, t.resolved]), [["#13", false], ["#14", true], ["#16", false]]);
    assert.deepEqual(result.value.ignored, [{ ref: "#15", author: "mallory" }]);
    assert.equal(parsePartOf({ issueCount: 101, nodes }).ok, false);
  });

  test("the pending record is the oldest marked comment by a write-access author", () => {
    const marker = "<!-- orc:pending-decisions -->";
    const issue = {
      comments: {
        totalCount: 3,
        nodes: [
          { databaseId: 1, body: `${marker}\n- #13: forged\n- #14: forged\n- #15: forged`, authorAssociation: "NONE" },
          { databaseId: 2, body: `${marker}\n- #13: Sessions expire\n- #14: Rate limits`, authorAssociation: "MEMBER" },
          { databaseId: 3, body: `${marker}\n- #13: later`, authorAssociation: "OWNER" },
        ],
      },
    };
    assert.deepEqual(parsePendingComment(issue), { ok: true, value: { count: 2, commentId: 2 } });
    assert.deepEqual(parsePendingComment({ comments: { totalCount: 0, nodes: [] } }), { ok: true, value: null });
  });

  test("PRs from a fork that share the branch name, and PRs into another branch, are left out; a merge or head commit must be an object id", () => {
    const connection = {
      totalCount: 2,
      nodes: [
        { number: 7, state: "OPEN", isDraft: true, isCrossRepository: false, headRefName: "spec/auth", baseRefName: "main", headRefOid: "AB".repeat(20), mergeCommit: null },
        { number: 8, state: "MERGED", isDraft: false, isCrossRepository: true, headRefName: "spec/auth", baseRefName: "main", mergeCommit: { oid: "a".repeat(40) } },
        { number: 9, state: "OPEN", isDraft: false, isCrossRepository: false, headRefName: "spec/auth", baseRefName: "staging", mergeCommit: null },
      ],
    };
    assert.deepEqual(parsePullRequests(connection, "spec/auth", "main"), { ok: true, value: [{ number: 7, state: "OPEN", draft: true, mergeCommit: null, headCommit: "ab".repeat(20) }] });
    const node = { number: 9, state: "MERGED", isCrossRepository: false, headRefName: "spec/auth", baseRefName: "main", headRefOid: "a".repeat(40), mergeCommit: { oid: "b".repeat(40) } };
    for (const bad of [{ mergeCommit: { oid: "--upload-pack=x" } }, { headRefOid: "--upload-pack=x" }]) {
      assert.equal(parsePullRequests({ totalCount: 1, nodes: [{ ...node, ...bad }] }, "spec/auth", "main").ok, false, JSON.stringify(bad));
    }
    assert.equal(parsePullRequests({ totalCount: 1, nodes: [node] }, "spec/auth", "main").ok, true);
  });
});

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  const registry = parseRegistry(
    registryText([
      { name: "auth", fields: ["Spec: #12"] },
      { name: "auth-extra", fields: ["Spec: .scratch/auth-extra/spec.md"] },
      { name: "cli", fields: ["Spec: .scratch/cli/spec.md"] },
      { name: "old", fields: ["Dropped: no", "Spec: #120"] },
      { name: "a-copy", fields: ["Spec: .scratch/shared/spec.md"] },
      { name: "b-copy", fields: ["Spec: .scratch/shared/spec.md"] },
    ]),
  );
  const names = (match: ReturnType<typeof resolveTarget>): string[] => (match.kind === "entry" ? [match.entry.name] : match.candidates.map((e) => e.name));

  test("matches a name, an exact issue reference or a whole path prefix", () => {
    assert.deepEqual(names(resolveTarget(registry.entries, "auth")), ["auth"]);
    assert.deepEqual(names(resolveTarget(registry.entries, "#12")), ["auth"]);
    assert.deepEqual(names(resolveTarget(registry.entries, ".scratch/cli")), ["cli"]);
  });

  test("a path prefix never crosses a name boundary, #1 never matches #12, and a dropped entry is never a target", () => {
    assert.equal(resolveTarget(registry.entries, ".scratch/auth").kind, "none");
    assert.equal(resolveTarget(registry.entries, "#1").kind, "none");
    const dropped = resolveTarget(registry.entries, "#120");
    assert.equal(dropped.kind, "dropped");
    assert.ok(!names(dropped).includes("old"));
  });

  test("a path several entries share is ambiguous, listing only those", () => {
    const match = resolveTarget(registry.entries, ".scratch/shared");
    assert.equal(match.kind, "ambiguous");
    assert.deepEqual(names(match), ["a-copy", "b-copy"]);
  });

  test("with ticket lists, a ticket reference names the entry that holds it", () => {
    const ticketsOf = (entry: { name: string }): string[] => (entry.name === "auth" ? ["#13", "#14"] : entry.name === "cli" ? ["cli/01"] : []);
    const match = resolveTarget(registry.entries, "#14", ticketsOf);
    assert.equal(match.kind, "entry");
    assert.ok(match.kind === "entry" && match.entry.name === "auth" && match.ticket === "#14");
    const local = resolveTarget(registry.entries, "cli/01", ticketsOf);
    assert.ok(local.kind === "entry" && local.entry.name === "cli" && local.ticket === "cli/01");
    assert.equal(resolveTarget(registry.entries, "cli/09", ticketsOf).kind, "none");
  });
});

// ---------------------------------------------------------------------------
// The stops every verdict judges first, in order
// ---------------------------------------------------------------------------

describe("common stops", () => {
  test("outside a git repository every command stops with not-a-repo", () => {
    const dir = tempDir();
    for (const command of ["orc", "orc-setup", "orc-build"]) {
      assert.equal(stopOf(new FixtureLess(dir).verdict([command])).reason, "not-a-repo");
    }
  });

  test("a Node below the floor stops before anything else that needs the repo", () => {
    const fixture = localWithTickets();
    const output = runStatus(["orc-build", "--json"], environment(fixture.root, runner().run, "v24.2.0"));
    const verdict = parseVerdict(output.stdout);
    assert.equal(stopOf(verdict).reason, "node");
    assert.match(stopOf(verdict).message[0] ?? "", /Node 24\.3\.0 or newer, and this is Node 24\.2\.0/);
  });

  test("no commits, then no default branch, then no config, then a bad config", () => {
    const empty = new Fixture();
    assert.equal(stopOf(empty.verdict(["orc"])).reason, "no-commits");
    const odd = new Fixture();
    odd.git("switch", "-q", "-c", "trunk");
    odd.write("a", "1").commit("init");
    assert.equal(stopOf(odd.verdict(["orc"])).reason, "no-default-branch");
    const bare = new Fixture();
    bare.write("a", "1").commit("init");
    const noConfig = stopOf(bare.verdict(["orc-tickets"]));
    assert.equal(noConfig.reason, "no-config");
    assert.equal(noConfig.next.command, "/orc-setup");
    bare.write("docs/orc/config.json", JSON.stringify({ tracker: "local" })).commit("half a config");
    const bad = stopOf(bare.verdict(["orc-build"]));
    assert.equal(bad.reason, "bad-config");
    assert.match(bad.message[0] ?? "", /profile \(missing\)/);
    assert.equal(bad.next.command, "/orc-setup");
  });

  test("a default branch name that git would read as an option is never passed to git", () => {
    const fixture = localWithTickets();
    fixture.git("update-ref", "refs/remotes/origin/--output=x", "HEAD");
    fixture.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/--output=x");
    assert.equal(goOf(fixture.verdict(["orc"]), "orc").status?.repo.defaultBranch, "main");
  });

  test("no registry stops every step command but /orc-discuss, which runs the project interview", () => {
    const fixture = new Fixture();
    fixture.vendorSkills().write("docs/orc/config.json", configText("local")).commit("setup");
    const stopped = stopOf(fixture.verdict(["orc-spec"]));
    assert.equal(stopped.reason, "no-registry");
    assert.equal(stopped.next.command, "/orc-discuss");
    assert.equal(goOf(fixture.verdict(["orc-discuss"]), "orc-discuss").mode, "project");
    const orc = goOf(fixture.verdict(["orc"]), "orc");
    assert.match(orc.report.join("\n"), /No registry yet/);
    assert.equal(orc.status?.registry, null);
    assert.equal(orc.status?.next.command, "/orc-discuss");
  });

  test("a typed target with no entry to choose from is never a pick with no candidates", () => {
    const fixture = new Fixture();
    fixture.vendorSkills().write("docs/orc/config.json", configText("local")).commit("setup");
    const noRegistry = goOf(fixture.verdict(["orc", "memo"]), "orc");
    assert.match(noRegistry.report.join("\n"), /No registry yet/);
    assert.equal(noRegistry.status?.next.command, "/orc-discuss");
    fixture.write("docs/orc/registry.md", registryText([])).commit("empty roadmap");
    for (const command of ["orc-spec", "orc-tickets", "orc-build", "orc-land"]) {
      const stopped = stopOf(fixture.verdict([command, "memo"]));
      assert.equal(stopped.reason, "state", command);
      assert.equal(stopped.next.command, "/orc-discuss", command);
    }
    assert.equal(goOf(fixture.verdict(["orc", "memo"]), "orc").status?.next.command, "/orc-discuss");
  });

  test("a registry without ## Roadmap is broken, and every ignored roadmap line stops every step command, all listed", () => {
    const fixture = new Fixture();
    fixture.vendorSkills().write("docs/orc/config.json", configText("local")).write("docs/orc/registry.md", "# Registry\n").commit("setup");
    assert.equal(stopOf(fixture.verdict(["orc-build"])).reason, "broken-registry");
    fixture.write("docs/orc/registry.md", registryText([{ name: "cli" }, { name: "Bad Name" }, { name: "cli" }])).commit("bad roadmap");
    for (const command of ["orc-next", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"]) {
      const stopped = stopOf(fixture.verdict([command]));
      assert.equal(stopped.reason, "ignored-lines", command);
      assert.match(stopped.message[0] ?? "", /line 10 not-kebab-case, line 11 duplicate-entry/);
    }
    // /orc reports them, with its Status, and holds the next step on them; /orc-setup does not stop on them.
    const go = goOf(fixture.verdict(["orc"]), "orc");
    assert.match(go.report.join("\n"), /line 10 not-kebab-case, line 11 duplicate-entry/);
    assert.equal(go.status?.next.kind, "manual");
    assert.deepEqual(go.status?.registry?.problems.filter((p) => p.ignoresEntry).map((p) => p.line), [10, 11]);
    assert.deepEqual(go.status?.entries.map((e) => e.name), ["cli"]);
    assert.equal(fixture.verdict(["orc-setup"], runner(fakeGh({})).run).outcome.kind, "go");
  });

  test("gh missing or logged out stops every GitHub step command before its target resolves", () => {
    const fixture = githubRepo();
    for (const gh of [GH_MISSING, GH_LOGGED_OUT]) {
      for (const command of ["orc-next", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"]) {
        assert.equal(stopOf(fixture.verdict([command, "nope"], runner(() => gh).run)).reason, "gh", command);
      }
    }
    // With gh working, the same target that matches no entry is a pick for every command that resolves one.
    for (const command of ["orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"]) {
      assert.equal(fixture.verdict([command, "nope"], runner(fakeGh({})).run).outcome.kind, "pick", command);
    }
    // /orc reports instead: the state is unknown, never zero tickets.
    const status = fixture.status(runner(() => GH_MISSING).run);
    assert.equal(stateOf(status, "auth"), "unknown");
    assert.equal(status.next.kind, "manual");
  });

  test("a registry, config or lock file that exists but cannot be read stops; it is never read as missing", () => {
    const unreadable = (fixture: Fixture, path: string): void => chmodSync(join(fixture.root, path), 0o000);
    const registry = localWithTickets();
    unreadable(registry, "docs/orc/registry.md");
    const discuss = stopOf(registry.verdict(["orc-discuss"]));
    assert.equal(discuss.reason, "error");
    assert.match(discuss.message[0] ?? "", /docs\/orc\/registry\.md exists but could not be read/);
    assert.ok(discuss.error, "the reason is data in --json");
    assert.match(goOf(registry.verdict(["orc"]), "orc").report.join("\n"), /docs\/orc\/registry\.md exists but could not be read/);
    assert.match(registry.text(["registry", "REQ-01"]), /^orc lookup error: docs\/orc\/registry\.md exists but could not be read/);
    const setupRun = runner(fakeGh({})).run;
    assert.equal(stopOf(registry.verdict(["orc-setup"], setupRun)).reason, "error", "an update never judges the tracker unlocked over it");

    const directory = localWithTickets();
    rmSync(join(directory.root, "docs/orc/registry.md"));
    mkdirSync(join(directory.root, "docs/orc/registry.md"));
    assert.match(stopOf(directory.verdict(["orc-discuss"])).message[0] ?? "", /registry\.md exists but could not be read/);

    const config = localWithTickets();
    unreadable(config, "docs/orc/config.json");
    assert.equal(stopOf(config.verdict(["orc-setup"], setupRun)).reason, "error", "never a first run over it");
    assert.equal(stopOf(config.verdict(["orc"])).reason, "error");

    const lock = localWithTickets();
    unreadable(lock, "skills-lock.json");
    assert.match(stopOf(lock.verdict(["orc-build"])).message[0] ?? "", /skills-lock\.json exists but could not be read/);
    assert.equal(stopOf(lock.verdict(["orc-setup"], setupRun)).reason, "error");
  });

  test("on a spec branch, a doc the default branch holds as a directory is unreadable, never missing", () => {
    const fixture = localWithTickets();
    fixture.git("rm", "-q", "docs/orc/registry.md");
    fixture.write("docs/orc/registry.md/x", "x").commit("break the registry");
    fixture.git("switch", "-q", "-c", "spec/cli");
    assert.equal(stopOf(fixture.verdict(["orc-discuss"])).reason, "error");
  });

  test("an unreadable local tickets folder or ticket file makes the entry unknown, never ticketless", () => {
    const fixture = localWithTickets();
    chmodSync(join(fixture.root, ".scratch/cli/issues/02-ticket.md"), 0o000);
    assert.equal(stateOf(fixture.status(), "cli"), "unknown");
    chmodSync(join(fixture.root, ".scratch/cli/issues/02-ticket.md"), 0o644);
    chmodSync(join(fixture.root, ".scratch/cli/issues"), 0o000);
    try {
      assert.equal(stateOf(fixture.status(), "cli"), "unknown");
      assert.equal(stopOf(fixture.verdict(["orc-tickets"])).reason, "lookup-failed");
    } finally {
      chmodSync(join(fixture.root, ".scratch/cli/issues"), 0o755);
    }
  });

  test("a gh timeout is a failed lookup, and no further gh call waits for it", () => {
    const fixture = githubRepo();
    const timedOut = { status: TIMED_OUT, stdout: "", stderr: "gh did not answer within 20 s" };
    const { run, ghCalls } = runner(() => timedOut);
    const stopped = stopOf(fixture.verdict(["orc-build"], run));
    assert.equal(stopped.reason, "lookup-failed");
    assert.match(stopped.error ?? "", /did not answer within 20 s/);
    assert.equal(ghCalls.length, 1);
    const orc = runner(() => timedOut);
    assert.equal(stateOf(fixture.status(orc.run), "auth"), "unknown");
    assert.equal(orc.ghCalls.length, 1);
  });

  test("a git timeout is an error stop, never a fact", () => {
    const fixture = localWithTickets();
    const slow: Runner = (_program, args) => (args.includes("worktree") ? { status: TIMED_OUT, stdout: "", stderr: "git did not answer within 45 s" } : realGit(args));
    const stopped = stopOf(fixture.verdict(["orc-build"], slow));
    assert.equal(stopped.reason, "error");
    assert.match(stopped.error ?? "", /did not answer within 45 s/);
  });

  test("/orc says when gh is missing, logged out or failing, and its pointer names the fix", () => {
    const fixture = githubRepo();
    const cases: [ReturnType<typeof runner>["run"], string, RegExp][] = [
      [runner(() => GH_MISSING).run, "not-installed", /after installing gh and running gh auth login/],
      [runner(() => GH_LOGGED_OUT).run, "not-authenticated", /after gh auth login/],
      [runner(() => ({ status: 1, stdout: "not json", stderr: "HTTP 502" })).run, "failed", /after the GitHub lookup works again/],
    ];
    for (const [run, state, reason] of cases) {
      const go = goOf(fixture.verdict(["orc"], run), "orc");
      assert.ok(go.report.includes(`Gh: ${state}, and this repo's tracker or landing mode needs it`), state);
      assert.equal(go.status?.repo.gh, state);
      assert.equal(go.status?.next.command, "/orc-next");
      assert.match(go.status?.next.reason ?? "", reason);
      assert.match(go.report.at(-1) ?? "", /^Done\. Next: \/orc-next /);
    }
    // A local tracker with no PR landing never asks gh about itself.
    const local = runner();
    assert.doesNotMatch(goOf(localWithTickets().verdict(["orc"], local.run), "orc").report.join("\n"), /^Gh:/m);
    assert.deepEqual(local.ghCalls, []);
  });

  test("a pointer to wait or to fix something by hand never names the command that gives it", () => {
    const pointers: [string, string, string][] = [];
    const collect = (verdict: Verdict): void => {
      const command = verdict.command ?? "none";
      const outcome = verdict.outcome;
      if (outcome.kind === "stop") pointers.push([command, outcome.next.kind, outcome.next.command]);
      if (outcome.kind === "go" && outcome.for === "orc" && outcome.status) pointers.push([command, outcome.status.next.kind, outcome.status.next.command]);
      if (outcome.kind === "go" && outcome.for === "orc-next") collect(outcome.verdict);
    };
    const all = ["orc", "orc-next", "orc-setup", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"];
    const judgeAll = (fixture: Fixture, run: Runner = runner(fakeGh({})).run, cwd = fixture.root): void => {
      for (const command of all) collect(fixture.verdict([command], run, cwd));
    };
    const dirty = builtCli(localWithTickets());
    dirty.write(".scratch/cli/issues/01-ticket.md", "changed");
    judgeAll(dirty);
    const offDefault = localWithTickets();
    offDefault.git("switch", "-q", "-c", "elsewhere");
    judgeAll(offDefault);
    const sub = join(offDefault.root, "sub");
    mkdirSync(sub);
    judgeAll(offDefault, runner(fakeGh({})).run, sub);
    judgeAll(githubRepo(), runner(() => GH_MISSING).run);
    const broken = new Fixture();
    broken.vendorSkills().write("docs/orc/config.json", configText("local")).write("docs/orc/registry.md", "# Registry\n").commit("setup");
    judgeAll(broken);
    const squashed = builtCli(localWithTickets());
    squashed.write("src/a.js", "1").write("src/b.js", "2").write("src/c.js", "3").commit("feat: squashed", "cli/01", "cli/02", "cli/03");
    judgeAll(squashed);
    const waiting = builtCli(localWithTickets("pr-human"));
    waiting.git("remote", "add", "origin", "https://github.com/example/repo.git");
    waiting.git("update-ref", "refs/remotes/origin/spec/cli", "spec/cli");
    judgeAll(waiting, runner(fakeGh({ prs: [{ number: 7, state: "OPEN", headRefName: "spec/cli", mergeCommit: null }] })).run);
    assert.equal(pointers.length, 39, "the pointers judged");
    assert.ok(pointers.some(([, kind]) => kind === "wait"));
    const self = pointers.filter(([command, kind, next]) => kind !== "run" && next.split(" ")[0] === `/${command}`);
    assert.deepEqual(self, []);
  });

  test("a usage error is a stop of kind usage, with no banner when no command was named", () => {
    const fixture = localWithTickets();
    const verdict = fixture.verdict(["orc-build", "a", "b"]);
    assert.equal(stopOf(verdict).reason, "usage");
    assert.equal(verdict.command, "orc-build");
    const none = parseVerdict(fixture.text(["nonsense", "--json"]));
    assert.equal(none.command, null);
    assert.deepEqual(none.banner, []);
  });

  test("a runner that throws becomes a stop of kind error, its text in --json only", () => {
    const fixture = localWithTickets();
    const throwing: Runner = (_program, args) => {
      if (args.includes("for-each-ref")) throw new Error("SECRET-ERROR-TEXT");
      return realGit(args);
    };
    const verdict = fixture.verdict(["orc"], throwing);
    assert.equal(stopOf(verdict).reason, "error");
    assert.equal(stopOf(verdict).error, "SECRET-ERROR-TEXT");
    assert.doesNotMatch(fixture.text(["orc"], throwing), /SECRET-ERROR-TEXT/);
  });
});

// ---------------------------------------------------------------------------
// Entry states and the /orc report (local tracker)
// ---------------------------------------------------------------------------

describe("entry states, local tracker", () => {
  test("not started, then discussed, skipping dropped entries", () => {
    const fixture = new Fixture().setUp("local", [{ name: "gone", fields: ["Dropped: no"] }, { name: "cli" }, { name: "later", fields: ["Landing: local-merge"] }]);
    const status = fixture.status();
    assert.deepEqual(status.entries.map((e) => e.state), ["dropped", "not-started", "discussed"]);
    assert.deepEqual(status.next, { command: "/orc-discuss cli", reason: "spec interview for cli", kind: "run" });
  });

  test("ticketed: the frontier is ready and the rest blocked, and no PR lookup without a PR mode", () => {
    const { run, ghCalls } = runner();
    const status = localWithTickets().status(run);
    assert.equal(stateOf(status, "cli"), "ticketed");
    assert.deepEqual(status.target?.tickets.map((t) => [t.ref, t.progress, t.waitingOn]), [
      ["cli/01", "ready", []],
      ["cli/02", "blocked", ["cli/01"]],
      ["cli/03", "blocked", ["cli/01", "cli/02"]],
    ]);
    assert.deepEqual(status.next, { command: "/orc-build cli", reason: "3 of 3 tickets to build; start it after /clear", kind: "run" });
    assert.deepEqual(ghCalls, []);
  });

  test("building: a built ticket, an in-progress agent branch, an untrailed commit and a record commit", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
    const untrailed = fixture.write("src/x.js", "x").commit("chore: stray");
    fixture.write(".scratch/cli/notes/n.md", "n").commit("docs: notes");
    fixture.git("switch", "-q", "-c", "worktree-agent-abc");
    fixture.write("src/b.js", "2").commit("feat: version", "cli/02");
    fixture.git("switch", "-q", "main");
    const status = fixture.status();
    assert.equal(stateOf(status, "cli"), "building");
    assert.deepEqual(status.target?.tickets.map((t) => t.progress), ["built", "in-progress", "blocked"]);
    assert.deepEqual(status.target?.untrailedCommits, [untrailed.slice(0, 7)]);
    assert.deepEqual(status.repo.agentBranches, [{ name: "worktree-agent-abc", unmerged: 1, tickets: ["cli/02"] }]);
    assert.equal(status.next.reason, "2 of 3 tickets to build on spec/cli; start it after /clear");
  });

  test("a whole-value trailer match: cli/0 and cli/011 never count as cli/01", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.commit("feat: near miss", "cli/0", "cli/011");
    fixture.git("switch", "-q", "main");
    assert.equal(stateOf(fixture.status(), "cli"), "ticketed");
  });

  test("Status: built is display only: a ticket marked built without its trailer is not built", () => {
    const fixture = localWithTickets();
    fixture.write(".scratch/cli/issues/01-ticket.md", "# 01: Skeleton\n\nStatus: built\n").commit("docs: mark built");
    const status = fixture.status();
    assert.equal(stateOf(status, "cli"), "ticketed");
    // The spec file has no Status: line, so only the tickets count as unresolved; built is never resolved.
    assert.deepEqual(status.target?.unresolved, ["cli/01", "cli/02", "cli/03"]);
  });

  test("built, then landed: tickets resolve, the merged branch is a note, and the focus moves on", () => {
    const fixture = builtCli(localWithTickets());
    assert.equal(stateOf(fixture.status(), "cli"), "built");
    assert.deepEqual(fixture.status().next, { command: "/orc-land cli", reason: "every ticket is built; landing mode local-merge", kind: "run" });
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    let status = fixture.status();
    assert.equal(stateOf(status, "cli"), "cleanup-pending");
    assert.equal(status.next.command, "/orc-land cli");
    resolveLocal(fixture);
    fixture.commit("docs: resolve cli tickets");
    status = fixture.status();
    assert.equal(stateOf(status, "cli"), "landed");
    assert.deepEqual(status.entries[0]?.notes, [{ kind: "leftover-branch", ref: "spec/cli", unmerged: 0 }]);
    assert.equal(status.next.command, "/orc-discuss later");
  });

  test("landed needs the spec branch's own ticket commits as ancestors: a squash is caught with no remote and no PR", () => {
    const fixture = builtCli(localWithTickets());
    fixture.write("src/a.js", "1").write("src/b.js", "2").write("src/c.js", "3").commit("feat: cli (squashed)", "cli/01", "cli/02", "cli/03");
    const status = fixture.status();
    assert.equal(stateOf(status, "cli"), "squashed");
    assert.equal(status.next.kind, "manual");
    assert.equal(stopOf(fixture.verdict(["orc-land"])).reason, "state");
  });

  test("a ticket added after landing reads as a new open ticket, and the next step is /orc-build", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    fixture.git("branch", "-q", "-d", "spec/cli");
    fixture.localTicket("cli", "04", "Late addition").commit("docs: add cli ticket 04");
    const status = fixture.status();
    assert.equal(stateOf(status, "cli"), "building");
    assert.deepEqual(status.target?.tickets.map((t) => t.progress), ["landed", "landed", "landed", "ready"]);
    // The branch is gone, so the reason names no spec branch.
    assert.deepEqual(status.next, { command: "/orc-build cli", reason: "1 of 4 tickets to build; start it after /clear", kind: "run" });
    const build = goOf(fixture.verdict(["orc-build"]), "orc-build");
    assert.deepEqual(build.toBuild.map((t) => t.ref), ["cli/04"]);
    assert.deepEqual(build.landed, ["cli/01", "cli/02", "cli/03"]);
    assert.equal(build.branch, "create");
  });

  test("a spec branch that exists only on origin counts for built and is restored", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("update-ref", "refs/remotes/origin/spec/cli", "spec/cli");
    fixture.git("branch", "-q", "-D", "spec/cli");
    const status = fixture.status();
    assert.equal(stateOf(status, "cli"), "built");
    assert.deepEqual(status.target?.branch, { name: "spec/cli", local: false, remote: true, ahead: null, behind: null, behindDefault: 0 });
  });

  test("from a spec branch the docs come from the default branch tip, and /orc says so", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.git("switch", "-q", "main");
    fixture.localTicket("cli", "04", "Late").commit("docs: add cli ticket 04");
    fixture.git("switch", "-q", "spec/cli");
    const verdict = fixture.verdict(["orc"]);
    const go = goOf(verdict, "orc");
    assert.equal(go.status?.repo.docsFrom, "main");
    assert.equal(go.status?.target?.tickets.length, 4);
    assert.match(go.report[0] ?? "", /^Docs: the default branch tip, since HEAD is off the default branch$/);
  });

  test("unpushed default-branch commits are reported with their count", () => {
    const fixture = localWithTickets();
    fixture.git("update-ref", "refs/remotes/origin/main", "HEAD~1");
    fixture.git("remote", "add", "origin", "/nowhere");
    const status = fixture.status();
    assert.equal(status.repo.ahead, 1);
    assert.match(goOf(fixture.verdict(["orc"]), "orc").report.join("\n"), /Unpushed: 1 commit on the default branch that origin's lacks/);
  });

  test("/orc names leftover implementer worktrees, the locked ones counted, and where they are cleared", () => {
    const fixture = builtCli(localWithTickets());
    const dead = join(fixture.root, ".claude", "worktrees", "agent-dead");
    fixture.git("worktree", "add", "-q", dead, "-b", "worktree-agent-dead", "spec/cli");
    fixture.git("worktree", "lock", "--reason", "claude agent agent-dead (pid 99999)", dead);
    const report = goOf(fixture.verdict(["orc"]), "orc").report;
    assert.ok(report.includes("Worktrees left behind: 1, 1 locked: the cleanup of /orc-build or /orc-land shows each with its files before removing it"), report.join("\n"));
  });

  test("a landed entry with tracker items open is /orc's focus, which names it, and the first choice of a bare /orc-land", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    fixture.git("branch", "-q", "-d", "spec/cli");
    const status = fixture.status();
    assert.equal(status.target?.name, "cli");
    assert.equal(status.next.command, "/orc-land cli");
    const pick = pickOf(fixture.verdict(["orc-land"]));
    assert.deepEqual([pick.why, pick.candidates.map((c) => c.name), pick.leftover], ["leftovers", ["cli", "later"], { branches: [], unresolved: ["cli/01", "cli/02", "cli/03"] }]);
    const land = goOf(fixture.verdict(["orc-land", "cli"]), "orc-land");
    assert.equal(land.phase, "cleanup");
    assert.deepEqual(land.unresolved, ["cli/01", "cli/02", "cli/03"]);
  });

  test("a Spec: path that leaves the repo is never read: the entry is unknown and step commands stop", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge", "Spec: ../../etc/passwd"] }]);
    assert.equal(stateOf(fixture.status(), "cli"), "unknown");
    assert.equal(stopOf(fixture.verdict(["orc-build"])).reason, "lookup-failed");
  });

  test("the pending record on the spec branch is counted from there, and a built entry locks it first", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("switch", "-q", "spec/cli");
    fixture.write(".scratch/cli/pending-decisions.md", "<!-- orc:pending-decisions -->\n- cli/02: Sessions expire\n- cli/03: Per account\n").commit("docs: record cli pending decisions");
    fixture.git("switch", "-q", "main");
    const status = fixture.status();
    assert.deepEqual(status.target?.pending, { count: 2, ref: "spec/cli", path: ".scratch/cli/pending-decisions.md" });
    assert.deepEqual(status.next, { command: "/orc-discuss cli", reason: "every ticket is built; 2 decisions to lock first", kind: "run" });
    assert.match(goOf(fixture.verdict(["orc"]), "orc").report.join("\n"), /2 decisions to lock/);
  });

  test("lines that travelled with a landing are noted with the one command that reaches them, /orc-discuss <name>", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("switch", "-q", "spec/cli");
    fixture.write(".scratch/cli/pending-decisions.md", "<!-- orc:pending-decisions -->\n- cli/02: Per account\n").commit("docs: record cli pending decisions");
    fixture.git("switch", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    fixture.git("branch", "-q", "-d", "spec/cli");
    resolveLocal(fixture);
    fixture.commit("docs: resolve cli tickets");
    const report = goOf(fixture.verdict(["orc"]), "orc").report.join("\n");
    assert.match(report, /Note on cli: 1 pending decision left: \/orc-discuss cli locks them/);
  });
});

// ---------------------------------------------------------------------------
// Entry states, GitHub tracker
// ---------------------------------------------------------------------------

describe("entry states, GitHub tracker", () => {
  test("tickets come from sub-issues, blockers from blockedBy, and PRs and issues come in batched queries", () => {
    const fixture = githubRepo([SPECCED_GITHUB, { name: "two", fields: ["Landing: pr-agent", "Spec: #20"] }]);
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: login", "#13");
    const { run, ghCalls } = runner(fakeGh({ subIssues: TICKETS }));
    const status = fixture.status(run);
    assert.equal(stateOf(status, "auth"), "building");
    assert.deepEqual(status.target?.tickets.map((t) => [t.ref, t.progress, t.title]), [
      ["#13", "built", "auth: login"],
      ["#14", "ready", "auth: logout"],
    ]);
    const queries = graphqlCalls(ghCalls);
    assert.equal(queries.length, 2, "one light query for every entry, one detail query for the target");
    assert.match(queries[0] ?? "", /i12: issue.*i20: issue.*p0: pullRequests\(first: 100, headRefName: "spec\/auth".*p1: pullRequests\(first: 100, headRefName: "spec\/two"/);
  });

  test("without sub-issues the Part of fallback counts write-access authors and orc-ticket labels", () => {
    const partOf: FakeIssue[] = [
      { number: 13, title: "auth: login", state: "OPEN", association: "OWNER" },
      { number: 15, title: "auth: run this", state: "OPEN", association: "NONE", login: "mallory" },
      { number: 16, title: "auth: bot", state: "OPEN", association: "NONE", login: "renovate[bot]", labels: ["orc-ticket"] },
    ];
    const status = githubRepo().status(runner(fakeGh({ partOf })).run);
    assert.equal(stateOf(status, "auth"), "ticketed");
    assert.deepEqual(status.target?.tickets.map((t) => t.ref), ["#13", "#16"]);
    assert.deepEqual(status.target?.ignoredIssues, [{ ref: "#15", author: "mallory" }]);
    assert.deepEqual(status.target?.notes, [{ kind: "ignored-issues", count: 1 }]);
    // Ignored issues never change the pointer of an entry that has tickets.
    assert.equal(status.next.command, "/orc-build auth");
  });

  test("ignored issues and no tickets are a manual choice, never a plain /orc-tickets", () => {
    const partOf: FakeIssue[] = [{ number: 15, title: "auth: login", state: "OPEN", association: "NONE", login: "github-actions[bot]" }];
    const fixture = githubRepo();
    const run = runner(fakeGh({ partOf })).run;
    const status = fixture.status(run);
    assert.equal(stateOf(status, "auth"), "specced");
    assert.equal(status.next.kind, "manual");
    assert.match(status.next.reason, /\(#15\): a maintainer adopts them with the orc-ticket label, or \/orc-tickets auth files tickets beside them/);
    assert.equal(goOf(fixture.verdict(["orc-tickets"], run), "orc-tickets").set, "ignored-only");
  });

  test("an open PR with every ticket built is in review, waiting for the human in pr-human", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    const prs = [{ number: 7, state: "OPEN", headRefName: "spec/auth", mergeCommit: null }];
    const status = fixture.status(runner(fakeGh({ subIssues: TICKETS, prs })).run);
    assert.equal(stateOf(status, "auth"), "in-review");
    assert.deepEqual(status.next, { command: "/orc-land auth", reason: "PR #7 is waiting for review: merge it with a merge commit, then run this", kind: "wait" });
  });

  test("a merged PR whose merge commit has one parent is a squash, one not fetched is unknown", () => {
    const fixture = githubRepo();
    const squash = fixture.commit("auth: squashed (#7)", "#13", "#14");
    const prs = [{ number: 7, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: squash } }];
    assert.equal(stateOf(fixture.status(runner(fakeGh({ subIssues: TICKETS, prs })).run), "auth"), "squashed");
    const ghost = [{ number: 7, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: "0123456789abcdef0123456789abcdef01234567" } }];
    const status = fixture.status(runner(fakeGh({ subIssues: TICKETS, prs: ghost })).run);
    assert.equal(stateOf(status, "auth"), "unknown");
    assert.deepEqual([status.next.command, status.next.kind], ["/orc-land auth", "run"]);
    assert.match(status.next.reason, /PR #7 is merged and its merge commit is not fetched yet: \/orc-land fetches it/);
    const land = fixture.verdict(["orc-land", "auth"], runner(fakeGh({ subIssues: TICKETS, prs: ghost })).run);
    assert.equal(land.origin, true, "the stop says the repo has an origin, so the run fetches before it acts on it");
    assert.equal(stopOf(land).next.command, "/orc-land auth");
  });

  test("PRs are judged against GitHub's own default branch: an origin/HEAD that names another makes the entry unknown", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    fixture.git("switch", "-q", "main");
    const open = (base: string) => [{ number: 7, state: "OPEN", headRefName: "spec/auth", mergeCommit: null, baseRefName: base }];
    const renamed = runner(fakeGh({ subIssues: TICKETS, prs: open("trunk-MARKER"), defaultBranch: "trunk-MARKER" })).run;
    const status = fixture.status(renamed);
    assert.equal(stateOf(status, "auth"), "unknown");
    assert.deepEqual(status.next, {
      command: "/orc-next",
      reason: "after fixing what kept auth from being read: origin/HEAD names another branch than GitHub's default branch, which git remote set-head origin -a updates",
      kind: "manual",
    });
    assert.doesNotMatch(fixture.text(["orc"], renamed), /MARKER/);
    assert.equal(stopOf(fixture.verdict(["orc-land", "auth"], renamed)).reason, "lookup-failed");
    const same = runner(fakeGh({ subIssues: TICKETS, prs: open("main") })).run;
    assert.equal(stateOf(fixture.status(same), "auth"), "in-review");
  });

  test("a PR belongs to the spec branch as it is now: an earlier landing under the same name and a closed PR are left out", () => {
    const fixture = githubRepo();
    // An earlier use of spec/auth landed with a merge commit, and another with a squash, before the branch was cut again.
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.write("old.js", "1").commit("feat: old work", "#5");
    fixture.git("switch", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/auth");
    const oldMerge = fixture.git("rev-parse", "HEAD");
    fixture.git("branch", "-q", "-D", "spec/auth");
    const oldSquash = fixture.write("older.js", "1").commit("auth: squashed (#4)", "#3");
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    fixture.git("switch", "-q", "main");
    // #28's head is the old branch's tip, a side parent of its merge; #4's head was never fetched, so its squash on the branch decides.
    const stale = [
      { number: 4, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: oldSquash } },
      { number: 28, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: oldMerge }, headRefOid: fixture.git("rev-parse", `${oldMerge}^2`) },
      { number: 30, state: "CLOSED", headRefName: "spec/auth", mergeCommit: null },
    ];
    const run = runner(fakeGh({ subIssues: TICKETS, prs: stale })).run;
    assert.equal(stateOf(fixture.status(run), "auth"), "built");
    assert.equal(goOf(fixture.verdict(["orc-land", "auth"], run), "orc-land").pr, null);
    // origin's spec branch alone is asked the same way when the local one is gone.
    const tip = fixture.git("rev-parse", "spec/auth");
    fixture.git("update-ref", "refs/remotes/origin/spec/auth", tip);
    fixture.git("branch", "-q", "-D", "spec/auth");
    assert.equal(stateOf(fixture.status(run), "auth"), "built");
    assert.equal(goOf(fixture.verdict(["orc-land", "auth"], run), "orc-land").pr, null);
    fixture.git("branch", "-q", "spec/auth", tip);
    fixture.git("update-ref", "-d", "refs/remotes/origin/spec/auth");
    // The branch as it is now merged by a PR: that one counts, and with the branch still there the entry is cleanup.
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/auth");
    const merge = fixture.git("rev-parse", "HEAD");
    const landed = runner(fakeGh({ subIssues: TICKETS, prs: [...stale, { number: 31, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: merge }, headRefOid: tip }] })).run;
    assert.equal(stateOf(fixture.status(landed), "auth"), "cleanup-pending");
    assert.deepEqual(goOf(fixture.verdict(["orc-land", "auth"], landed), "orc-land").pr, { number: 31, state: "MERGED", draft: false });
  });

  test("a squash-landed PR stays the branch's own after the default branch is merged back into it", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: one", "#13");
    const behind = fixture.git("rev-parse", "HEAD");
    fixture.commit("feat: two", "#14");
    const head = fixture.git("rev-parse", "HEAD");
    fixture.git("switch", "-q", "main");
    fixture.git("merge", "-q", "--squash", "spec/auth");
    const squash = fixture.commit("auth: squashed (#31)");
    const squashed = (headRefOid: string) => runner(fakeGh({ subIssues: TICKETS, prs: [{ number: 31, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: squash }, headRefOid }] })).run;
    assert.equal(stateOf(fixture.status(squashed(head)), "auth"), "squashed");
    // The branch here is still behind the head that was pushed and landed from another clone: the PR is still its own.
    fixture.git("branch", "-q", "-f", "spec/auth", behind);
    assert.equal(stateOf(fixture.status(squashed(head)), "auth"), "squashed");
    assert.equal(stateOf(fixture.status(squashed(UNFETCHED_HEAD)), "auth"), "squashed", "a head never fetched leaves the squash, which the branch does not hold, as the branch's");
    fixture.git("branch", "-q", "-f", "spec/auth", head);
    // The default branch merged into the spec branch brings the squash along, while the head stays on the branch's first-parent history.
    fixture.git("switch", "-q", "spec/auth");
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "main");
    fixture.git("switch", "-q", "main");
    const run = squashed(head);
    assert.equal(stateOf(fixture.status(run), "auth"), "squashed");
    assert.match(stopOf(fixture.verdict(["orc-land", "auth"], run)).message.join(" "), /auth is squashed, and only a built entry lands/);
  });

  test("an earlier use's merged PR is left out even when the branch was cut from a default branch from before its merge", () => {
    const fixture = githubRepo();
    const before = fixture.git("rev-parse", "HEAD");
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.write("old.js", "1").commit("feat: old work", "#5");
    const oldHead = fixture.git("rev-parse", "HEAD");
    fixture.git("switch", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/auth");
    const oldMerge = fixture.git("rev-parse", "HEAD");
    fixture.git("branch", "-q", "-D", "spec/auth");
    fixture.git("switch", "-q", "-c", "spec/auth", before);
    fixture.commit("feat: both", "#13", "#14");
    fixture.git("switch", "-q", "main");
    const run = runner(fakeGh({ subIssues: TICKETS, prs: [{ number: 28, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: oldMerge }, headRefOid: oldHead }] })).run;
    assert.equal(stateOf(fixture.status(run), "auth"), "built");
    assert.equal(goOf(fixture.verdict(["orc-land", "auth"], run), "orc-land").pr, null);
  });

  test("a real merge lands the entry; open issues are cleanup until they close", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    fixture.git("switch", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/auth");
    fixture.git("branch", "-q", "-d", "spec/auth");
    const merge = fixture.git("rev-parse", "HEAD");
    const prs = [{ number: 7, state: "MERGED", headRefName: "spec/auth", mergeCommit: { oid: merge } }];
    let status = fixture.status(runner(fakeGh({ subIssues: TICKETS, prs })).run);
    const closedBefore = { number: 6, state: "CLOSED", headRefName: "spec/auth", mergeCommit: null };
    const cleanup = fixture.verdict(["orc-land", "auth"], runner(fakeGh({ subIssues: TICKETS, prs: [closedBefore, ...prs] })).run);
    assert.equal(goOf(cleanup, "orc-land").pr?.number, 7, "the cleanup names the PR that landed the entry, not one closed before it");
    assert.equal(stateOf(status, "auth"), "cleanup-pending");
    assert.deepEqual(status.target?.unresolved, ["#12", "#13", "#14"]);
    const closed = TICKETS.map((t) => ({ ...t, state: "CLOSED" }));
    status = fixture.status(runner(fakeGh({ specState: "CLOSED", subIssues: closed, prs })).run);
    assert.equal(stateOf(status, "auth"), "landed");
    assert.equal(status.next.command, "/orc-discuss next");
  });

  test("a whole-value trailer match on GitHub: Refs: #12 never builds ticket #1", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: near miss", "#12", "#130");
    const tickets = [
      { number: 1, title: "auth: one", state: "OPEN" },
      { number: 13, title: "auth: thirteen", state: "OPEN" },
    ];
    assert.equal(stateOf(fixture.status(runner(fakeGh({ subIssues: tickets })).run), "auth"), "ticketed");
  });

  test("every list is read to its end, page by page: sub-issues, blockers, comments, PRs and the Part of search", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: all", "#13", "#14", "#15");
    fixture.git("switch", "-q", "main");
    const tickets: FakeIssue[] = [...TICKETS, { number: 15, title: "auth: three", state: "OPEN", blockedBy: [13, 14] }];
    const comments = [
      { id: 1, body: "just talk", association: "OWNER" },
      { id: 2, body: "<!-- orc:pending-decisions -->\n- #13: a\n- #14: b", association: "OWNER" },
    ];
    const prs = [
      { number: 5, state: "CLOSED", headRefName: "spec/auth", mergeCommit: null },
      { number: 6, state: "OPEN", headRefName: "spec/auth", mergeCommit: null, isDraft: true },
      { number: 7, state: "OPEN", headRefName: "spec/auth", mergeCommit: null },
    ];
    const { run, ghCalls } = runner(fakeGh({ subIssues: tickets, comments, prs, pageSize: 1 }));
    const status = fixture.status(run);
    assert.equal(stateOf(status, "auth"), "in-review");
    assert.deepEqual(status.target?.tickets.map((t) => [t.ref, t.blockers]), [["#13", []], ["#14", ["#13"]], ["#15", ["#13", "#14"]]]);
    assert.deepEqual(status.target?.pending, { count: 2, commentId: 2 });
    assert.deepEqual(status.target?.prs?.map((pr) => pr.number), [6, 7]);
    assert.ok(graphqlCalls(ghCalls).some((q) => q.includes("after: $cursor")));

    const partOf: FakeIssue[] = [13, 14, 15].map((number) => ({ number, title: `auth: ${number}`, state: "OPEN" }));
    assert.deepEqual(githubRepo().status(runner(fakeGh({ partOf, pageSize: 1 })).run).target?.tickets.map((t) => t.ref), ["#13", "#14", "#15"]);
  });

  test("a list that cannot be read to its end is unknown: a search past GitHub's limit, a connection with no next page", () => {
    const partOf: FakeIssue[] = [{ number: 13, title: "auth: one", state: "OPEN" }];
    assert.equal(stateOf(githubRepo().status(runner(fakeGh({ partOf, partOfCount: 1500 })).run), "auth"), "unknown");
    const unpaged = withoutPageInfo(fakeGh({ subIssues: [...TICKETS, { number: 15, title: "auth: three", state: "OPEN" }], pageSize: 2 }));
    assert.equal(stateOf(githubRepo().status(runner(unpaged).run), "auth"), "unknown");
  });

  test("a failed pending lookup is unknown: /orc never points at /orc-land and /orc-land never goes with Pending: 0", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    fixture.git("switch", "-q", "main");
    const chatter = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, body: "chatter", association: "OWNER" }));
    const cut = (comments: { id: number; body: string; association: string }[]) => runner(withoutPageInfo(fakeGh({ subIssues: TICKETS, comments, pageSize: 2 }))).run;
    const status = fixture.status(cut([...chatter, { id: 9, body: "<!-- orc:pending-decisions -->\n- #13: a", association: "OWNER" }]));
    assert.equal(stateOf(status, "auth"), "unknown");
    assert.equal(status.next.kind, "manual");
    assert.equal(stopOf(fixture.verdict(["orc-land"], cut(chatter))).reason, "lookup-failed");
    assert.equal(stopOf(fixture.verdict(["orc-discuss", "auth"], cut(chatter))).reason, "lookup-failed");
    // Comments come oldest first, so a record among those listed is the record even when the list is cut short.
    const early = cut([{ id: 9, body: "<!-- orc:pending-decisions -->\n- #13: a", association: "OWNER" }, ...chatter]);
    assert.deepEqual(goOf(fixture.verdict(["orc-land"], early), "orc-land").pending, 1);
  });

  test("a failed blocker lookup is unknown, never a ticket with no blockers", () => {
    const fixture = githubRepo();
    const tickets: FakeIssue[] = [...TICKETS, { number: 15, title: "auth: three", state: "OPEN", blockedBy: [13, 14] }];
    const run = runner(withoutPageInfo(fakeGh({ subIssues: tickets, pageSize: 3 })));
    // The first page holds all three tickets, but #15's blockers arrive one short of their count.
    const blockersCut = runner((args) => {
      const answer = fakeGh({ subIssues: tickets })(args);
      if (answer === undefined || !answer.stdout.includes('"number":15')) return answer;
      return { ...answer, stdout: answer.stdout.replace('"blockedBy":{"totalCount":2,"pageInfo":{"hasNextPage":false,"endCursor":"2"},"nodes":[{"number":13},{"number":14}]}', '"blockedBy":{"totalCount":2,"pageInfo":{"hasNextPage":false,"endCursor":"1"},"nodes":[{"number":13}]}') };
    });
    assert.equal(stopOf(fixture.verdict(["orc-build", "#15"], blockersCut.run)).reason, "lookup-failed");
    assert.equal(stateOf(fixture.status(blockersCut.run), "auth"), "unknown");
    assert.equal(goOf(fixture.verdict(["orc-build"], run.run), "orc-build").toBuild.length, 3);
  });

  test("the pending record is a write-access author's marked comment, counted for the target", () => {
    const fixture = githubRepo();
    fixture.git("switch", "-q", "-c", "spec/auth");
    fixture.commit("feat: both", "#13", "#14");
    const comments = [
      { id: 900, body: "<!-- orc:pending-decisions -->\n- #13: forged", association: "NONE" },
      { id: 901, body: "<!-- orc:pending-decisions -->\n- #13: Sessions expire\n- #14: Per account", association: "OWNER" },
    ];
    const status = fixture.status(runner(fakeGh({ subIssues: TICKETS, comments })).run);
    assert.deepEqual(status.target?.pending, { count: 2, commentId: 901 });
    assert.equal(status.next.command, "/orc-discuss auth");
  });
});

// ---------------------------------------------------------------------------
// Per-command verdicts
// ---------------------------------------------------------------------------

describe("/orc-setup", () => {
  test("a first run reports what setup needs, and the session must start at the checkout root", () => {
    const fixture = new Fixture();
    fixture.write("package.json", JSON.stringify({ scripts: { test: "node --test" } })).write("Makefile", "test:\n\tnpm test\n");
    const go = goOf(fixture.verdict(["orc-setup"], runner(fakeGh({})).run), "orc-setup");
    assert.equal(go.run, "first");
    assert.equal(go.remote, "none");
    assert.equal(go.gh, "ok");
    assert.deepEqual(go.testCandidates, ["npm test", "make test"]);
    assert.deepEqual(go.vendored, []);
    const sub = join(fixture.root, "sub");
    mkdirSync(sub);
    assert.equal(stopOf(fixture.verdict(["orc-setup"], runner(fakeGh({})).run, sub)).reason, "not-root");
  });

  test("an update names its reference section, the keys it lacks, the vendored pins and whether the tracker is locked", () => {
    const fixture = localWithTickets();
    fixture.write("docs/orc/config.json", configText("local", { buildStart: undefined })).commit("drop a key");
    const verdict = fixture.verdict(["orc-setup"], runner(() => GH_MISSING).run);
    const go = goOf(verdict, "orc-setup");
    assert.equal(go.run, "update");
    assert.deepEqual(go.missingKeys, ["buildStart"]);
    assert.equal(go.trackerLocked, true);
    assert.equal(go.gh, "not-installed");
    assert.ok(!go.vendored.some((v) => v.skill.startsWith("orc")));
    assert.deepEqual(verdict.reference, ["update"]);
  });

  test("a first run names the setup role's skill once it is vendored, at the path the config template gives it", () => {
    const fixture = new Fixture();
    fixture.write("README.md", "x").commit("init");
    assert.deepEqual(fixture.verdict(["orc-setup"], runner(fakeGh({})).run).upstream, []);
    fixture.vendorSkills();
    const verdict = fixture.verdict(["orc-setup"], runner(fakeGh({})).run);
    const template: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "skills", "orc-setup", "config-template.json"), "utf8"));
    const setupPath = typeof template === "object" && template !== null && "upstream" in template && typeof template.upstream === "object" && template.upstream !== null && "setup" in template.upstream ? template.upstream.setup : null;
    assert.deepEqual(verdict.upstream, [{ role: "setup", skill: "setup-matt-pocock-skills", path: setupPath, pin: "1a2b3c4", invoke: "read" }]);
    assert.deepEqual(verdict.reference, []);
    assert.match(fixture.text(["orc-setup"], runner(fakeGh({})).run), /^ {2}Pinned: {2}setup-matt-pocock-skills @ 1a2b3c4$/m);
  });

  test("only the skills vendored from upstream are listed: orc's own and one from another source are never the update's to re-add or remove", () => {
    const fixture = localWithTickets();
    fixture.write("skills-lock.json", lockText({ "their-skill": "someone/else" })).commit("another pack");
    const vendored = goOf(fixture.verdict(["orc-setup"], runner(() => GH_MISSING).run), "orc-setup").vendored.map((v) => v.skill);
    assert.deepEqual(vendored, ["grilling", "domain-modeling", "to-spec", "to-tickets", "implement-spec", "implement", "tdd", "code-review", "pr", "setup-matt-pocock-skills"]);
  });

  test("an update with the setup role unresolved names no reference heading for it: the skill says what to do", () => {
    const fixture = localWithTickets();
    fixture.write("docs/orc/config.json", configText("local", { upstream: { ...UPSTREAM, setup: null } })).commit("null setup");
    const verdict = fixture.verdict(["orc-setup"], runner(() => GH_MISSING).run);
    assert.deepEqual(verdict.reference, ["update"]);
    assert.deepEqual(verdict.upstream.map((u) => [u.role, u.skill]), [["setup", null]]);
  });

  test("the vendored pins are whole commits, since skills add takes no short one", () => {
    const fixture = localWithTickets();
    const go = goOf(fixture.verdict(["orc-setup"], runner(() => GH_MISSING).run), "orc-setup");
    assert.ok(go.vendored.some((v) => v.skill === "to-spec" && v.pin === "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"));
    assert.match(fixture.text(["orc-setup"], runner(() => GH_MISSING).run), /^ {4}skill=to-spec pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d$/m);
    assert.match(fixture.text(["orc-setup"], runner(() => GH_MISSING).run), /^ {2}Pinned: {2}setup-matt-pocock-skills @ 1a2b3c4$/m);
  });
});

describe("/orc-discuss", () => {
  test("its go carries what the run needs to push and where the tracker is, in both modes", () => {
    const spec = goOf(new Fixture().setUp("github", [{ name: "cli" }], { config: { push: "never" } }).verdict(["orc-discuss"], runner(fakeGh({})).run), "orc-discuss");
    assert.deepEqual([spec.mode, spec.push, spec.tracker], ["spec", "never", "github"]);
    const fixture = new Fixture();
    fixture.vendorSkills().write("docs/orc/config.json", configText("local")).commit("setup");
    const project = goOf(fixture.verdict(["orc-discuss"]), "orc-discuss");
    assert.deepEqual([project.mode, project.push, project.tracker], ["project", "ask", "local"]);
    assert.match(fixture.text(["orc-discuss"]), /^ {2}Tracker: local\n {2}Push: ask$/m);
  });

  test("its go carries the config's landing mode, which the spec interview offers first", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli" }], { config: { landing: "pr-human" } });
    assert.equal(goOf(fixture.verdict(["orc-discuss"]), "orc-discuss").landing, "pr-human");
    assert.match(fixture.text(["orc-discuss"]), /^ {2}Landing: pr-human$/m);
    const project = new Fixture();
    project.vendorSkills().write("docs/orc/config.json", configText("local")).commit("setup");
    assert.equal(goOf(project.verdict(["orc-discuss"]), "orc-discuss").landing, "local-merge");
  });

  test("off the default branch it stops", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    assert.equal(stopOf(fixture.verdict(["orc-discuss"])).reason, "off-default");
  });

  test("with no argument: one eligible entry is used, two to four are a pick, more than four show three and free text", () => {
    const one = new Fixture().setUp("local", [{ name: "cli" }]);
    const go = goOf(one.verdict(["orc-discuss"]), "orc-discuss");
    assert.deepEqual([go.mode, go.entry?.name, go.visit], ["spec", "cli", "first"]);
    const few = new Fixture().setUp("local", [{ name: "a", fields: ["Landing: local-merge"] }, { name: "b" }, { name: "c" }]);
    const pick = pickOf(few.verdict(["orc-discuss"]));
    assert.deepEqual([pick.why, pick.candidates.map((c) => c.name), pick.other], ["choose", ["b", "c", "a"], false]);
    const many = new Fixture().setUp("local", ["a", "b", "c", "d", "e"].map((name) => ({ name })));
    const wide = pickOf(many.verdict(["orc-discuss"]));
    assert.deepEqual([wide.candidates.map((c) => c.name), wide.other], [["a", "b", "c"], true]);
  });

  test("no eligible entry asks for a new name, and a valid new name offers to add it first", () => {
    const fixture = new Fixture().setUp("local", [{ name: "gone", fields: ["Dropped: no"] }]);
    const none = pickOf(fixture.verdict(["orc-discuss"]));
    assert.deepEqual([none.why, none.candidates, none.other, none.offerAdd], ["new-entry", [], true, false]);
    const add = pickOf(fixture.verdict(["orc-discuss", "billing"]));
    assert.deepEqual([add.why, add.offerAdd], ["new-entry", true]);
    assert.equal(pickOf(fixture.verdict(["orc-discuss", "Not Valid"])).offerAdd, false);
  });

  test("--new judges a new entry: a go with every field a first visit carries, numbered after the roadmap's last entry", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }, { name: "gone", fields: ["Dropped: no"] }], { config: { push: "always", landing: "pr-agent" } });
    fixture.write("GLOSSARY.md", "terms");
    const verdict = fixture.verdict(["orc-discuss", "billing", "--new"]);
    const go = goOf(verdict, "orc-discuss");
    const first = goOf(new Fixture().setUp("local", [{ name: "cli" }]).verdict(["orc-discuss", "cli"]), "orc-discuss");
    assert.deepEqual(Object.keys(go).sort(), Object.keys(first).sort());
    assert.deepEqual([go.mode, go.visit, go.entry, go.push, go.landing, go.pending], ["spec", "new", { number: 3, name: "billing", spec: null, branch: "spec/billing" }, "always", "pr-agent", null]);
    assert.deepEqual(go.uncommitted, { registry: false, domain: ["GLOSSARY.md"] });
    assert.deepEqual([go.next, first.next], [{ command: "/orc-discuss billing", reason: "spec interview for billing", kind: "run" }, { command: "/orc-discuss cli", reason: "spec interview for cli", kind: "run" }], "judged now, like a first visit");
    assert.ok(verdict.upstream.some((u) => u.role === "discuss" && u.skill === "grilling" && u.pin === "1a2b3c4"));
    const text = fixture.text(["orc-discuss", "billing", "--new"]);
    for (const line of ["  Target:  billing (as given)", "  Target:  billing (new roadmap entry 3)", "  Mode:    spec interview, new entry", "  Visit: new", "  Remote: none", "  UncommittedDomain: 1"]) {
      assert.ok(text.split("\n").includes(line), `${line} is in the text form`);
    }
    // Without --new an unknown name is still the pick that offers to add it; an existing or dropped name resolves as usual.
    assert.equal(pickOf(fixture.verdict(["orc-discuss", "billing"])).offerAdd, true);
    assert.equal(goOf(fixture.verdict(["orc-discuss", "cli", "--new"]), "orc-discuss").visit, "revisit");
    assert.equal(pickOf(fixture.verdict(["orc-discuss", "gone", "--new"])).why, "dropped");
    // A name that cannot be an entry asks for another.
    const invalid = pickOf(fixture.verdict(["orc-discuss", "Not Valid", "--new"]));
    assert.deepEqual([invalid.why, invalid.candidates, invalid.other, invalid.offerAdd], ["new-entry", [], true, false]);
  });

  test("--new needs orc-discuss and a name, keeps the stops judged before a target, and is moot in project mode", () => {
    assert.match(parseArgs(["orc-discuss", "--new"]).usage ?? "", /--new/);
    assert.match(parseArgs(["orc-spec", "x", "--new"]).usage ?? "", /--new/);
    assert.equal(parseArgs(["orc-discuss", "x", "--new", "--core"]).newEntry, true);
    const off = new Fixture().setUp("local", [{ name: "cli" }]);
    off.git("switch", "-q", "-c", "other");
    assert.equal(stopOf(off.verdict(["orc-discuss", "billing", "--new"])).reason, "off-default");
    const github = new Fixture().setUp("github", [{ name: "cli" }]);
    assert.equal(stopOf(github.verdict(["orc-discuss", "billing", "--new"], runner(() => GH_MISSING).run)).reason, "gh");
    const project = new Fixture();
    project.vendorSkills().write("docs/orc/config.json", configText("local")).commit("setup");
    assert.equal(goOf(project.verdict(["orc-discuss", "billing", "--new"]), "orc-discuss").mode, "project");
  });

  test("with no argument, the one entry to discuss is read in detail, its GitHub pending comment counted", () => {
    const fixture = githubRepo([
      { name: "auth", fields: ["Landing: pr-agent", "Spec: #12"] },
      { name: "two", fields: ["Landing: pr-agent", "Spec: #20"] },
    ]);
    fixture.commit("feat: both", "#13", "#14");
    const comments = [{ id: 5, body: "<!-- orc:pending-decisions -->\n- #13: x", association: "OWNER" }];
    // auth landed with its issues open (cleanup-pending), so two is the only entry to discuss.
    const subIssuesOf = { 12: TICKETS, 20: [{ number: 21, title: "two: one", state: "OPEN" }] };
    const go = goOf(fixture.verdict(["orc-discuss"], runner(fakeGh({ subIssuesOf, comments })).run), "orc-discuss");
    assert.equal(go.entry?.name, "two");
    assert.deepEqual(go.pending, { count: 1, commentId: 5 });
  });

  test("a revisit of a landed entry is allowed with its name", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    const go = goOf(fixture.verdict(["orc-discuss", "cli"]), "orc-discuss");
    assert.equal(go.visit, "revisit");
  });

  test("a pending record on the spec branch names its reference section, and stops on a dirty tree or a held branch", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("switch", "-q", "spec/cli");
    fixture.write(".scratch/cli/pending-decisions.md", "<!-- orc:pending-decisions -->\n- cli/02: x\n").commit("docs: pending");
    fixture.git("switch", "-q", "main");
    const verdict = fixture.verdict(["orc-discuss", "cli"]);
    assert.deepEqual(goOf(verdict, "orc-discuss").pending, { count: 1, ref: "spec/cli", path: ".scratch/cli/pending-decisions.md" });
    assert.deepEqual(verdict.reference, ["pending-on-branch"]);
    fixture.write("GLOSSARY.md", "terms").write("src/wip.js", "x");
    assert.equal(stopOf(fixture.verdict(["orc-discuss", "cli"])).reason, "pending-blocked");
    rmSync(join(fixture.root, "src/wip.js"));
    const go = goOf(fixture.verdict(["orc-discuss", "cli"]), "orc-discuss");
    assert.deepEqual(go.uncommitted, { registry: false, domain: ["GLOSSARY.md"] });
    const held = join(tempDir(), "wt");
    fixture.git("worktree", "add", "-q", held, "spec/cli");
    assert.equal(stopOf(fixture.verdict(["orc-discuss", "cli"])).reason, "branch-held");
  });
});

describe("/orc-spec", () => {
  test("a discussed entry goes with the ids that apply; other states stop with their next", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }, { name: "web" }], {
      requirements: ["- REQ-01: Count (spec: cli)", "- REQ-02: Web (spec: web)"],
    });
    const verdict = fixture.verdict(["orc-spec"]);
    const go = goOf(verdict, "orc-spec");
    assert.deepEqual([go.resume, go.ids, go.projectDecisions], ["none", ["REQ-01"], 1]);
    assert.deepEqual(verdict.ids, ["REQ-01"]);
    assert.match(fixture.text(["orc-spec"]), /^ {2}ProjectDecisions: 1 \(registry --project\)$/m);
    assert.equal(fixture.text(["registry", "--project"]), "- D-01: Plain Node -> project\n");
    assert.ok(verdict.upstream.some((u) => u.role === "spec" && u.invoke === "read" && u.pin === "1a2b3c4"));
    const stopped = stopOf(fixture.verdict(["orc-spec", "web"]));
    assert.equal(stopped.reason, "state");
    assert.equal(stopped.next.command, "/orc-discuss web");
  });

  test("uncommitted Spec: and Branch: lines under the target are a resume; any other registry change stops", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }]);
    fixture.write("docs/orc/registry.md", registryText([{ name: "cli", fields: ["Landing: local-merge", "Spec: .scratch/cli/spec.md", "Branch: spec/cli"] }]));
    assert.equal(goOf(fixture.verdict(["orc-spec", "cli"]), "orc-spec").resume, "commit-record");
    fixture.write("docs/orc/registry.md", registryText([{ name: "cli", fields: ["Landing: pr-agent"] }]));
    assert.equal(stopOf(fixture.verdict(["orc-spec", "cli"])).reason, "registry-dirty");
  });

  test("an unresolved spec role stops after the state stops, naming the upstream command; a record to commit needs no upstream skill", () => {
    const nullSpec = { upstream: { ...UPSTREAM, spec: null } };
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }, { name: "web" }], { config: nullSpec });
    const verdict = fixture.verdict(["orc-spec", "cli"]);
    assert.equal(stopOf(verdict).reason, "null-role");
    assert.deepEqual(verdict.reference, []);
    assert.match(fixture.text(["orc-spec", "cli"]), /\/to-spec/);
    assert.equal(stopOf(verdict).next.command, "/orc-setup");
    assert.equal(stopOf(fixture.verdict(["orc-spec", "web"])).reason, "state");
    fixture.write("docs/orc/registry.md", registryText([{ name: "cli", fields: ["Landing: local-merge", "Spec: .scratch/cli/spec.md", "Branch: spec/cli"] }, { name: "web" }]));
    assert.equal(goOf(fixture.verdict(["orc-spec", "cli"]), "orc-spec").resume, "commit-record");
  });

  test("a spec file an earlier run left is found; on GitHub an open issue titled <name>: with no parent is found", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }]);
    fixture.write(".scratch/cli/spec.md", "# cli");
    const go = goOf(fixture.verdict(["orc-spec"]), "orc-spec");
    assert.deepEqual([go.resume, go.found], ["found", [".scratch/cli/spec.md"]]);
    const github = githubRepo([{ name: "auth", fields: ["Landing: pr-agent"] }]);
    // A closed issue with the title is an earlier use of the name that ended, never a spec this entry may have filed.
    const closed = { number: 28, title: "auth: an old spec", state: "CLOSED", login: "bob" };
    const found = [
      closed,
      { number: 31, title: "auth: the spec", state: "OPEN", login: "ann" },
      { number: 32, title: "auth: a ticket", state: "OPEN", parent: 31 },
      { number: 33, title: "authx: other", state: "OPEN" },
    ];
    const githubGo = goOf(github.verdict(["orc-spec"], runner(fakeGh({ found })).run), "orc-spec");
    assert.deepEqual([githubGo.resume, githubGo.found, githubGo.foundDetail], ["found", ["#31"], [{ ref: "#31", title: "auth: the spec", author: "ann" }]]);
    assert.equal(goOf(github.verdict(["orc-spec"], runner(fakeGh({ found: [closed] })).run), "orc-spec").resume, "none");
  });

  test("under push: never on GitHub the issues are printed, and the run ends pointing at /orc, never at itself", () => {
    const entries = [{ name: "auth", fields: ["Landing: pr-agent"] }, { ...SPECCED_GITHUB, name: "next", fields: ["Landing: pr-agent", "Spec: #12", "Branch: spec/next"] }];
    const never = new Fixture().setUp("github", entries, { config: { push: "never" } });
    never.git("remote", "add", "origin", "https://github.com/example/repo.git");
    const run = runner(fakeGh({})).run;
    const spec = goOf(never.verdict(["orc-spec", "auth"], run), "orc-spec");
    assert.deepEqual(spec.byHand, { command: "/orc", reason: "after running the printed gh issue create command; the next /orc-spec auth records the issue", kind: "manual" });
    assert.match(never.text(["orc-spec", "auth"], run), /^ {2}ByHand: Done\. Next: \/orc {3}\(after running the printed gh issue create command; the next \/orc-spec auth records the issue\)$/m);
    const tickets = goOf(never.verdict(["orc-tickets", "next"], run), "orc-tickets");
    assert.deepEqual(tickets.byHand, { command: "/orc", reason: "after running the printed gh issue create commands in their order", kind: "manual" });
    // Under any other push value, or with the local tracker, the run creates or writes them itself.
    const ask = githubRepo([{ name: "auth", fields: ["Landing: pr-agent"] }]);
    assert.equal(goOf(ask.verdict(["orc-spec"], run), "orc-spec").byHand, null);
    assert.doesNotMatch(ask.text(["orc-spec"], run), /ByHand/);
    const local = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }], { config: { push: "never" } });
    assert.equal(goOf(local.verdict(["orc-spec"]), "orc-spec").byHand, null);
  });

  test("push: never says in the verdict what it stops and that tracker bookkeeping still runs", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }], { config: { push: "never" } });
    for (const command of ["orc-discuss", "orc-spec"]) {
      assert.match(fixture.text([command, "cli"]), /^ {2}Push: never \(no push, PR or new issue; tracker bookkeeping still runs\)$/m, command);
    }
    assert.equal(goOf(fixture.verdict(["orc-spec", "cli"]), "orc-spec").push, "never");
  });

  test("the issues carry upstream's triage label only where its setup created the labels", () => {
    const github = githubRepo([{ name: "auth", fields: ["Landing: pr-agent"] }]);
    const run = runner(fakeGh({})).run;
    assert.equal(goOf(github.verdict(["orc-spec"], run), "orc-spec").triageLabels, false);
    assert.match(github.text(["orc-spec"], run), /^ {2}TriageLabels: no$/m);
    github.write("docs/agents/triage-labels.md", "# Triage Labels\n").commit("docs: triage labels");
    assert.equal(goOf(github.verdict(["orc-spec"], run), "orc-spec").triageLabels, true);
  });
});

describe("/orc-tickets", () => {
  test("the set is judged against the ids the spec cites", () => {
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01, REQ-02\n").commit("docs: add cli spec");
    let go = goOf(fixture.verdict(["orc-tickets"]), "orc-tickets");
    assert.deepEqual([go.set, go.cited, go.uncovered], ["none", ["REQ-01", "REQ-02"], ["REQ-01", "REQ-02"]]);
    fixture.localTicket("cli", "01", "Skeleton");
    assert.equal(goOf(fixture.verdict(["orc-tickets"]), "orc-tickets").set, "uncommitted");
    fixture.commit("docs: add cli tickets");
    go = goOf(fixture.verdict(["orc-tickets"]), "orc-tickets");
    assert.deepEqual([go.set, go.uncovered, go.tickets.map((t) => t.satisfies)], ["partial", ["REQ-02"], [["REQ-01"]]]);
    fixture.write(".scratch/cli/issues/02-ticket.md", "# 02: Show\n\nSatisfies: REQ-02\n").commit("docs: add the second ticket");
    assert.equal(goOf(fixture.verdict(["orc-tickets"]), "orc-tickets").set, "complete");
  });

  test("an unresolved tickets role stops before any drafting, naming the upstream command, and never before what needs no upstream skill", () => {
    const nullTickets = { upstream: { ...UPSTREAM, tickets: null } };
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS, config: nullTickets });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01, REQ-02\n").commit("docs: add cli spec");
    const stopped = fixture.verdict(["orc-tickets", "cli"]);
    assert.equal(stopOf(stopped).reason, "null-role");
    assert.deepEqual(stopped.reference, []);
    const text = fixture.text(["orc-tickets", "cli"]);
    assert.match(text, /\/to-tickets/);
    assert.match(text, /^ {2}Pointer: Done\. Next: \/orc-setup {3}\(resolves the missing upstream skill\)$/m);
    assert.equal(stopOf(new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }], { config: nullTickets }).verdict(["orc-tickets", "cli"])).reason, "state", "the state stop comes first");
    // Uncommitted tickets that cover every cited id only need a commit, and a complete set only its pointer.
    fixture.localTicket("cli", "01", "Skeleton").write(".scratch/cli/issues/02-ticket.md", "# 02: Show\n\nSatisfies: REQ-02\n");
    assert.equal(goOf(fixture.verdict(["orc-tickets", "cli"]), "orc-tickets").set, "uncommitted");
    fixture.commit("docs: add cli tickets");
    assert.equal(goOf(fixture.verdict(["orc-tickets", "cli"]), "orc-tickets").set, "complete");
    rmSync(join(fixture.root, ".scratch/cli/issues/02-ticket.md"));
    assert.equal(stopOf(fixture.verdict(["orc-tickets", "cli"])).reason, "null-role", "uncommitted with ids left to cover drafts the rest");
  });

  test("a specced entry's pointer keeps upstream's advice to stay in the spec's session", () => {
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").commit("docs: add cli spec");
    assert.deepEqual(stopOf(fixture.verdict(["orc-spec", "cli"])).next, { command: "/orc-tickets cli", reason: "spec .scratch/cli/spec.md exists, no tickets yet; run it in the spec's session", kind: "run" });
  });

  test("an entry with no Spec: line stops with its next", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }]);
    const stopped = stopOf(fixture.verdict(["orc-tickets", "cli"]));
    assert.equal(stopped.reason, "state");
    assert.equal(stopped.next.command, "/orc-spec cli");
  });
});

describe("/orc-build", () => {
  test("a spec build goes with the tickets to build, their ids and blockers, and the config's knobs", () => {
    const verdict = localWithTickets().verdict(["orc-build"]);
    const go = goOf(verdict, "orc-build");
    assert.deepEqual([go.phase, go.mode, go.branch, go.mergeDefault, go.test, go.buildStart, go.reviewFixRounds, go.research], ["build", "implement-spec", "create", false, "npm test", "ask", 1, "on-demand"]);
    assert.deepEqual(go.toBuild.map((t) => [t.ref, t.satisfies, t.blockers]), [
      ["cli/01", ["REQ-01"], []],
      ["cli/02", ["REQ-01"], ["cli/01"]],
      ["cli/03", ["REQ-01"], ["cli/01", "cli/02"]],
    ]);
    assert.deepEqual(verdict.ids, ["REQ-01", "REQ-02", "D-01"]);
    assert.deepEqual(verdict.upstream.map((u) => [u.role, u.skill, u.invoke]), [
      ["buildSpec", "implement-spec", "read"],
      [null, "tdd", "skill-tool"],
      [null, "code-review", "skill-tool"],
    ]);
    assert.match(verdict.lines[2] ?? "", /^Build: {3}implement-spec, 3 of 3 tickets to build \(built: none; landed: none\), research: on-demand$/);
  });

  test("a build stop on an entry with no tickets says so instead of counting none of none", () => {
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").commit("docs: add cli spec");
    const stopped = stopOf(fixture.verdict(["orc-build"]));
    assert.equal(stopped.reason, "state");
    assert.ok(stopped.message.includes("Build:   implement-spec, no tickets yet, research: on-demand"), stopped.message.join("\n"));
  });

  test("a ticket target waits on unbuilt blockers, and one already built goes to cleanup", () => {
    const fixture = localWithTickets();
    const blocked = stopOf(fixture.verdict(["orc-build", "cli/02"]));
    assert.equal(blocked.reason, "blocker");
    assert.equal(blocked.next.command, "/orc-build cli/01");
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    const go = goOf(fixture.verdict(["orc-build", "cli/02"]), "orc-build");
    assert.deepEqual([go.ticket, go.phase, go.mode, go.mergeDefault], ["cli/02", "build", "implement", false]);
    assert.equal(goOf(fixture.verdict(["orc-build", "cli/01"]), "orc-build").phase, "cleanup");
  });

  test("every ticket built asks for the review, and a moved default branch is merged in first", () => {
    const fixture = builtCli(localWithTickets());
    fixture.write("docs/notes.md", "x").commit("docs: unrelated");
    const verdict = fixture.verdict(["orc-build"]);
    const go = goOf(verdict, "orc-build");
    assert.deepEqual([go.phase, go.branch, go.mergeDefault], ["review-ask", "local", true]);
    assert.deepEqual(verdict.reference, ["review-only"]);
  });

  test("dirty orc paths stop the build; other dirty paths and leftover agent branches go as data", () => {
    const fixture = localWithTickets();
    fixture.git("branch", "worktree-agent-x");
    fixture.git("switch", "-q", "worktree-agent-x");
    fixture.commit("feat: wip", "cli/01");
    fixture.git("switch", "-q", "main");
    fixture.write("src/scratch.js", "x");
    const verdict = fixture.verdict(["orc-build"]);
    const go = goOf(verdict, "orc-build");
    assert.deepEqual(go.dirtyOther, ["src/scratch.js"]);
    assert.deepEqual(go.agentBranches, [{ name: "worktree-agent-x", unmerged: 1 }]);
    assert.deepEqual(verdict.reference, ["agent-branches"]);
    fixture.write(".scratch/cli/issues/01-ticket.md", "changed");
    assert.equal(stopOf(fixture.verdict(["orc-build"])).reason, "dirty-orc");
  });

  test("another worktree holding the spec branch stops the build, which switches to it", () => {
    const fixture = localWithTickets();
    fixture.git("branch", "spec/cli");
    const held = join(tempDir(), "held");
    fixture.git("worktree", "add", "-q", held, "spec/cli");
    const stopped = stopOf(fixture.verdict(["orc-build"]));
    assert.equal(stopped.reason, "branch-held");
    assert.equal(stopped.next.command, "/orc");
    assert.equal(goOf(fixture.verdict(["orc-build"], runner().run, held), "orc-build").branch, "local");
  });

  test("the go names the default branch, and where the pending record lives on either tracker", () => {
    const local = builtCli(localWithTickets());
    assert.equal(goOf(local.verdict(["orc-build"]), "orc-build").pending, null);
    local.git("switch", "-q", "spec/cli");
    local.write(".scratch/cli/pending-decisions.md", "<!-- orc:pending-decisions -->\n- cli/02: Per account\n").commit("docs: record cli pending decisions");
    const go = goOf(local.verdict(["orc-build"]), "orc-build");
    assert.deepEqual([go.defaultBranch, go.pending], ["main", { count: 1, ref: "spec/cli", path: ".scratch/cli/pending-decisions.md" }]);
    assert.match(local.text(["orc-build"]), /\n {2}DefaultBranch: main\n {2}Pending: count=1 ref=spec\/cli path=\.scratch\/cli\/pending-decisions\.md\n/);
    const github = githubRepo();
    const comments = [{ id: 901, body: "<!-- orc:pending-decisions -->\n- #13: Per account", association: "OWNER" }];
    const run = runner(fakeGh({ subIssues: TICKETS, comments })).run;
    assert.deepEqual(goOf(github.verdict(["orc-build"], run), "orc-build").pending, { count: 1, commentId: 901 });
    assert.match(github.text(["orc-build"], run), /\n {2}Pending: count=1 comment=901\n/);
  });

  test("the built tickets still to mark are read from the spec branch, so a rerun never repeats the mark commit", () => {
    const fixture = builtCli(localWithTickets());
    assert.deepEqual(goOf(fixture.verdict(["orc-build"]), "orc-build").toMark, ["cli/01", "cli/02", "cli/03"]);
    fixture.git("switch", "-q", "spec/cli");
    for (const n of ["01", "02"]) fixture.write(`.scratch/cli/issues/${n}-ticket.md`, `# ${n}: t\n\n**Status:** built\n`);
    fixture.commit("docs: mark cli tickets built");
    const go = goOf(fixture.verdict(["orc-build"]), "orc-build");
    assert.deepEqual(go.toMark, ["cli/03"]);
    assert.match(fixture.text(["orc-build"]), /\n {2}ToMark: cli\/03\n/);
    const github = githubRepo();
    github.git("switch", "-q", "-c", "spec/auth");
    github.commit("feat: login", "#13");
    github.git("switch", "-q", "main");
    assert.equal(goOf(github.verdict(["orc-build"], runner(fakeGh({ subIssues: TICKETS })).run), "orc-build").toMark, null);
  });

  test("an unresolved build role is named only while tickets are left to build", () => {
    const nullBuild = { upstream: { ...UPSTREAM, buildSpec: null } };
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli"), { name: "later" }], { requirements: REQUIREMENTS, config: nullBuild });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").localTicket("cli", "01", "Skeleton").commit("docs: add cli tickets");
    const build = fixture.verdict(["orc-build"]);
    assert.equal(goOf(build, "orc-build").phase, "build");
    assert.deepEqual(build.reference, ["null-role"]);
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
    const review = fixture.verdict(["orc-build"]);
    assert.equal(goOf(review, "orc-build").phase, "review-ask");
    assert.deepEqual(review.reference, ["review-only"]);
  });

  test("a landed entry stops with its next; a GitHub ticket target resolves through its entry's sub-issues", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    resolveLocal(fixture);
    fixture.commit("docs: resolve");
    const stopped = stopOf(fixture.verdict(["orc-build", "cli"]));
    assert.equal(stopped.reason, "state");
    const github = githubRepo();
    const go = goOf(github.verdict(["orc-build", "#13"], runner(fakeGh({ subIssues: TICKETS })).run), "orc-build");
    assert.deepEqual([go.entry.name, go.ticket], ["auth", "#13"]);
  });
});

describe("/orc-land", () => {
  test("a built entry goes with the landing facts", () => {
    const go = goOf(builtCli(localWithTickets()).verdict(["orc-land"]), "orc-land");
    assert.deepEqual([go.phase, go.mode, go.modeSource, go.tickets, go.pending, go.test, go.remote], ["land", "local-merge", "entry", ["cli/01", "cli/02", "cli/03"], 0, "npm test", "none"]);
    assert.deepEqual(go.branch, { local: true, remote: false, ahead: null, behind: null, behindDefault: 0 });
  });

  test("a ticket not built stops, listing it", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    const stopped = stopOf(fixture.verdict(["orc-land"]));
    assert.equal(stopped.reason, "state");
    assert.match(stopped.message.at(-1) ?? "", /not built: cli\/02 cli\/03/);
    assert.equal(stopped.next.command, "/orc-build cli");
  });

  describe("a bare /orc-land with a landed entry that still has leftovers", () => {
    /** `cli` merged into main with a merge commit, its branch and its open tickets left behind. */
    const merged = (fixture: Fixture): Fixture => {
      fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
      return fixture;
    };

    test("asks whether to finish it or go on, naming what is left; a named target never asks", () => {
      const fixture = merged(builtCli(localWithTickets()));
      const pick = pickOf(fixture.verdict(["orc-land"]));
      assert.deepEqual(pick, {
        kind: "pick", why: "leftovers", other: false, offerAdd: false,
        candidates: [{ number: 1, name: "cli", spec: ".scratch/cli/spec.md" }, { number: 2, name: "later", spec: null }],
        leftover: { branches: ["spec/cli"], unresolved: ["cli/01", "cli/02", "cli/03"] },
      });
      const text = fixture.text(["orc-land"]);
      assert.match(text, /^orc verdict 1 orc-land pick$/m);
      assert.match(text, /^ {2}Why: leftovers$/m);
      assert.match(text, /^ {2}Leftover: branches=spec\/cli unresolved=cli\/01,cli\/02,cli\/03$/m);
      assert.equal(goOf(fixture.verdict(["orc-land", "cli"]), "orc-land").phase, "cleanup");
      assert.equal(stopOf(fixture.verdict(["orc-land", "later"])).reason, "state");
    });

    test("a merged branch alone is a leftover, and once it is gone the next entry is the target", () => {
      const fixture = merged(builtCli(localWithTickets()));
      resolveLocal(fixture);
      fixture.commit("docs: resolve cli tickets");
      assert.deepEqual(pickOf(fixture.verdict(["orc-land"])).leftover, { branches: ["spec/cli"], unresolved: [] });
      // /orc keeps its focus on the next entry and names the leftover in a note.
      assert.equal(fixture.status().next.command, "/orc-discuss later");
      fixture.git("branch", "-q", "-d", "spec/cli");
      const stopped = stopOf(fixture.verdict(["orc-land"]));
      assert.equal(stopped.reason, "state");
      assert.equal(stopped.next.command, "/orc-discuss later");
    });

    test("with no entry left to go on to, it is finished without a question", () => {
      const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS });
      fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").localTicket("cli", "01", "Skeleton").commit("docs: add cli tickets");
      fixture.git("switch", "-q", "-c", "spec/cli");
      fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
      fixture.write(".scratch/cli/issues/01-ticket.md", "# 01: t\n\n**Status:** resolved\n").commit("docs: resolve cli tickets");
      fixture.git("switch", "-q", "main");
      merged(fixture);
      assert.equal(stateOf(fixture.status(), "cli"), "landed");
      const go = goOf(fixture.verdict(["orc-land"]), "orc-land");
      assert.deepEqual([go.entry.name, go.phase], ["cli", "cleanup"]);
    });

    test("a branch the run cannot remove is no leftover: one holding commits that never landed, or origin's under push never", () => {
      const unlanded = merged(builtCli(localWithTickets()));
      resolveLocal(unlanded);
      unlanded.commit("docs: resolve cli tickets");
      unlanded.git("switch", "-q", "spec/cli");
      unlanded.write("src/late.js", "late").commit("chore: after the landing");
      unlanded.git("switch", "-q", "main");
      assert.equal(stopOf(unlanded.verdict(["orc-land"])).reason, "state");

      const remote = (push: string): Fixture => {
        const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli"), { name: "later" }], { requirements: REQUIREMENTS, config: { push } });
        fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").localTicket("cli", "01", "Skeleton").commit("docs: add cli tickets");
        fixture.git("switch", "-q", "-c", "spec/cli");
        fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
        fixture.write(".scratch/cli/issues/01-ticket.md", "# 01: t\n\n**Status:** resolved\n").commit("docs: resolve cli tickets");
        fixture.git("switch", "-q", "main");
        merged(fixture);
        fixture.git("remote", "add", "origin", "https://example.com/repo.git");
        fixture.git("update-ref", "refs/remotes/origin/spec/cli", "spec/cli");
        fixture.git("update-ref", "refs/remotes/origin/main", "main");
        fixture.git("branch", "-q", "-d", "spec/cli");
        return fixture;
      };
      assert.deepEqual(pickOf(remote("ask").verdict(["orc-land"])).leftover, { branches: ["origin/spec/cli"], unresolved: [] });
      assert.equal(stopOf(remote("never").verdict(["orc-land"])).reason, "state");
      // The note names the step that removes the branch, and only under push never the delete to run by hand.
      const noteOf = (push: string): string | undefined => goOf(remote(push).verdict(["orc"]), "orc").report.find((line) => line.startsWith("Note on cli:"));
      assert.equal(noteOf("ask"), "Note on cli: origin/spec/cli is merged and still exists: /orc-land cli removes it");
      assert.equal(noteOf("never"), "Note on cli: origin/spec/cli is merged and still exists: delete it by hand with git push origin --delete spec/cli, since push is never");
    });
  });

  test("a dirty tree, a linked worktree and a held default branch stop", () => {
    const fixture = builtCli(localWithTickets());
    fixture.write("x.txt", "x");
    assert.equal(stopOf(fixture.verdict(["orc-land"])).reason, "dirty");
    rmSync(join(fixture.root, "x.txt"));
    const linked = join(tempDir(), "linked");
    fixture.git("worktree", "add", "-q", "-b", "elsewhere", linked);
    assert.equal(stopOf(fixture.verdict(["orc-land"], runner().run, linked)).reason, "linked-worktree");
    fixture.git("worktree", "remove", linked);
    const held = join(tempDir(), "held");
    fixture.git("worktree", "add", "-q", held, "spec/cli");
    assert.equal(stopOf(fixture.verdict(["orc-land"])).reason, "branch-held");
  });

  test("where two stops apply, the build and the landing give the earlier one of spec 9.3", () => {
    const fixture = localWithTickets();
    fixture.write("docs/orc/notes.md", "uncommitted\n");
    assert.equal(stopOf(fixture.verdict(["orc-land"])).reason, "state", "the state before the dirty tree");
    assert.equal(stopOf(fixture.verdict(["orc-build", "cli/02"])).reason, "blocker", "a blocker before the dirty orc paths");
    assert.equal(stopOf(fixture.verdict(["orc-build"])).reason, "dirty-orc");
    fixture.git("worktree", "add", "-q", join(tempDir(), "held"), "-b", "spec/cli");
    assert.equal(stopOf(fixture.verdict(["orc-build"])).reason, "branch-held", "a held spec branch before the dirty orc paths");
    assert.equal(stopOf(fixture.verdict(["orc-land"])).reason, "branch-held", "a held spec branch before the state");
  });

  test("PR modes stop without a github.com remote, under push: never, or when merge commits are forbidden", () => {
    const fixture = builtCli(localWithTickets("pr-agent"));
    const run = runner(fakeGh({})).run;
    fixture.git("remote", "add", "origin", "/somewhere/else.git");
    assert.match(stopOf(fixture.verdict(["orc-land"], run)).message.at(-1) ?? "", /origin is not a github.com remote/);
    fixture.git("remote", "set-url", "origin", "https://github.com/example/repo.git");
    assert.match(stopOf(fixture.verdict(["orc-land"], runner(fakeGh({ mergeCommitAllowed: false })).run)).message.at(-1) ?? "", /forbids merge commits/);
    fixture.write("docs/orc/config.json", configText("local", { push: "never" })).commit("push never");
    const stopped = stopOf(fixture.verdict(["orc-land"], run));
    assert.equal(stopped.reason, "pr-blocked");
    assert.match(stopped.message.at(-1) ?? "", /push is never/);
  });

  test("pr-human with an open PR and nothing new to push waits; a diverged spec branch stops", () => {
    const fixture = builtCli(localWithTickets("pr-human"));
    fixture.git("remote", "add", "origin", "https://github.com/example/repo.git");
    fixture.git("update-ref", "refs/remotes/origin/spec/cli", "spec/cli");
    const prs = [{ number: 7, state: "OPEN", headRefName: "spec/cli", mergeCommit: null }];
    const waiting = stopOf(fixture.verdict(["orc-land"], runner(fakeGh({ prs })).run));
    assert.equal(waiting.reason, "waiting");
    assert.equal(waiting.next.kind, "wait");
    fixture.git("update-ref", "refs/remotes/origin/spec/cli", fixture.git("commit-tree", "-p", "spec/cli~1", "-m", "remote only", "spec/cli^{tree}"));
    assert.equal(stopOf(fixture.verdict(["orc-land"], runner(fakeGh({ prs: [] })).run)).reason, "spec-diverged");
  });

  test("an unresolved land role is named only while the PR body is still to write: the cleanup needs no upstream skill", () => {
    const nullLand = { upstream: { ...UPSTREAM, land: null } };
    const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli", "pr-human"), { name: "later" }], { requirements: REQUIREMENTS, config: nullLand });
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n").localTicket("cli", "01", "Skeleton").commit("docs: add cli tickets");
    fixture.git("remote", "add", "origin", "https://github.com/example/repo.git");
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    const run = runner(fakeGh({ prs: [] })).run;
    assert.deepEqual(fixture.verdict(["orc-land"], run).reference, ["pr-modes", "null-role"]);
    fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
    const merge = fixture.git("rev-parse", "HEAD");
    const merged = runner(fakeGh({ prs: [{ number: 7, state: "MERGED", headRefName: "spec/cli", mergeCommit: { oid: merge } }] })).run;
    const cleanup = fixture.verdict(["orc-land", "cli"], merged);
    assert.equal(goOf(cleanup, "orc-land").phase, "cleanup");
    assert.deepEqual(cleanup.reference, []);
  });

  test("the local tracker's files still to resolve are read from the spec branch, so a rerun never repeats the resolve commit", () => {
    const fixture = localWithTickets();
    fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01, REQ-02, D-01\n\nStatus: ready\n").commit("docs: spec status");
    builtCli(fixture);
    assert.deepEqual(goOf(fixture.verdict(["orc-land"]), "orc-land").toResolve, [".scratch/cli/spec.md", "cli/01", "cli/02", "cli/03"]);
    fixture.git("switch", "-q", "spec/cli");
    fixture.write(".scratch/cli/issues/01-ticket.md", "# 01: Skeleton\n\n**Status:** resolved\n").commit("docs: resolve one");
    assert.deepEqual(goOf(fixture.verdict(["orc-land"]), "orc-land").toResolve, [".scratch/cli/spec.md", "cli/02", "cli/03"]);
    resolveLocal(fixture);
    fixture.commit("docs: resolve cli tickets");
    const go = goOf(fixture.verdict(["orc-land"]), "orc-land");
    assert.deepEqual(go.toResolve, []);
    assert.deepEqual(go.unresolved, [".scratch/cli/spec.md", "cli/01", "cli/02", "cli/03"], "the default branch still reads them open");
    assert.match(fixture.text(["orc-land"]), /\n {2}ToResolve: none\n/);
    const fresh = localWithTickets();
    builtCli(fresh);
    assert.match(fresh.text(["orc-next"]), /\n {6}ToResolve: cli\/01 cli\/02 cli\/03\n/, "the verdict /orc-next carries reads the branch too");
    const github = githubRepo();
    github.git("switch", "-q", "-c", "spec/auth");
    github.commit("feat: both", "#13", "#14");
    github.git("switch", "-q", "main");
    assert.equal(goOf(github.verdict(["orc-land"], runner(fakeGh({ subIssues: TICKETS, prs: [] })).run), "orc-land").toResolve, null);
  });
});

describe("conflicts the next merge would hit", () => {
  /** `cli` with ticket 01 built on spec/cli, then main changing the same file another way. */
  function conflicting(allBuilt: boolean): Fixture {
    const fixture = localWithTickets();
    if (allBuilt) builtCli(fixture);
    else {
      fixture.git("switch", "-q", "-c", "spec/cli");
      fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
      fixture.git("switch", "-q", "main");
    }
    fixture.write("src/a.js", "main's own").commit("chore: a placeholder on main");
    return fixture;
  }

  test("a spec branch that conflicts with the default branch stops the build and the landing before any merge, and /orc says what is in the way", () => {
    const building = conflicting(false);
    const build = stopOf(building.verdict(["orc-build"]));
    assert.equal(build.reason, "conflict");
    assert.match(build.message.at(-1) ?? "", /^spec\/cli and the default branch conflict/);
    assert.equal(pointer(build.next), "Done. Next: /orc   (after merging the default branch into spec/cli by hand: they conflict)");
    const report = goOf(building.verdict(["orc"]), "orc").report.join("\n");
    assert.match(report, /Note: spec\/cli and the default branch conflict: merge the default branch into it by hand/);
    assert.match(report, /Done\. Next: \/orc-build cli {3}\(after merging the default branch into spec\/cli by hand: they conflict\)$/);

    const built = conflicting(true);
    const land = stopOf(built.verdict(["orc-land"]));
    assert.equal(land.reason, "conflict");
    assert.match(goOf(built.verdict(["orc"]), "orc").report.at(-1) ?? "", /Next: \/orc-land cli {3}\(after merging the default branch into spec\/cli by hand: they conflict\)$/);
  });

  test("with every ticket built, a conflicting default branch stops the build before the review is offered", () => {
    const built = conflicting(true);
    const verdict = built.verdict(["orc-build"]);
    const build = stopOf(verdict);
    assert.equal(build.reason, "conflict");
    assert.equal(build.message.at(-1), "spec/cli and the default branch conflict, so the merge of the default branch into it, which this step makes first, would stop.");
    assert.equal(pointer(build.next), "Done. Next: /orc   (after merging the default branch into spec/cli by hand: they conflict)");
    assert.deepEqual(verdict.reference, []);
    // A ticket built already needs no merge: its cleanup goes on.
    assert.equal(goOf(built.verdict(["orc-build", "cli/01"]), "orc-build").phase, "cleanup");
  });

  test("a default branch that is merely ahead goes on, and a clean merge is never called a conflict", () => {
    const fixture = localWithTickets();
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    fixture.write("README.md", "elsewhere").commit("docs: readme");
    const go = goOf(fixture.verdict(["orc-build"]), "orc-build");
    assert.equal(go.mergeDefault, true);
    assert.doesNotMatch(goOf(fixture.verdict(["orc"]), "orc").report.join("\n"), /conflict/);
  });

  test("a diverged default branch that conflicts with origin's stops the landing, and /orc names it", () => {
    const fixture = builtCli(localWithTickets());
    fixture.git("remote", "add", "origin", "https://example.com/repo.git");
    const base = fixture.git("rev-parse", "main");
    fixture.write("README.md", "local wording").commit("docs: reword locally");
    const tree = treeWith(fixture, base, "README.md", "origin wording");
    fixture.git("update-ref", "refs/remotes/origin/main", fixture.git("commit-tree", "-p", base, "-m", "docs: reword on origin", tree));
    const land = stopOf(fixture.verdict(["orc-land"]));
    assert.equal(land.reason, "conflict");
    assert.match(land.message.at(-1) ?? "", /^The default branch and origin's have diverged and conflict/);
    assert.equal(pointer(land.next), "Done. Next: /orc   (after merging origin's default branch into the default branch by hand: they conflict)");
    assert.match(goOf(fixture.verdict(["orc"]), "orc").report.join("\n"), /Diverged: the default branch and origin's \(as last fetched\) each hold 1 commit the other lacks, and they conflict: merge origin's into it by hand/);
  });
});

/** A commit tree: `base`'s tree with one file replaced, built with plumbing so no branch or index moves. */
function treeWith(fixture: Fixture, base: string, path: string, text: string): string {
  const written = spawnSync("git", ["-C", fixture.root, "hash-object", "-w", "--stdin"], { input: text, encoding: "utf8", env: GIT_ENV }).stdout.trim();
  const listing = fixture.git("ls-tree", base).split("\n").filter((line) => !line.endsWith(`\t${path}`));
  const tree = spawnSync("git", ["-C", fixture.root, "mktree"], { input: [...listing, `100644 blob ${written}\t${path}`].join("\n") + "\n", encoding: "utf8", env: GIT_ENV }).stdout.trim();
  return tree;
}

describe("/orc-next", () => {
  test("its nested verdict reuses the facts it gathered: no second round of GitHub queries", () => {
    const fixture = githubRepo();
    const orc = runner(fakeGh({ subIssues: TICKETS }));
    fixture.verdict(["orc"], orc.run);
    const next = runner(fakeGh({ subIssues: TICKETS }));
    const go = goOf(fixture.verdict(["orc-next"], next.run), "orc-next");
    assert.equal(go.proposed.command, "/orc-build auth");
    assert.equal(graphqlCalls(next.ghCalls).length, graphqlCalls(orc.ghCalls).length);
  });

  test("it proposes the next step with that command's own verdict for its entry", () => {
    const verdict = localWithTickets().verdict(["orc-next"]);
    const go = goOf(verdict, "orc-next");
    assert.deepEqual(go.proposed, { command: "/orc-build cli", reason: "3 of 3 tickets to build; start it after /clear", kind: "run" });
    assert.equal(go.verdict.command, "orc-build");
    assert.equal(goOf(go.verdict, "orc-build").entry.name, "cli");
  });

  test("a manual next step is a stop", () => {
    const fixture = builtCli(localWithTickets());
    fixture.write("src/a.js", "1").write("src/b.js", "2").write("src/c.js", "3").commit("feat: squashed", "cli/01", "cli/02", "cli/03");
    assert.equal(stopOf(fixture.verdict(["orc-next"])).reason, "manual");
  });
});

// ---------------------------------------------------------------------------
// The text form
// ---------------------------------------------------------------------------

describe("the text form", () => {
  test("it opens with the verdict header and prints the banner and resolution lines ready-made", () => {
    const text = localWithTickets().text(["orc-build"]);
    const lines = text.split("\n");
    assert.equal(lines[0], "orc verdict 1 orc-build go");
    assert.match(lines[1] ?? "", /^Stamp: [0-9a-f]{7} 2026-11-22T09:14:03Z$/);
    assert.ok(lines.includes("  Target:  cli (none given: the active spec)"));
    assert.ok(lines.includes("  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md"));
    assert.ok(lines.includes("  Pinned:  implement-spec @ 1a2b3c4, tdd @ 1a2b3c4, code-review @ 1a2b3c4"));
    assert.ok(lines.includes("    ref=cli/02 satisfies=REQ-01 blockers=cli/01"));
    assert.ok(lines.includes("  DirtyOther: 0"));
  });

  test("the banners say that GitHub bookkeeping goes with its step whatever push says", () => {
    const fixture = localWithTickets();
    const outward = (command: string): string => /^ {2}Outward: (.+)$/m.exec(fixture.text([command]))?.[1] ?? "";
    assert.equal(outward("orc-build"), "none (no push, no PR; /orc-land lands the branch); GitHub, whatever push says: built labels and the pending-decisions comment");
    assert.equal(outward("orc-discuss"), "pushes the default branch (per push); GitHub, whatever push says: edits or deletes the pending-decisions comment");
    assert.equal(outward("orc-land"), "per push: pushes, opens and merges PRs as the mode says, deletes origin/spec/<name>; GitHub, whatever push says: closes the issues");
  });

  test("a typed argument shows as given in the banner, and an unsafe one is withheld", () => {
    const fixture = localWithTickets();
    assert.match(fixture.text(["orc-build", "cli"]), /Target: {2}cli \(as given\)/);
    assert.match(fixture.text(["orc-build", "#13"]), /Target: {2}#13 \(as given\)/);
    assert.match(fixture.text(["orc-build", "x;rm"]), /Target: {2}withheld \(as given\)/);
  });

  test("--core appends the shared core after the verdict; without it the core is left out", () => {
    const fixture = localWithTickets();
    const withCore = fixture.text(["orc-spec", "--core"]);
    assert.match(withCore, /\nCore:\n {2}# Orc core\n {2}\n {2}The banner first\.\n$/);
    assert.doesNotMatch(fixture.text(["orc-spec"]), /Core:/);
  });

  test("--core without the core beside the script is a stop, since a run cannot follow what it never got", () => {
    const fixture = localWithTickets();
    const env = { ...environment(fixture.root, runner().run), readCore: () => null };
    const text = runStatus(["orc-tickets", "--core"], env).stdout;
    assert.match(text, /^orc verdict 1 orc-tickets stop$/m);
    assert.match(text, /^ {2}Reason: error$/m);
    assert.match(text, /conventions\.md, is missing beside status\.mts/);
    assert.match(text, /^ {2}Pointer: Done\. Next: \/orc {3}\(after reinstalling orc\)$/m);
    assert.match(text, /^ {2}\/orc-tickets {2}\(GSD: plan-phase\)$/m, "the banner still prints");
    assert.doesNotMatch(text, /Core:/);
    assert.match(runStatus(["orc-tickets"], env).stdout, /^orc verdict 1 orc-tickets go$/m, "a call without --core needs no core");
    const pick = runStatus(["orc-tickets", "nope", "--core"], env).stdout;
    assert.match(runStatus(["orc-tickets", "nope"], env).stdout, /^orc verdict 1 orc-tickets pick$/m);
    assert.match(pick, /^orc verdict 1 orc-tickets stop$/m, "a pick asked for with --core stops too");
    assert.match(pick, /conventions\.md, is missing beside status\.mts/);
  });

  describe("every channel from outside the script reaches the text form only as a reference, while --json holds it unless no form does", () => {
    const MARK = "TAINTED";
    const ALL = ["orc", "orc-next", "orc-setup", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"];
    /**
     * Each command's text, given `target` when there is one, lacks the marker, and the named --json form holds it,
     * which proves the plant was reached. `json` is null for a value no --json form holds, whose test proves the
     * read through what the script made of it instead.
     */
    const check = (fixture: Fixture, run: () => Runner, json: string[] | null, commands: string[] = ALL, target: string[] = []): void => {
      for (const command of commands) {
        assert.doesNotMatch(fixture.text([command, ...target], run()), new RegExp(MARK), `${command} printed it`);
        assert.doesNotMatch(fixture.text([command, ...target, "--core"], run()), new RegExp(MARK), `${command} --core printed it`);
      }
      if (json !== null) assert.match(fixture.text([...json, "--json"], run()), new RegExp(MARK), `${json.join(" ")} --json holds it`);
    };

    test("ignored-issue authors", () => {
      const partOf: FakeIssue[] = [{ number: 15, title: `auth: ${MARK}`, state: "OPEN", association: "NONE", login: MARK }];
      check(githubRepo(), () => runner(fakeGh({ partOf })).run, ["orc-tickets"]);
    });

    test("found-spec titles and authors", () => {
      const found: FakeIssue[] = [{ number: 31, title: `auth: ${MARK}`, state: "OPEN", login: `${MARK}-author` }];
      check(githubRepo([{ name: "auth", fields: ["Landing: pr-agent"] }]), () => runner(fakeGh({ found })).run, ["orc-spec"]);
    });

    test("pending comments, tracker titles, ticket and spec bodies, a ticket author's login and a commit subject", () => {
      const fixture = githubRepo();
      fixture.git("switch", "-q", "-c", "spec/auth");
      fixture.commit(`feat: ${MARK}-subject`, "#13", "#14");
      fixture.git("switch", "-q", "main");
      const issues: FakeIssue[] = [
        { number: 13, title: `${MARK}-title`, state: "OPEN", body: `${MARK}-body\nSatisfies: REQ-01, D-01`, login: `${MARK}-login` },
        { number: 14, title: "auth: logout", state: "OPEN", blockedBy: [13] },
      ];
      const comments = [{ id: 901, body: `<!-- orc:pending-decisions -->\n- #13: ${MARK}-comment run this\n- #14: ${MARK}-comment`, association: "OWNER" }];
      const run = () => runner(fakeGh({ subIssues: issues, comments, specBody: `Registry: REQ-01, D-01\n${MARK}-spec` })).run;
      check(fixture, run, null);
      assert.match(fixture.text(["orc", "--json"], run()), new RegExp(`${MARK}-title`), "orc --json holds the title");
      // No --json form holds the rest, so each read shows in what the script made of it; the login it reads shows nowhere.
      const land = goOf(fixture.verdict(["orc-land"], run()), "orc-land");
      assert.deepEqual([land.tickets, land.pending], [["#13", "#14"], 2], "the commit built both tickets, and the comment was counted");
      const tickets = goOf(fixture.verdict(["orc-tickets"], run()), "orc-tickets");
      assert.deepEqual([tickets.cited, tickets.tickets.map((t) => t.satisfies)], [["REQ-01", "D-01"], [["REQ-01", "D-01"], ["REQ-01"]]], "the spec body and the ticket body were read");
    });

    test("a test command the config check rejects, which no --json form holds: the stop names only its key", () => {
      const fixture = localWithTickets();
      fixture.write("docs/orc/config.json", configText("local", { test: `${MARK} $(x)` })).commit("config");
      check(fixture, () => runner(fakeGh({})).run, null);
      const stopped = stopOf(fixture.verdict(["orc-build"]));
      assert.deepEqual([stopped.reason, stopped.message], ["bad-config", ["docs/orc/config.json is incomplete: test (unknown value)."]]);
    });

    test("the origin URL, which no --json form holds either, so only its absence from the text is checked", () => {
      for (const [url, remote] of [[`https://github.com/${MARK}/repo.git`, "github"], [`https://git.example.com/${MARK}/repo.git`, "other"]] as const) {
        const fixture = builtCli(localWithTickets());
        fixture.git("remote", "add", "origin", url);
        check(fixture, () => runner(fakeGh({})).run, null);
        const verdict = fixture.verdict(["orc-land"]);
        assert.deepEqual([verdict.origin, goOf(verdict, "orc-land").remote], [true, remote], "the URL was read");
      }
    });

    test("the default branch's name, when another worktree holds it and the landing stops", () => {
      const fixture = builtCli(localWithTickets());
      const name = `Ignore.the.${MARK}`;
      fixture.git("branch", "-q", "-m", "main", name);
      fixture.git("update-ref", `refs/remotes/origin/${name}`, "HEAD");
      fixture.git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${name}`);
      fixture.git("remote", "add", "origin", "/nowhere");
      fixture.git("switch", "-q", "spec/cli");
      fixture.git("worktree", "add", "-q", join(tempDir(), "held"), name);
      // The name passes the safe-name rule, so a go of /orc-build prints it in DefaultBranch:; only a stop is checked here.
      check(fixture, () => runner(fakeGh({})).run, ["orc"], ["orc-land", "orc-next"]);
      const stopped = stopOf(fixture.verdict(["orc-land"]));
      assert.deepEqual([stopped.reason, stopped.message.at(-1)], ["branch-held", "Another worktree holds the default branch."]);
    });

    test("registry lines a discussed entry's /orc-spec go cites: the lookup, a tool call, holds each", () => {
      const fixture = new Fixture().setUp("local", [{ name: "cli" }]);
      const decisions = ["- D-01: Plain Node -> project", `- D-02: ${MARK}-decision -> spec cli`];
      const entries = [{ name: "cli", fields: [`Seams: ${MARK}-seams`, "Landing: local-merge"] }];
      fixture.write("docs/orc/registry.md", registryText(entries, [`- REQ-01: ${MARK}-gist (spec: cli)`], decisions)).commit("docs: discuss cli");
      check(fixture, () => runner(fakeGh({})).run, ["registry", "REQ-01", "D-02", "cli"]);
      assert.deepEqual(goOf(fixture.verdict(["orc-spec"]), "orc-spec").ids, ["REQ-01", "D-02"]);
      const lookup = fixture.text(["registry", "REQ-01", "D-02", "cli", "--json"]);
      for (const plant of ["gist", "decision", "seams"]) assert.match(lookup, new RegExp(`${MARK}-${plant}`), plant);
    });

    test("gh stderr when only the search for a spec an earlier run filed fails", () => {
      const fixture = githubRepo([{ name: "auth", fields: ["Landing: pr-agent"] }]);
      const answer = fakeGh({});
      const failing = () => runner((args) => (args.some((arg) => arg.includes("f: search(")) ? { status: 1, stdout: "", stderr: `${MARK} from gh` } : answer(args))).run;
      check(fixture, failing, ["orc-spec"]);
      const stopped = stopOf(fixture.verdict(["orc-spec"], failing()));
      assert.deepEqual([stopped.reason, stopped.message.at(-1), stopped.error], ["lookup-failed", "The search for a spec an earlier run may have filed failed.", `gh api graphql failed: ${MARK} from gh`]);
    });

    test("a dirty path's name, when the landing stops on it", () => {
      const fixture = builtCli(localWithTickets());
      fixture.write(`${MARK}-dirty.txt`, "x");
      check(fixture, () => runner(fakeGh({})).run, ["orc"]);
      const stopped = stopOf(fixture.verdict(["orc-land"]));
      assert.deepEqual([stopped.reason, stopped.message.at(-1)], ["dirty", "The working tree has uncommitted changes, and landing switches branches."]);
    });

    test("a ticket's title, when the build is typed with that ticket", () => {
      const fixture = localWithTickets();
      fixture.localTicket("cli", "01", `${MARK} skeleton`).commit("docs: retitle the first ticket");
      check(fixture, () => runner(fakeGh({})).run, ["orc"], ["orc-build"], ["cli/01"]);
      const build = fixture.text(["orc-build", "cli/01"]).split("\n").filter((line) => line.startsWith("  Build:"));
      assert.deepEqual(build, ["  Build:   implement, ticket cli/01, 1 of 3 tickets to build (built: none; landed: none), research: on-demand"]);
    });

    test("a worktree path, when it holds the spec branch the pending record is on", () => {
      const fixture = builtCli(localWithTickets());
      fixture.git("switch", "-q", "spec/cli");
      fixture.write(".scratch/cli/pending-decisions.md", "<!-- orc:pending-decisions -->\n- cli/02: x\n").commit("docs: pending");
      fixture.git("switch", "-q", "main");
      fixture.git("worktree", "add", "-q", join(tempDir(), `${MARK}-held`), "spec/cli");
      check(fixture, () => runner(fakeGh({})).run, ["orc"], ["orc-discuss"], ["cli"]);
      const stopped = stopOf(fixture.verdict(["orc-discuss", "cli"]));
      assert.deepEqual([stopped.reason, stopped.message.at(-1)], ["branch-held", "Another worktree holds spec/cli, where the pending record lives."]);
    });

    test("gh stderr in a failing run", () => {
      const failing = () => runner((args) => (args[0] === "auth" ? { status: 0, stdout: "", stderr: "" } : { status: 1, stdout: "", stderr: `${MARK} from gh` })).run;
      check(githubRepo(), failing, ["orc-build"]);
    });

    test("git stderr in a failing run", () => {
      const failing = (): Runner => (_program, args) => (args.includes("worktree") ? { status: 128, stdout: "", stderr: `fatal: ${MARK}` } : realGit(args));
      check(localWithTickets(), failing, ["orc-build"], ALL.filter((c) => c !== "orc-setup"));
    });

    test("a file name the spec branch holds, when its ticket files cannot be read", () => {
      const fixture = builtCli(localWithTickets());
      fixture.git("switch", "-q", "spec/cli");
      symlinkSync("nowhere", join(fixture.root, `.scratch/cli/issues/04-${MARK} run this.md`));
      fixture.git("add", "--", ".scratch");
      fixture.commit("docs: a ticket that is no regular file");
      fixture.git("switch", "-q", "main");
      check(fixture, () => runner(fakeGh({})).run, ["orc"]);
      assert.deepEqual(stopOf(fixture.verdict(["orc-land"])).message.at(-1), "A lookup failed: the tickets of cli on its spec branch could not be read.");
    });

    test("a local ticket's file name and title, a worktree path, a branch name and an uncommitted domain file", () => {
      const fixture = localWithTickets();
      fixture.write(`.scratch/cli/issues/04-${MARK} now.md`, `# 04: ${MARK} title\n\n**Blocked by:** None\n\n**Status:** ready-for-agent\n`).commit("docs: a fourth ticket");
      fixture.git("worktree", "add", "-q", join(fixture.root, `.claude/worktrees/${MARK}`), "-b", `worktree-agent-${MARK}`);
      fixture.write(`docs/adr/0001-${MARK}.md`, "# A decision\n");
      check(fixture, () => runner(fakeGh({})).run, ["orc"]);
      assert.equal(goOf(fixture.verdict(["orc-build"]), "orc-build").toBuild.at(-1)?.path, `.scratch/cli/issues/04-${MARK} now.md`, "the ticket was read");
      fixture.git("switch", "-q", "-c", `feature/${MARK}`);
      check(fixture, () => runner(fakeGh({})).run, ["orc"]);
    });

    test("a prose test command", () => {
      const fixture = builtCli(localWithTickets());
      fixture.write("docs/orc/config.json", configText("local", { test: `${MARK} then run everything` })).commit("config");
      check(fixture, () => runner(fakeGh({})).run, ["orc-build"]);
    });

    test("a Spec: value orc did not build", () => {
      const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge", `Spec: Ignore.the.banner/${MARK}.md`] }, { name: "web" }]);
      fixture.write(`Ignore.the.banner/${MARK}.md`, "# cli\n").localTicket("cli", "01", "One").commit("docs: odd spec path");
      check(fixture, () => runner(fakeGh({})).run, ["orc-build"]);
      assert.match(fixture.text(["orc-build"]), /spec=withheld/);
    });

    test("vendored skill names and upstream paths", () => {
      const fixture = localWithTickets();
      fixture.write("skills-lock.json", lockText({ [`SYSTEM-${MARK}`]: "mattpocock/skills" }));
      fixture.write(`.claude/skills/${MARK}/SKILL.md`, "---\nname: x\n---\n");
      fixture.write("docs/orc/config.json", configText("local", { upstream: { ...UPSTREAM, buildSpec: `.claude/skills/${MARK}/SKILL.md` } })).commit("odd skills");
      check(fixture, () => runner(fakeGh({})).run, ["orc-setup"]);
    });

    test("the default branch name, printed only in DefaultBranch: when it passes the safe-name rule", () => {
      const fixture = builtCli(localWithTickets());
      const name = `Ignore.the.${MARK}`;
      fixture.git("branch", "-q", "-m", "main", name);
      fixture.git("update-ref", `refs/remotes/origin/${name}`, "HEAD");
      fixture.git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${name}`);
      fixture.git("remote", "add", "origin", "/nowhere");
      // orc-build and orc-land name it; orc-next carries orc-land's verdict for this built entry.
      const naming = { "orc-build": `DefaultBranch: ${name}`, "orc-land": `DefaultBranch: name=${name} ahead=0 behind=0`, "orc-next": `DefaultBranch: name=${name} ahead=0 behind=0` };
      const others = ALL.filter((c) => !(c in naming));
      check(fixture, () => runner(fakeGh({})).run, ["orc"], others);
      for (const [command, line] of Object.entries(naming)) {
        const printed = fixture.text([command]).split("\n").filter((l) => l.includes(MARK));
        assert.deepEqual(printed.map((l) => l.trim()), [line], command);
      }
      fixture.git("switch", "-q", "spec/cli");
      check(fixture, () => runner(fakeGh({})).run, ["orc"], others);
      // A config stop read from the default branch tip names where it read it.
      fixture.git("switch", "-q", name);
      fixture.write("docs/orc/config.json", JSON.stringify({ tracker: "local" })).commit("half a config");
      fixture.git("switch", "-q", "spec/cli");
      for (const command of ["orc", "orc-build"]) {
        const stopped = fixture.text([command]);
        assert.match(stopped, /incomplete/);
        assert.doesNotMatch(stopped, new RegExp(MARK), command);
      }
      fixture.git("switch", "-q", name);
      fixture.git("revert", "--no-edit", "HEAD");
      fixture.git("switch", "-q", "spec/cli");
      fixture.git("branch", "-q", "-m", name, `${MARK},branch`);
      fixture.git("update-ref", `refs/remotes/origin/${MARK},branch`, `refs/remotes/origin/${name}`);
      fixture.git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${MARK},branch`);
      fixture.git("switch", "-q", `${MARK},branch`);
      check(fixture, () => runner(fakeGh({})).run, ["orc"]);
    });
  });

  describe("the whole text form, line for line", () => {
    /** The text form with HEAD's short SHA in each Stamp: line replaced, since commit SHAs differ from run to run. */
    const expectText = (fixture: Fixture, args: string[], lines: readonly string[], run: Runner = runner().run): void => {
      const text = fixture.text(args, run).replace(/^( *Stamp: )[0-9a-f]{7} /gm, "$1<head> ");
      assert.equal(text, `${lines.join("\n")}\n`);
    };
    /** `cli` with its first ticket built on spec/cli. */
    const oneBuilt = (): Fixture => {
      const fixture = localWithTickets();
      fixture.git("switch", "-q", "-c", "spec/cli");
      fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
      fixture.git("switch", "-q", "main");
      return fixture;
    };

    test("orc: a go, the report under it", () => {
      expectText(oneBuilt(), ["orc"], [
        "orc verdict 1 orc go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc  (GSD: progress)",
        "  Runs:    orc's status script (no upstream skill)",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict",
        "  Writes:  nothing",
        "  Outward: none",
        "Lines:",
        "  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "  State:   building, 1 of 3 tickets built",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: none",
        "Upstream: none",
        "Reference: none",
        "Go:",
        "  Report:",
        "    Docs: the working tree",
        "    Roadmap:",
        "      1. cli  building, 1 of 3 tickets built",
        "      2. later  not-started",
        "    Target: cli, branch spec/cli",
        "    State: building, 1 of 3 tickets built",
        "    Landing: local-merge (the entry's Landing: line)",
        "    Delivers: REQ-01 REQ-02",
        "    Tickets: 0 landed, 1 built, 0 in progress, 2 open, of 3",
        "      cli/01 built",
        "      cli/02 ready",
        "      cli/03 blocked (waiting on cli/02)",
        "    Untrailed commits on spec/cli: none",
        "    Off the main flow, ask upstream's /ask-matt.",
        "    Done. Next: /orc-build cli   (2 of 3 tickets to build on spec/cli; start it after /clear)",
      ]);
    });

    test("orc-next: a go, the proposed command's own verdict nested under it", () => {
      expectText(oneBuilt(), ["orc-next"], [
        "orc verdict 1 orc-next go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-next  (GSD: next)",
        "  Runs:    the orc command you confirm, by following its skill file",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, then the confirmed command's skill file",
        "  Writes:  nothing until you confirm; then what that command's banner says",
        "  Outward: none until you confirm; then what that command's banner says",
        "Lines: none",
        "Ids: none",
        "Upstream: none",
        "Reference: none",
        "Go:",
        "  Proposed: run /orc-build cli   (2 of 3 tickets to build on spec/cli; start it after /clear)",
        "  Verdict:",
        "    orc verdict 1 orc-build go",
        "    Stamp: <head> 2026-11-22T09:14:03Z",
        "    Origin: no",
        "    Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "      /orc-build  (GSD: execute-phase)",
        "      Runs:    upstream implement-spec or implement, with tdd and code-review, at their locked commits",
        "      Target:  cli (as given)",
        "      Reads:   orc's verdict, the spec, its tickets, the registry lines they cite",
        "      Writes:  code and tests on spec/<name>, every commit with its ticket's Refs: trailer",
        "      Outward: none (no push, no PR; /orc-land lands the branch); GitHub, whatever push says: built labels and the pending-decisions comment",
        "    Lines:",
        "      Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "      Pinned:  implement-spec @ 1a2b3c4, tdd @ 1a2b3c4, code-review @ 1a2b3c4",
        "      Build:   implement-spec, 2 of 3 tickets to build (built: cli/01; landed: none), research: on-demand",
        "    LinesOpen: every picker question, stop message and the final report",
        "    Ids: REQ-01 REQ-02 D-01",
        "    Upstream:",
        "      role=buildSpec skill=implement-spec path=.claude/skills/implement-spec/SKILL.md pin=1a2b3c4 invoke=read",
        "      role=none skill=tdd path=.claude/skills/tdd/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "      role=none skill=code-review path=.claude/skills/code-review/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "    Reference: none",
        "    Go:",
        "      Entry: number=1 name=cli spec=.scratch/cli/spec.md branch=spec/cli",
        "      Ticket: none",
        "      Phase: build",
        "      Mode: implement-spec",
        "      ToBuild:",
        "        ref=cli/02 satisfies=REQ-01 blockers=cli/01",
        "        ref=cli/03 satisfies=REQ-01 blockers=cli/01,cli/02",
        "      Built: cli/01",
        "      Landed: none",
        "      Branch: local",
        "      MergeDefault: no",
        "      AgentBranches: 0",
        "      DirtyOther: 0",
        "      ReviewFixRounds: 1",
        "      Research: on-demand",
        "      Test: set",
        "      BuildStart: ask",
        "      DefaultBranch: main",
        "      Pending: none",
        "      ToMark: cli/01",
        "      Pointer: Done. Next: /orc-build cli   (2 of 3 tickets to build on spec/cli; start it after /clear)",
      ]);
    });

    test("orc-setup: an update's go", () => {
      expectText(localWithTickets(), ["orc-setup"], [
        "orc verdict 1 orc-setup go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-setup  (GSD: new-project, tooling part)",
        "  Runs:    npx -y skills@1 add mattpocock/skills at one pinned commit; first run: upstream setup-matt-pocock-skills",
        "  Target:  this repo",
        "  Reads:   orc's verdict, mattpocock/skills (a shallow clone)",
        "  Writes:  .claude/skills/, skills-lock.json, .claude/rules/, .claude/settings.json, .gitignore, docs/agents/, docs/orc/config.json; one commit after you confirm",
        "  Outward: GitHub tracker: creates upstream's labels and orc's built and orc-ticket",
        "Lines:",
        "  Mode:    update",
        "  Pinned:  setup-matt-pocock-skills @ 1a2b3c4",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: none",
        "Upstream:",
        "  role=setup skill=setup-matt-pocock-skills path=.claude/skills/setup-matt-pocock-skills/SKILL.md pin=1a2b3c4 invoke=read",
        "Reference: update",
        "Go:",
        "  Run: update",
        "  Config: present",
        "  MissingKeys: none",
        "  BadKeys: none",
        "  TrackerLocked: yes",
        "  Remote: none",
        "  Gh: ok",
        "  TestCandidates: 0",
        "  Vendored:",
        "    skill=grilling pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=domain-modeling pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=to-spec pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=to-tickets pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=implement-spec pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=implement pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=tdd pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=code-review pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=pr pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        "    skill=setup-matt-pocock-skills pin=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      ], runner(fakeGh({})).run);
    });

    test("orc-discuss: a first visit's go", () => {
      expectText(new Fixture().setUp("local", [{ name: "cli" }]), ["orc-discuss"], [
        "orc verdict 1 orc-discuss go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-discuss  (GSD: new-project interview, discuss-phase)",
        "  Runs:    upstream grilling and domain-modeling, at their locked commits",
        "  Target:  cli (none given: the one entry to discuss)",
        "  Reads:   orc's verdict, docs/orc/registry.md, GLOSSARY.md and docs/adr/, the pending decisions",
        "  Writes:  the glossary and ADRs during the interview; registry lines only after you confirm, one commit",
        "  Outward: pushes the default branch (per push); GitHub, whatever push says: edits or deletes the pending-decisions comment",
        "Lines:",
        "  Target:  cli (roadmap entry 1), no spec yet",
        "  Pinned:  grilling @ 1a2b3c4, domain-modeling @ 1a2b3c4",
        "  Mode:    spec interview, first visit",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: none",
        "Upstream:",
        "  role=discuss skill=grilling path=.claude/skills/grilling/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "  role=domain skill=domain-modeling path=.claude/skills/domain-modeling/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "Reference: none",
        "Go:",
        "  Mode: spec",
        "  Entry: number=1 name=cli spec=none branch=spec/cli",
        "  Visit: first",
        "  Tracker: local",
        "  Push: ask",
        "  Landing: local-merge",
        "  Pending: none",
        "  Remote: none",
        "  UncommittedRegistry: no",
        "  UncommittedDomain: 0",
        "  Problems: none",
        "  Pointer: Done. Next: /orc-discuss cli   (spec interview for cli)",
      ]);
    });

    test("orc-spec: a discussed entry's go", () => {
      const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Seams: CLI only", "Landing: local-merge"] }], { requirements: REQUIREMENTS });
      expectText(fixture, ["orc-spec"], [
        "orc verdict 1 orc-spec go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-spec  (GSD: spec-phase)",
        "  Runs:    upstream to-spec (config role spec), at its locked commit",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, the registry lines it cites, GLOSSARY.md and docs/adr/, this conversation",
        "  Writes:  the spec, then its Spec: and Branch: lines in docs/orc/registry.md, one commit",
        "  Outward: GitHub: creates the spec issue; both: pushes the default branch (per push)",
        "Lines:",
        "  Target:  cli (roadmap entry 1), no spec yet",
        "  Pinned:  to-spec @ 1a2b3c4",
        "  State:   discussed",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: REQ-01 REQ-02",
        "Upstream:",
        "  role=spec skill=to-spec path=.claude/skills/to-spec/SKILL.md pin=1a2b3c4 invoke=read",
        "Reference: none",
        "Go:",
        "  Entry: number=1 name=cli spec=none branch=spec/cli",
        "  Tracker: local",
        "  Push: ask",
        "  Resume: none",
        "  Found: none",
        "  Ids: REQ-01 REQ-02",
        "  ProjectDecisions: 1 (registry --project)",
        "  TriageLabels: no",
        "  Pointer: Done. Next: /orc-spec cli   (cli is discussed, no spec yet; run it in the interview's session)",
      ]);
    });

    test("orc-tickets: a partial set's go", () => {
      const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli")], { requirements: REQUIREMENTS });
      fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01, REQ-02\n").localTicket("cli", "01", "Skeleton").commit("docs: add the cli spec and one ticket");
      expectText(fixture, ["orc-tickets"], [
        "orc verdict 1 orc-tickets go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-tickets  (GSD: plan-phase)",
        "  Runs:    upstream to-tickets (config role tickets), at its locked commit",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, the spec, the registry lines it cites, GLOSSARY.md and docs/adr/",
        "  Writes:  tickets with blocking edges, only after you approve the breakdown",
        "  Outward: GitHub: creates the ticket issues; local: pushes the default branch (both per push)",
        "Lines:",
        "  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "  Pinned:  to-tickets @ 1a2b3c4",
        "  State:   ticketed, 0 of 1 tickets built",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: REQ-01 REQ-02",
        "Upstream:",
        "  role=tickets skill=to-tickets path=.claude/skills/to-tickets/SKILL.md pin=1a2b3c4 invoke=read",
        "Reference: none",
        "Go:",
        "  Entry: number=1 name=cli spec=.scratch/cli/spec.md branch=spec/cli",
        "  Tracker: local",
        "  Push: ask",
        "  Cited: REQ-01 REQ-02",
        "  Set: partial",
        "  Tickets:",
        "    ref=cli/01 satisfies=REQ-01",
        "  Uncovered: REQ-02",
        "  Ignored: none",
        "  TriageLabels: no",
        "  Pointer: Done. Next: /orc-build cli   (1 of 1 tickets to build; start it after /clear)",
      ]);
    });

    test("orc-build: a spec build's go", () => {
      expectText(oneBuilt(), ["orc-build"], [
        "orc verdict 1 orc-build go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-build  (GSD: execute-phase)",
        "  Runs:    upstream implement-spec or implement, with tdd and code-review, at their locked commits",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, the spec, its tickets, the registry lines they cite",
        "  Writes:  code and tests on spec/<name>, every commit with its ticket's Refs: trailer",
        "  Outward: none (no push, no PR; /orc-land lands the branch); GitHub, whatever push says: built labels and the pending-decisions comment",
        "Lines:",
        "  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "  Pinned:  implement-spec @ 1a2b3c4, tdd @ 1a2b3c4, code-review @ 1a2b3c4",
        "  Build:   implement-spec, 2 of 3 tickets to build (built: cli/01; landed: none), research: on-demand",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: REQ-01 REQ-02 D-01",
        "Upstream:",
        "  role=buildSpec skill=implement-spec path=.claude/skills/implement-spec/SKILL.md pin=1a2b3c4 invoke=read",
        "  role=none skill=tdd path=.claude/skills/tdd/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "  role=none skill=code-review path=.claude/skills/code-review/SKILL.md pin=1a2b3c4 invoke=skill-tool",
        "Reference: none",
        "Go:",
        "  Entry: number=1 name=cli spec=.scratch/cli/spec.md branch=spec/cli",
        "  Ticket: none",
        "  Phase: build",
        "  Mode: implement-spec",
        "  ToBuild:",
        "    ref=cli/02 satisfies=REQ-01 blockers=cli/01",
        "    ref=cli/03 satisfies=REQ-01 blockers=cli/01,cli/02",
        "  Built: cli/01",
        "  Landed: none",
        "  Branch: local",
        "  MergeDefault: no",
        "  AgentBranches: 0",
        "  DirtyOther: 0",
        "  ReviewFixRounds: 1",
        "  Research: on-demand",
        "  Test: set",
        "  BuildStart: ask",
        "  DefaultBranch: main",
        "  Pending: none",
        "  ToMark: cli/01",
        "  Pointer: Done. Next: /orc-build cli   (2 of 3 tickets to build on spec/cli; start it after /clear)",
      ]);
    });

    test("orc-land: a built entry's go", () => {
      expectText(builtCli(localWithTickets()), ["orc-land"], [
        "orc verdict 1 orc-land go",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-land  (GSD: ship)",
        "  Runs:    the landing mode; PR modes: upstream pr (config role land), at its locked commit",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, git, the PR and its checks",
        "  Writes:  on spec/<name>: the default branch merged in and local tickets resolved; then the merge, branches and worktrees removed",
        "  Outward: per push: pushes, opens and merges PRs as the mode says, deletes origin/spec/<name>; GitHub, whatever push says: closes the issues",
        "Lines:",
        "  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "  Mode:    local-merge (the entry's Landing: line)",
        "  State:   built",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: none",
        "Upstream: none",
        "Reference: none",
        "Go:",
        "  Entry: number=1 name=cli spec=.scratch/cli/spec.md branch=spec/cli",
        "  Mode: local-merge source=entry",
        "  Push: ask",
        "  Phase: land",
        "  Tickets: cli/01 cli/02 cli/03",
        "  Unresolved: cli/01 cli/02 cli/03",
        "  ToResolve: cli/01 cli/02 cli/03",
        "  Branch: local=yes remote=no ahead=none behind=none behindDefault=0",
        "  DefaultBranch: name=main ahead=none behind=none",
        "  Pr: none",
        "  Pending: 0",
        "  Test: set",
        "  Remote: none",
        "  Pointer: Done. Next: /orc-land cli   (every ticket is built; landing mode local-merge)",
      ]);
    });

    test("orc-land: a ticketed entry's stop, its message opening with the resolution lines", () => {
      expectText(localWithTickets(), ["orc-land"], [
        "orc verdict 1 orc-land stop",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-land  (GSD: ship)",
        "  Runs:    the landing mode; PR modes: upstream pr (config role land), at its locked commit",
        "  Target:  cli (none given: the active spec)",
        "  Reads:   orc's verdict, git, the PR and its checks",
        "  Writes:  on spec/<name>: the default branch merged in and local tickets resolved; then the merge, branches and worktrees removed",
        "  Outward: per push: pushes, opens and merges PRs as the mode says, deletes origin/spec/<name>; GitHub, whatever push says: closes the issues",
        "Lines:",
        "  Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "  Mode:    local-merge (the entry's Landing: line)",
        "  State:   ticketed, 0 of 3 tickets built",
        "LinesOpen: every picker question, stop message and the final report",
        "Ids: none",
        "Upstream: none",
        "Reference: none",
        "Stop:",
        "  Reason: state",
        "  Message:",
        "    Target:  cli (roadmap entry 1), spec .scratch/cli/spec.md",
        "    Mode:    local-merge (the entry's Landing: line)",
        "    State:   ticketed, 0 of 3 tickets built",
        "    cli is ticketed, 0 of 3 tickets built, and only a built entry lands; not built: cli/01 cli/02 cli/03.",
        "  Kind: run",
        "  Pointer: Done. Next: /orc-build cli   (3 of 3 tickets to build; start it after /clear)",
      ]);
    });

    test("orc-land: a bare call's leftovers pick, which ends with Leftover:", () => {
      const fixture = builtCli(localWithTickets());
      fixture.git("merge", "-q", "--no-ff", "--no-edit", "spec/cli");
      expectText(fixture, ["orc-land"], [
        "orc verdict 1 orc-land pick",
        "Stamp: <head> 2026-11-22T09:14:03Z",
        "Origin: no",
        "Banner: print first, before any tool call, as plain text without this indent, never in a code block",
        "  /orc-land  (GSD: ship)",
        "  Runs:    the landing mode; PR modes: upstream pr (config role land), at its locked commit",
        "  Target:  none given",
        "  Reads:   orc's verdict, git, the PR and its checks",
        "  Writes:  on spec/<name>: the default branch merged in and local tickets resolved; then the merge, branches and worktrees removed",
        "  Outward: per push: pushes, opens and merges PRs as the mode says, deletes origin/spec/<name>; GitHub, whatever push says: closes the issues",
        "Lines: none",
        "Ids: none",
        "Upstream: none",
        "Reference: none",
        "Pick:",
        "  Why: leftovers",
        "  Candidates:",
        "    number=1 name=cli spec=.scratch/cli/spec.md",
        "    number=2 name=later spec=none",
        "  Other: no",
        "  OfferAdd: no",
        "  Leftover: branches=spec/cli unresolved=cli/01,cli/02,cli/03",
      ]);
    });
  });

  test("a go carries the pointer for the end of the run, and resolution lines say what they open", () => {
    const fixture = builtCli(localWithTickets());
    const go = goOf(fixture.verdict(["orc-build"]), "orc-build");
    assert.deepEqual(go.next, { command: "/orc-land cli", reason: "every ticket is built; landing mode local-merge", kind: "run" });
    const text = fixture.text(["orc-build"]);
    assert.match(text, /^ {2}Pointer: Done\. Next: \/orc-land cli {3}\(every ticket is built; landing mode local-merge\)$/m);
    assert.match(text, /^LinesOpen: every picker question, stop message and the final report$/m);
    assert.doesNotMatch(new Fixture().setUp("local", [{ name: "a" }, { name: "b" }]).text(["orc-discuss"]), /LinesOpen/, "a pick has no lines yet");
    // A fresh verdict after a lock points at the next step, never back at the command that gave it.
    const discussed = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }]);
    assert.equal(goOf(discussed.verdict(["orc-discuss", "cli"]), "orc-discuss").next.command, "/orc-spec cli");
    const squashed = builtCli(localWithTickets());
    squashed.write("src/a.js", "1").write("src/b.js", "2").write("src/c.js", "3").commit("feat: squashed", "cli/01", "cli/02", "cli/03");
    assert.equal(goOf(squashed.verdict(["orc-discuss", "cli"]), "orc-discuss").next.command, "/orc");
  });

  test("the locked-lines check names every line the registry held at a commit that is now changed or gone", () => {
    const fixture = new Fixture().setUp("local", [{ name: "cli", fields: ["Seams: CLI only", "Landing: local-merge"] }, { name: "web" }], { requirements: ["- REQ-01: Count (spec: cli)"] });
    const stamp = fixture.git("rev-parse", "--short=7", "HEAD");
    const path = join(fixture.root, "docs/orc/registry.md");
    const committed = readFileSync(path, "utf8");
    // Added lines anywhere, and the target's Seams: and Landing: on a revisit, leave every locked line in place.
    writeFileSync(path, committed.replace("- D-01: Plain Node -> project", "- D-01: Plain Node -> project\n- D-02: Added -> spec cli").replace("Seams: CLI only", "Seams: CLI and HTTP").replace("2. web", "   - Spec: .scratch/cli/spec.md\n2. web"));
    assert.equal(fixture.text(["locked", stamp, "cli"]), `orc locked ${stamp}: unchanged\n`);
    assert.match(fixture.text(["locked", stamp]), new RegExp(`^orc locked ${stamp}: changed: line 11$`, "m"), "without the entry, its Seams: line is locked too");
    writeFileSync(path, committed.replace("- REQ-01: Count (spec: cli)", "- REQ-01: Count twice (spec: cli)").replace("2. web\n", ""));
    assert.equal(fixture.text(["locked", stamp, "cli"]), `orc locked ${stamp}: changed: line 4, line 13\n`);
    assert.deepEqual(JSON.parse(fixture.text(["locked", stamp, "cli", "--json"])), { schema: 1, since: stamp, changed: [4, 13] });
    // Only the target's own Seams: and Landing: lines may change: the same line under another entry stays locked.
    const two = new Fixture().setUp("local", [{ name: "cli", fields: ["Landing: local-merge"] }, { name: "web", fields: ["Landing: local-merge"] }]);
    const twoStamp = two.git("rev-parse", "--short=7", "HEAD");
    const twoPath = join(two.root, "docs/orc/registry.md");
    writeFileSync(twoPath, readFileSync(twoPath, "utf8").replace("2. web\n   - Landing: local-merge", "2. web\n   - Landing: pr-agent"));
    assert.equal(two.text(["locked", twoStamp, "cli"]), `orc locked ${twoStamp}: changed: line 12\n`);
    assert.equal(two.text(["locked", twoStamp, "web"]), `orc locked ${twoStamp}: unchanged\n`);
    assert.equal(fixture.text(["locked", `${stamp} 2026-11-22T09:14:03Z`, "cli"]), `orc locked ${stamp}: changed: line 4, line 13\n`, "the stamp as a verdict prints it, its time included");
    assert.equal(fixture.text(["locked", `${stamp} soon`]), "orc locked error: the commit is not a commit id (7 to 40 hex digits)\n");
    assert.equal(fixture.text(["locked", "not-a-sha"]), "orc locked error: the commit is not a commit id (7 to 40 hex digits)\n");
    assert.equal(fixture.text(["locked", "0123456"]), "orc locked error: 0123456 is not a commit in this repository\n");
  });

  test("the locked-lines check holds each locked line to its own section and entry, so an appended copy never masks an edit", () => {
    const before = registryText(
      [
        { name: "memo-cli", fields: ["Seams: subprocess", "Landing: local-merge", "Spec: .scratch/memo-cli/spec.md", "Branch: spec/memo-cli"] },
        { name: "alpha", fields: ["Seams: http", "Landing: local-merge"] },
      ],
      ["- REQ-01: Count (spec: memo-cli)"],
    );
    const lineOf = (text: string): number => before.split("\n").indexOf(text) + 1;
    const alphaLanding = before.split("\n").lastIndexOf("   - Landing: local-merge") + 1;
    // The last locked line edited, then a new entry appended that ends in that line's old text.
    const masked = before.replace("2. alpha\n   - Seams: http\n   - Landing: local-merge", "2. alpha\n   - Seams: http\n   - Landing: pr-agent\n3. beta\n   - Seams: cli\n   - Landing: local-merge");
    assert.deepEqual(lockedChanges(before, masked, "beta"), [alphaLanding]);
    assert.deepEqual(lockedChanges(before, masked, "alpha"), [], "the target's own Landing: may change");
    // Two edits, then an append: exactly the edited lines are named, never their untouched neighbours.
    const edited = before
      .replace("- D-01: Plain Node -> project", "- D-01: Fancy Node -> project")
      .replace("   - Landing: local-merge\n   - Spec:", "   - Landing: pr-agent\n   - Spec:")
      .concat("3. new-one\n   - Seams: x\n   - Landing: local-merge\n");
    assert.deepEqual(lockedChanges(before, edited, "new-one"), [lineOf("- D-01: Plain Node -> project"), lineOf("   - Landing: local-merge")]);
    // A field moved to another entry, entries reordered, or a line moved to another section is a change too.
    const moved = before.replace("   - Seams: http\n", "").replace("2. alpha", "   - Seams: http\n2. alpha");
    assert.deepEqual(lockedChanges(before, moved, null), [lineOf("   - Seams: http")]);
    const reordered = before.replace(/1\. memo-cli\n(?:   - .*\n)+/, "").concat("1. memo-cli\n   - Seams: subprocess\n   - Landing: local-merge\n   - Spec: .scratch/memo-cli/spec.md\n   - Branch: spec/memo-cli\n");
    const swapped = lockedChanges(before, reordered, null);
    assert.equal(swapped.length, 1, "one of the two entries is out of its place");
    assert.ok([lineOf("1. memo-cli"), lineOf("2. alpha")].includes(swapped[0] ?? 0));
    const crossed = before.replace("- REQ-01: Count (spec: memo-cli)\n", "").replace("- D-01: Plain Node -> project", "- D-01: Plain Node -> project\n- REQ-01: Count (spec: memo-cli)");
    assert.deepEqual(lockedChanges(before, crossed, null), [lineOf("- REQ-01: Count (spec: memo-cli)")]);
    // Lines added anywhere, a Dropped: revisit that removes the target's Seams: and Landing:, and Spec: and Branch: lines are no change.
    const added = before
      .replace("- D-01: Plain Node -> project", "- D-01: Plain Node -> project\n- D-02: Added -> spec alpha")
      .replace("   - Seams: http\n   - Landing: local-merge", "   - Dropped: not needed");
    assert.deepEqual(lockedChanges(before, added, "alpha"), []);
    const specced = before.replace("   - Seams: http\n   - Landing: local-merge\n", "   - Seams: http\n   - Landing: local-merge\n   - Spec: .scratch/alpha/spec.md\n   - Branch: spec/alpha\n");
    assert.deepEqual(lockedChanges(before, specced, null), []);
  });

  test("the registry lookup prints lines as data, in text and JSON", () => {
    const fixture = localWithTickets();
    assert.equal(fixture.text(["registry", "REQ-01", "nope"]), "- REQ-01: Count things (spec: cli)\nnope: not in the registry\n");
    const json = parseLookup(fixture.text(["registry", "cli", "--json"]));
    assert.equal(json.keys[0]?.lines?.[0], "1. cli");
  });

  test("control characters from files become spaces in every form", () => {
    const fixture = localWithTickets();
    fixture.write("docs/orc/registry.md", registryText([SPECCED_LOCAL("cli")], ["- REQ-01: Bell\x07 and \x1b[2J clear\x9b (spec: cli)"])).commit("weird");
    assert.equal(fixture.text(["registry", "REQ-01"]), "- REQ-01: Bell  and  [2J clear  (spec: cli)\n");
    assert.doesNotMatch(fixture.text(["registry", "REQ-01", "--json"]), /[\x07\x1b\x9b]/);
  });
});

// ---------------------------------------------------------------------------
// The repository the script reads
// ---------------------------------------------------------------------------

describe("the repository the script reads", () => {
  /** The script installed in `own` and run from `cwd`, with real git and a gh that is never needed. */
  const runFrom = (cwd: string, own: string, args: string[]): string => runStatus(args, { ...environment(cwd, runner().run), scriptDir: own }).stdout;

  /** A repo whose spec branch conflicts with the default branch, so the judging runs merge-tree, and whose tracked file git status filters. */
  const configured = (): Fixture => {
    const fixture = localWithTickets();
    fixture.write(".gitattributes", "* merge=evil\n*.txt filter=evil\n").write("t.txt", "one\n").write("src/shared.js", "one\n").commit("feat: shared file");
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/shared.js", "ONE\n").commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    fixture.write("src/shared.js", "uno\n").commit("chore: main edits it too");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(fixture.root, "t.txt"), later, later);
    return fixture;
  };

  test("another repository is refused before any git call could run what its config names", () => {
    const own = new Fixture();
    own.commit("chore: orc's own checkout");
    const foreign = configured();
    const marker = join(tempDir(), "ran");
    foreign.git("config", "merge.evil.driver", `touch "${marker}"`);
    foreign.git("config", "filter.evil.clean", `touch "${marker}"`);
    for (const args of [["orc"], ["orc-build"], ["orc-land", "cli"], ["orc-next"]]) {
      const verdict = parseVerdict(runFrom(foreign.root, own.root, [...args, "--json"]));
      assert.equal(stopOf(verdict).reason, "other-repo", args.join(" "));
      assert.deepEqual([stopOf(verdict).next.reason, stopOf(verdict).next.kind], ["from the checkout orc is installed in", "manual"], args.join(" "));
    }
    assert.match(runFrom(foreign.root, own.root, ["orc"]), /^ {4}This directory is in another repository than the one orc is installed in/m);
    assert.equal(runFrom(foreign.root, own.root, ["registry", "cli"]), "orc lookup error: this directory is in another repository than the one orc is installed in\n");
    assert.equal(runFrom(foreign.root, own.root, ["locked", foreign.git("rev-parse", "HEAD")]), "orc locked error: this directory is in another repository than the one orc is installed in\n");
    assert.equal(existsSync(marker), false, "a command the other repository's config names ran");
    // The same repository read as its own runs both, which is what the refusal keeps from happening elsewhere.
    runFrom(foreign.root, foreign.root, ["orc"]);
    assert.equal(existsSync(marker), true, "the probe repository is configured so that judging it runs its commands");
  });

  test("the checkout's own repository is read with its fsmonitor command turned off", () => {
    const fixture = configured();
    const marker = join(tempDir(), "ran");
    fixture.git("config", "core.fsmonitor", `touch "${marker}"`);
    assert.match(runFrom(fixture.root, fixture.root, ["orc"]), /^orc verdict 1 orc go$/m);
    assert.equal(existsSync(marker), false, "the fsmonitor command ran");
  });

  test("the checkout root, a subdirectory and a linked worktree of the same repository are read; a script outside any is refused", () => {
    const fixture = localWithTickets();
    const scriptDir = join(fixture.root, ".claude", "skills", "orc");
    mkdirSync(scriptDir, { recursive: true });
    const deep = join(fixture.root, "src", "deep");
    mkdirSync(deep, { recursive: true });
    const worktree = join(tempDir(), "linked");
    fixture.git("worktree", "add", "-q", "-b", "side", worktree);
    for (const cwd of [fixture.root, deep, worktree]) assert.match(runFrom(cwd, scriptDir, ["orc"]), /^orc verdict 1 orc go$/m, cwd);
    assert.match(runFrom(fixture.root, scriptDir, ["registry", "REQ-01"]), /^- REQ-01: /);
    assert.equal(stopOf(parseVerdict(runFrom(fixture.root, tempDir(), ["orc", "--json"]))).reason, "other-repo");
  });

  test("a nested clone and a submodule are other repositories, while a path through a symlink is the checkout's own", () => {
    const fixture = localWithTickets();
    const scriptDir = join(fixture.root, ".claude", "skills", "orc");
    mkdirSync(scriptDir, { recursive: true });
    const clone = join(fixture.root, "vendor", "clone");
    assert.equal(realGit(["clone", "-q", fixture.root, clone]).status, 0);
    const other = new Fixture();
    other.commit("feat: a library");
    fixture.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", other.root, "lib");
    for (const cwd of [clone, join(fixture.root, "lib")]) assert.equal(stopOf(parseVerdict(runFrom(cwd, scriptDir, ["orc", "--json"]))).reason, "other-repo", cwd);
    const link = join(tempDir(), "link");
    symlinkSync(fixture.root, link);
    for (const [cwd, own] of [[link, scriptDir], [fixture.root, join(link, ".claude", "skills", "orc")], [link, join(link, ".claude", "skills", "orc")]] as const) {
      assert.match(runFrom(cwd, own, ["orc"]), /^orc verdict 1 orc go$/m, `${cwd} ${own}`);
    }
  });

  // A checkout's path spelled in other letter case names the same directory only where the filesystem folds case.
  const caseProbe = tempDir();
  const foldsCase = existsSync(join(caseProbe, "..", basename(caseProbe).toUpperCase()));
  test("a gitdir spelled in other letter case on a filesystem that folds case is the same repository", { skip: !foldsCase && "the filesystem is case-sensitive" }, () => {
    const fixture = localWithTickets();
    const scriptDir = join(fixture.root, ".claude", "skills", "orc");
    mkdirSync(scriptDir, { recursive: true });
    const worktree = join(tempDir(), "linked");
    fixture.git("worktree", "add", "-q", "-b", "side", worktree);
    const shouted = join(dirname(fixture.root), basename(fixture.root).toUpperCase());
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(shouted, ".git", "worktrees", "linked")}\n`);
    const named = realGit(["-C", worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout;
    assert.ok(named.endsWith(`/${basename(shouted)}/.git\n`), `git names the repository in the case the gitdir is written in: ${named}`);
    assert.match(runFrom(worktree, scriptDir, ["orc"]), /^orc verdict 1 orc go$/m);
  });

  test("a checkout whose path ends in a newline is read whole, never as its sibling", () => {
    const base = tempDir();
    const named = join(base, "nl\n");
    assert.equal(realGit(["clone", "-q", localWithTickets().root, named]).status, 0);
    assert.equal(realGit(["init", "-q", join(base, "nl")]).status, 0);
    assert.match(runFrom(named, named, ["orc"]), /^orc verdict 1 orc go$/m);
  });
});

// ---------------------------------------------------------------------------
// The script as a program
// ---------------------------------------------------------------------------

describe("the script as a program", () => {
  /** Runs a script as node would: `script` is a copy installed in a fixture, since the script reads only its own checkout. */
  const node = (script: string, cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env });
  /** Every file under `dir` to the SHA-256 of its bytes. */
  const snapshot = (dir: string): Map<string, string> => {
    const files = new Map<string, string>();
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.set(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
      }
    };
    walk(dir);
    return files;
  };
  /** The files under `dir` added, removed or changed since `before`, relative to `dir`. */
  const changedSince = (before: Map<string, string>, dir: string): string[] => {
    const after = snapshot(dir);
    return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).map((path) => path.slice(dir.length + 1));
  };

  test("every outcome exits 0 with nothing on stderr: a go, a usage error, an unknown entry, a non-repo, no git", () => {
    const fixture = localWithTickets();
    const script = fixture.installOrc();
    // Each case with the opening its output must have: the JSON's first fields, or the text form's header line.
    const cases: [string, string[], NodeJS.ProcessEnv, string][] = [
      [fixture.root, ["orc", "--json"], GIT_ENV, '{\n  "schema": 1,\n  "command": "orc",\n'],
      [fixture.root, ["--verbose"], GIT_ENV, "orc verdict 1 none stop\n"],
      [fixture.root, ["orc-build", "nothing-like-it"], GIT_ENV, "orc verdict 1 orc-build pick\n"],
      [tempDir(), ["orc"], GIT_ENV, "orc verdict 1 orc stop\n"],
      [fixture.root, ["orc"], { ...GIT_ENV, PATH: "" }, "orc verdict 1 orc stop\n"],
    ];
    for (const [cwd, args, env, header] of cases) {
      const result = node(script, cwd, args, env);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(result.stderr, "", args.join(" "));
      assert.ok(result.stdout.startsWith(header), `${args.join(" ")} opens with ${JSON.stringify(header)}: ${result.stdout.slice(0, 80)}`);
    }
  });

  test("git variables in the environment never point the script at another repository", () => {
    const own = localWithTickets();
    const script = own.installOrc();
    const foreign = new Fixture();
    foreign.write("other.js", "1").commit("feat: another repository's work");
    const ownHead = own.git("rev-parse", "--short", "HEAD");
    const foreignGit = join(foreign.root, ".git");
    const verdictFrom = (cwd: string, extra: NodeJS.ProcessEnv): Verdict => parseVerdict(node(script, cwd, ["orc", "--json"], { ...GIT_ENV, ...extra }).stdout);
    /** The verdict's head and outcome, which say whose repository was read. */
    const read = (extra: NodeJS.ProcessEnv): { head: string | null; outcome: Verdict["outcome"] } => {
      const verdict = verdictFrom(own.root, extra);
      return { head: verdict.stamp.head, outcome: verdict.outcome };
    };
    const plain = read({});
    assert.equal(plain.head, ownHead);
    const redirects: NodeJS.ProcessEnv[] = [
      { GIT_DIR: foreignGit },
      { GIT_DIR: foreignGit, GIT_WORK_TREE: foreign.root },
      { GIT_WORK_TREE: foreign.root },
      { GIT_COMMON_DIR: foreignGit },
      { GIT_INDEX_FILE: join(foreignGit, "index") },
    ];
    for (const extra of redirects) assert.deepEqual(read(extra), plain, JSON.stringify(extra));
    // The working directory alone names the repository, so another one is refused even when the variables name orc's own.
    assert.equal(stopOf(verdictFrom(foreign.root, { GIT_DIR: join(own.root, ".git"), GIT_WORK_TREE: own.root })).reason, "other-repo");
  });

  test("a bare repository found from the current directory is never read, so a config planted in one runs nothing", () => {
    const source = localWithTickets();
    const outer = new Fixture();
    const script = outer.installOrc();
    const planted = join(outer.root, "vendor", "planted");
    const marker = join(tempDir(), "ran");
    assert.equal(realGit(["clone", "-q", "--bare", source.root, planted]).status, 0);
    for (const [key, value] of [["core.bare", "false"], ["core.worktree", planted], ["core.fsmonitor", `touch "${marker}"`]] as const) {
      assert.equal(realGit(["-C", planted, "config", key, value]).status, 0);
    }
    mkdirSync(join(planted, "docs", "orc"), { recursive: true });
    writeFileSync(join(planted, "docs", "orc", "config.json"), configText("local"));
    writeFileSync(join(planted, "docs", "orc", "registry.md"), registryText([{ name: "cli" }]));
    for (const args of [["orc"], ["orc-build"], ["registry", "cli"], ["locked", "1a2b3c4"]]) {
      const result = node(script, planted, args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason: not-a-repo|not inside a git repository/, args.join(" "));
    }
    assert.equal(existsSync(marker), false, "the planted fsmonitor command ran");
  });

  test("running the script leaves the repository byte for byte unchanged, the index included", () => {
    const fixture = builtCli(localWithTickets());
    const script = fixture.installOrc();
    // A tracked file whose stat no longer matches the index is what makes git status refresh and rewrite the index.
    const tracked = join(fixture.root, ".scratch/cli/spec.md");
    const later = new Date(Date.now() + 60_000);
    utimesSync(tracked, later, later);
    const before = snapshot(fixture.root);
    for (const args of [["orc"], ["orc-build", "--core"], ["orc-land", "--json"], ["orc-discuss", "cli"], ["registry", "REQ-01"]]) {
      assert.doesNotMatch(node(script, fixture.root, args).stdout, /other-repo|another repository/, args.join(" "));
    }
    assert.deepEqual(changedSince(before, fixture.root), []);
  });

  test("judging a clean content merge and a conflicting one leaves .git byte for byte unchanged", () => {
    const fixture = localWithTickets();
    fixture.write("src/shared.js", "one\ntwo\nthree\nfour\nfive\n").commit("feat: shared file");
    fixture.git("switch", "-q", "-c", "spec/cli");
    fixture.write("src/shared.js", "ONE\ntwo\nthree\nfour\nfive\n").commit("feat: skeleton", "cli/01");
    fixture.git("switch", "-q", "main");
    fixture.write("src/shared.js", "one\ntwo\nthree\nfour\nFIVE\n").commit("chore: main edits another line");
    const script = fixture.installOrc();
    const gitDir = join(fixture.root, ".git");
    const clean = snapshot(gitDir);
    assert.match(node(script, fixture.root, ["orc"]).stdout, /^orc verdict 1 orc go$/m);
    assert.doesNotMatch(node(script, fixture.root, ["orc"]).stdout, /conflict/);
    assert.deepEqual(changedSince(clean, gitDir), []);
    fixture.write("src/shared.js", "uno\ntwo\nthree\nfour\nFIVE\n").commit("chore: main edits the first line too");
    const conflicting = snapshot(gitDir);
    assert.match(node(script, fixture.root, ["orc"]).stdout, /and the default branch conflict/);
    assert.deepEqual(changedSince(conflicting, gitDir), []);
  });

  test("the injected form from a subdirectory finds the checkout root", () => {
    const fixture = localWithTickets();
    const script = fixture.installOrc();
    const sub = join(fixture.root, "src", "deep");
    mkdirSync(sub, { recursive: true });
    const result = node(script, sub, ["orc"]);
    assert.match(result.stdout, /^orc verdict 1 orc go$/m);
  });

  test("hook reads the tool call on stdin, answers allow for its own call only, and exits 0 with nothing on stderr", () => {
    const fixture = localWithTickets();
    const hook = (command: string) =>
      spawnSync(process.execPath, [SCRIPT_PATH, "hook"], { cwd: fixture.root, encoding: "utf8", env: GIT_ENV, input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) });
    const own = hook(`node "${SCRIPT_PATH}" orc-build 'cli' --core`);
    assert.deepEqual([own.status, own.stderr], [0, ""]);
    assert.match(own.stdout, /^\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"allow",/);
    const other = hook(`node "${SCRIPT_PATH}" orc; rm -rf x`);
    assert.deepEqual([other.status, other.stderr, other.stdout], [0, "", ""]);
    const none = spawnSync(process.execPath, [SCRIPT_PATH, "hook"], { cwd: fixture.root, encoding: "utf8", env: GIT_ENV, input: "" });
    assert.deepEqual([none.status, none.stderr, none.stdout], [0, "", ""]);
  });

  test("a child process that does not answer in time is killed and reported as a timeout", () => {
    const bin = tempDir();
    writeFileSync(join(bin, "gh"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    try {
      const started = Date.now();
      const result = systemRunnerWith({ git: 5_000, gh: 200 })("gh", ["auth", "status"], tmpdir());
      assert.ok(Date.now() - started < 3_000, "the runner waits no longer than its timeout");
      assert.deepEqual(result, { status: TIMED_OUT, stdout: "", stderr: "gh did not answer within 0.2 s" });
    } finally {
      process.env.PATH = path;
    }
  });

  test("systemRunner reports a program that is not installed as status 127", () => {
    const path = process.env.PATH;
    process.env.PATH = "";
    try {
      assert.deepEqual(systemRunner("gh", ["--version"], tmpdir()), { status: 127, stdout: "", stderr: "gh: command not found" });
    } finally {
      process.env.PATH = path;
    }
  });
});
