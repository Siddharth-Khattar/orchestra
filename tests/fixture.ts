// ABOUTME: Shared fixtures for orc's tests: temporary git repos with an isolated git config, and a fake gh that answers GraphQL.
// ABOUTME: Imported by tests/status.test.ts and tests/budget.test.ts; it holds no tests of its own.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

import { runStatus, type CommandResult, type Environment, type Go, type LookupResult, type Pick, type Runner, type Status, type Stop, type Verdict } from "../skills/orc/status.mts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // Keeps git from finding a repository above the temp dir, which "outside a git repository" relies on.
  GIT_CEILING_DIRECTORIES: [tmpdir(), realpathSync(tmpdir())].join(":"),
};

export function realGit(args: readonly string[]): CommandResult {
  const result = spawnSync("git", args, { encoding: "utf8", env: GIT_ENV });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

type GhHandler = (args: readonly string[]) => CommandResult | undefined;

export const GH_MISSING: CommandResult = { status: 127, stdout: "", stderr: "gh: command not found" };
export const GH_LOGGED_OUT: CommandResult = { status: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login\n" };

/** A runner with real git and a scripted gh; an unscripted gh call fails the test loudly. */
export function runner(gh: GhHandler = () => undefined): { run: Runner; ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  const run: Runner = (program, args) => {
    if (program === "git") return realGit(args);
    ghCalls.push([...args]);
    const answer = gh(args);
    if (answer === undefined) throw new Error(`unscripted gh call: gh ${args.join(" ")}`);
    return answer;
  };
  return { run, ghCalls };
}

export const SCRIPT_PATH = join(import.meta.dirname, "..", "skills", "orc", "status.mts");

const CORE_TEXT = "# Orc core\n\nThe banner first.\n";

/** The script judged from `cwd` as if it were installed there: its own checkout is the one `cwd` is in. */
export function environment(cwd: string, run: Runner, nodeVersion = "v24.18.0"): Environment {
  return { cwd, scriptDir: cwd, run, now: new Date("2026-11-22T09:14:03.456Z"), nodeVersion, readCore: () => CORE_TEXT };
}

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "orc-status-"));
  tempDirs.push(dir);
  return dir;
}

export interface EntrySpec {
  name: string;
  fields?: string[];
}

export function registryText(entries: readonly EntrySpec[], requirements: readonly string[] = [], decisions: readonly string[] = ["- D-01: Plain Node -> project"]): string {
  const roadmap = entries.flatMap((entry, index) => [`${index + 1}. ${entry.name}`, ...(entry.fields ?? []).map((f) => `   - ${f}`)]);
  return ["# Registry", "", "## Requirements", ...requirements, "", "## Decisions", ...decisions, "", "## Roadmap", ...roadmap, ""].join("\n");
}

export const UPSTREAM = {
  discuss: ".claude/skills/grilling/SKILL.md",
  domain: ".claude/skills/domain-modeling/SKILL.md",
  spec: ".claude/skills/to-spec/SKILL.md",
  tickets: ".claude/skills/to-tickets/SKILL.md",
  buildSpec: ".claude/skills/implement-spec/SKILL.md",
  buildTicket: ".claude/skills/implement/SKILL.md",
  land: ".claude/skills/pr/SKILL.md",
  map: ".claude/skills/ask-matt/SKILL.md",
  setup: ".claude/skills/setup-matt-pocock-skills/SKILL.md",
};

export function configText(tracker: "local" | "github", overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tracker,
    profile: "mvp",
    research: "on-demand",
    build: "implement-spec",
    reviewFixRounds: 1,
    landing: "local-merge",
    push: "ask",
    buildStart: "ask",
    test: "npm test",
    uat: "off",
    upstream: UPSTREAM,
    ...overrides,
  });
}

const LOCKED_SKILLS = ["grilling", "domain-modeling", "to-spec", "to-tickets", "implement-spec", "implement", "tdd", "code-review", "pr", "setup-matt-pocock-skills", "orc", "orc-build"];

/** A `skills-lock.json` pinning upstream's skills, orc's own and any extra ones (name to source) to one commit. */
export function lockText(extraSkills: Record<string, string> = {}): string {
  const sources = { ...Object.fromEntries(LOCKED_SKILLS.map((skill) => [skill, skill.startsWith("orc") ? "Siddharth-Khattar/orchestra" : "mattpocock/skills"])), ...extraSkills };
  const skills = Object.entries(sources).map(([skill, source]) => [skill, { source, commit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d" }]);
  return JSON.stringify({ version: 2, skills: Object.fromEntries(skills) });
}

export const LOCK = lockText();

const USER_INVOKED = new Set(["to-spec", "to-tickets", "implement-spec", "implement", "setup-matt-pocock-skills"]);

export class Fixture {
  readonly root: string;

  constructor() {
    this.root = tempDir();
    this.git("init", "-q", "-b", "main");
  }

  git(...args: string[]): string {
    const result = realGit(["-C", this.root, ...args]);
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  }

  write(path: string, text: string): this {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return this;
  }

  /** Commits everything in the tree, with one Refs: trailer per ref. */
  commit(message: string, ...refs: string[]): string {
    this.git("add", "-A");
    this.git("commit", "-q", "--allow-empty", "-m", message, ...refs.flatMap((ref) => ["--trailer", `Refs: ${ref}`]));
    return this.git("rev-parse", "HEAD");
  }

  vendorSkills(): this {
    for (const skill of ["grilling", "domain-modeling", "to-spec", "to-tickets", "implement-spec", "implement", "tdd", "code-review", "pr", "setup-matt-pocock-skills"]) {
      const frontmatter = USER_INVOKED.has(skill) ? "disable-model-invocation: true\n" : "";
      this.write(`.claude/skills/${skill}/SKILL.md`, `---\nname: ${skill}\n${frontmatter}---\n\n# ${skill}\n`);
    }
    return this.write("skills-lock.json", LOCK);
  }

  /** Commits a copy of orc's script, hook and core where the install puts them, and returns the script's path: the script reads only its own checkout. */
  installOrc(): string {
    const dir = join(this.root, ".claude", "skills", "orc");
    mkdirSync(dir, { recursive: true });
    copyFileSync(SCRIPT_PATH, join(dir, "status.mts"));
    copyFileSync(join(dirname(SCRIPT_PATH), "hook.mts"), join(dir, "hook.mts"));
    copyFileSync(join(dirname(SCRIPT_PATH), "conventions.md"), join(dir, "conventions.md"));
    this.commit("chore: install orc");
    return join(dir, "status.mts");
  }

  setUp(tracker: "local" | "github", entries: readonly EntrySpec[], options: { requirements?: string[]; config?: Record<string, unknown> } = {}): this {
    this.vendorSkills();
    this.write("docs/orc/config.json", configText(tracker, options.config));
    this.write("docs/orc/registry.md", registryText(entries, options.requirements));
    this.commit("chore: set up orc");
    return this;
  }

  localTicket(entry: string, number: string, title: string, blockedBy = "None (can start immediately)"): this {
    return this.write(
      `.scratch/${entry}/issues/${number}-ticket.md`,
      `# ${number}: ${title}\n\n**What to build:** something.\n\n**Blocked by:** ${blockedBy}\n\n**Satisfies:** REQ-01\n\n**Status:** ready-for-agent\n`,
    );
  }

  text(args: string[], run: Runner = runner().run, cwd = this.root): string {
    const output = runStatus(args, environment(cwd, run));
    assert.equal(output.code, 0);
    return output.stdout;
  }

  verdict(args: string[], run: Runner = runner().run, cwd = this.root): Verdict {
    return parseVerdict(this.text([...args, "--json"], run, cwd));
  }

  status(run: Runner = runner().run): Status {
    const verdict = this.verdict(["orc"], run);
    const go = goOf(verdict, "orc");
    assert.ok(go.status, "orc --json carries the Status");
    return go.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The shape every verdict has: the schema, the string arrays and an outcome of a known kind. */
function isVerdict(value: unknown): value is Verdict {
  if (!isRecord(value) || value.schema !== 1 || !isRecord(value.outcome)) return false;
  const strings = (field: unknown): boolean => Array.isArray(field) && field.every((item) => typeof item === "string");
  return strings(value.banner) && strings(value.lines) && strings(value.ids) && ["stop", "pick", "go"].includes(String(value.outcome.kind));
}

export function parseVerdict(text: string): Verdict {
  const value: unknown = JSON.parse(text);
  if (!isVerdict(value)) assert.fail(`not a verdict: ${text.slice(0, 200)}`);
  return value;
}

export function parseLookup(text: string): LookupResult {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.keys)) assert.fail(`not a lookup result: ${text.slice(0, 200)}`);
  const keys = value.keys.filter(isRecord).map((k) => ({
    key: String(k.key),
    lines: Array.isArray(k.lines) ? k.lines.map(String) : null,
    supersededBy: typeof k.supersededBy === "string" ? k.supersededBy : null,
  }));
  return { schema: 1, keys };
}

function isGoFor<F extends Go["for"]>(go: Go, kind: F): go is Extract<Go, { for: F }> {
  return go.for === kind;
}

export function goOf<F extends Go["for"]>(verdict: Verdict, kind: F): Extract<Go, { for: F }> {
  const outcome = verdict.outcome;
  if (outcome.kind !== "go" || !isGoFor(outcome, kind)) assert.fail(`expected a ${kind} go, got ${JSON.stringify(outcome)}`);
  return outcome;
}

export function stopOf(verdict: Verdict): Stop {
  const outcome = verdict.outcome;
  if (outcome.kind !== "stop") assert.fail(`expected a stop, got ${JSON.stringify(outcome)}`);
  return outcome;
}

export function pickOf(verdict: Verdict): Pick {
  const outcome = verdict.outcome;
  if (outcome.kind !== "pick") assert.fail(`expected a pick, got ${JSON.stringify(outcome)}`);
  return outcome;
}

export function stateOf(status: Status, name: string): string {
  const entry = status.entries.find((e) => e.name === name);
  assert.ok(entry, `no entry ${name}`);
  return entry.state;
}

export const SPECCED_LOCAL = (name: string, landing = "local-merge"): EntrySpec => ({
  name,
  fields: ["Seams: CLI only", `Landing: ${landing}`, `Spec: .scratch/${name}/spec.md`, `Branch: spec/${name}`],
});

export const REQUIREMENTS = ["- REQ-01: Count things (spec: cli)", "- REQ-02: Show things (spec: cli)"];

/** A local-tracker repo with one specced entry `cli` and three chained tickets, committed on main. */
export function localWithTickets(landing = "local-merge"): Fixture {
  const fixture = new Fixture().setUp("local", [SPECCED_LOCAL("cli", landing), { name: "later" }], { requirements: REQUIREMENTS });
  fixture
    .write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01, REQ-02, D-01\n")
    .localTicket("cli", "01", "Skeleton")
    .localTicket("cli", "02", "Version", "01 (Skeleton, on Node 24)")
    .localTicket("cli", "03", "Usage errors", "01 (Skeleton), 02 (`--version` 2)");
  fixture.commit("docs: add cli tickets");
  return fixture;
}

/** Builds every ticket of `cli` on its spec branch and switches back to main. */
export function builtCli(fixture: Fixture): Fixture {
  fixture.git("switch", "-q", "-c", "spec/cli");
  fixture.write("src/a.js", "1").commit("feat: skeleton", "cli/01");
  fixture.write("src/b.js", "2").commit("feat: version", "cli/02");
  fixture.write("src/c.js", "3").commit("feat: usage", "cli/03");
  fixture.git("switch", "-q", "main");
  return fixture;
}

export function resolveLocal(fixture: Fixture): void {
  for (const n of ["01", "02", "03"]) {
    fixture.write(`.scratch/cli/issues/${n}-ticket.md`, `# ${n}: t\n\n**Status:** resolved\n`);
  }
  fixture.write(".scratch/cli/spec.md", "# cli\n\nRegistry: REQ-01\n\nStatus: resolved\n");
}

// ---------------------------------------------------------------------------
// The fake gh: answers the GraphQL queries the script builds
// ---------------------------------------------------------------------------

export interface FakeIssue {
  number: number;
  title: string;
  state: string;
  body?: string;
  login?: string;
  association?: string;
  labels?: string[];
  blockedBy?: number[];
  parent?: number;
}

interface FakeGitHub {
  specState?: string;
  specBody?: string;
  comments?: { id: number; body: string; association: string }[];
  subIssues?: FakeIssue[];
  /** Sub-issues of one spec issue by its number, in place of `subIssues`. */
  subIssuesOf?: Record<number, FakeIssue[]>;
  partOf?: FakeIssue[];
  /** The issueCount the Part of search reports, when it is more than it can list (GitHub stops at 1,000). */
  partOfCount?: number;
  found?: FakeIssue[];
  /** A PR's head commit is one this clone never fetched unless `headRefOid` names one. */
  prs?: { number: number; state: string; headRefName: string; baseRefName?: string; mergeCommit: { oid: string } | null; headRefOid?: string; isCrossRepository?: boolean; isDraft?: boolean }[];
  mergeCommitAllowed?: boolean;
  /** The repository's default branch as GitHub names it; "main" when not given. */
  defaultBranch?: string;
  /** The nodes per page of every connection; GitHub's is 100. */
  pageSize?: number;
}

/** One page of a list, as a GraphQL connection with the cursor of the next page. */
function page(items: readonly unknown[], cursor: string | undefined, size: number, count: "totalCount" | "issueCount" = "totalCount"): Record<string, unknown> {
  const offset = cursor === undefined ? 0 : Number(cursor);
  const nodes = items.slice(offset, offset + size);
  const end = offset + nodes.length;
  return { [count]: items.length, pageInfo: { hasNextPage: end < items.length, endCursor: String(end) }, nodes };
}

export function issueNode(issue: FakeIssue, size = 100): Record<string, unknown> {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? "Satisfies: REQ-01",
    authorAssociation: issue.association ?? "OWNER",
    author: { login: issue.login ?? "ann" },
    labels: page((issue.labels ?? []).map((name) => ({ name })), undefined, size),
    blockedBy: page((issue.blockedBy ?? []).map((number) => ({ number })), undefined, size),
    parent: issue.parent === undefined ? null : { number: issue.parent },
  };
}

/** A commit id no fixture holds: the head of a PR pushed from another clone and deleted before this one fetched it. */
export const UNFETCHED_HEAD = "0f".repeat(20);

export function fakeGh(github: FakeGitHub): GhHandler {
  const size = github.pageSize ?? 100;
  const subIssuesOf = (number: number): FakeIssue[] => github.subIssuesOf?.[number] ?? github.subIssues ?? [];
  const commentNodes = (): unknown[] => (github.comments ?? []).map((c) => ({ databaseId: c.id, body: c.body, authorAssociation: c.association }));
  const allIssues = (): FakeIssue[] => [...(github.subIssues ?? []), ...Object.values(github.subIssuesOf ?? {}).flat(), ...(github.partOf ?? []), ...(github.found ?? [])];
  const search = (items: FakeIssue[], cursor: string | undefined, count?: number): Record<string, unknown> => {
    const result = page(items.map((issue) => issueNode(issue, size)), cursor, size, "issueCount");
    return count === undefined ? result : { ...result, issueCount: count };
  };
  const issueField = (number: number, field: string, cursor: string): unknown => {
    if (field === "subIssues") return page(subIssuesOf(number).map((issue) => issueNode(issue, size)), cursor, size);
    if (field === "comments") return page(commentNodes(), cursor, size);
    const issue = allIssues().find((i) => i.number === number);
    const items = field === "labels" ? (issue?.labels ?? []).map((name) => ({ name })) : (issue?.blockedBy ?? []).map((n) => ({ number: n }));
    return page(items, cursor, size);
  };
  const prsOf = (head: string): unknown[] =>
    (github.prs ?? []).filter((pr) => pr.headRefName === head).map((pr) => ({ isCrossRepository: false, isDraft: false, baseRefName: "main", headRefOid: UNFETCHED_HEAD, ...pr }));
  const answer = (data: Record<string, unknown>): CommandResult => ({ status: 0, stdout: JSON.stringify({ data }), stderr: "" });

  return (args) => {
    if (args[0] === "auth" && args[1] === "status") return { status: 0, stdout: "", stderr: "" };
    if (args[0] !== "api" || args[1] !== "graphql") return undefined;
    const value = (name: string): string | undefined => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    const query = value("query") ?? "";
    const cursor = value("cursor");
    if (cursor !== undefined) {
      const issue = /issue\(number: (\d+)\) \{ (\w+)\(first: \d+, after: \$cursor/.exec(query);
      if (issue !== null) return answer({ repository: { issue: { [issue[2] ?? ""]: issueField(Number(issue[1]), issue[2] ?? "", cursor) } } });
      const pr = /pullRequests\(first: \d+, after: \$cursor, headRefName: "([^"]+)"/.exec(query);
      if (pr !== null) return answer({ repository: { pullRequests: page(prsOf(pr[1] ?? ""), cursor, size) } });
      const q = value("q") ?? "";
      if (/search\(query: \$q/.test(query)) return answer({ search: q.includes("in:body") ? search(github.partOf ?? [], cursor, github.partOfCount) : search(github.found ?? [], cursor) });
      return undefined;
    }
    const repository: Record<string, unknown> = {};
    const top: Record<string, unknown> = {};
    const spec = (number: number, detail: boolean): Record<string, unknown> => ({
      state: github.specState ?? "OPEN",
      body: github.specBody ?? "Registry: REQ-01",
      subIssues: page(subIssuesOf(number).map((issue) => issueNode(issue, size)), undefined, size),
      ...(detail ? { comments: page(commentNodes(), undefined, size) } : {}),
    });
    for (const match of query.matchAll(/\bi(\d+): issue\(/g)) repository[`i${match[1]}`] = spec(Number(match[1]), false);
    for (const match of query.matchAll(/\bt(\d+): issue\(/g)) repository[`t${match[1]}`] = spec(Number(match[1]), true);
    for (const match of query.matchAll(/\bp(\d+): pullRequests\([^)]*headRefName: "([^"]+)"/g)) repository[`p${match[1]}`] = page(prsOf(match[2] ?? ""), undefined, size);
    if (query.includes("mergeCommitAllowed")) repository.mergeCommitAllowed = github.mergeCommitAllowed ?? true;
    if (query.includes("defaultBranchRef")) repository.defaultBranchRef = { name: github.defaultBranch ?? "main" };
    for (const match of query.matchAll(/\bs(\d+): search\(/g)) top[`s${match[1]}`] = search(github.partOf ?? [], undefined, github.partOfCount);
    if (/\bf: search\(/.test(query)) top.f = search(github.found ?? [], undefined);
    return answer({ repository, ...top });
  };
}

/** A gh that lists the first page of every connection and never says where the next one starts. */
export function withoutPageInfo(handler: GhHandler): GhHandler {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "pageInfo").map(([key, v]) => [key, strip(v)]));
  };
  return (args) => {
    const answer = handler(args);
    if (answer === undefined || !answer.stdout.startsWith("{")) return answer;
    return { ...answer, stdout: JSON.stringify(strip(JSON.parse(answer.stdout))) };
  };
}

export function graphqlCalls(calls: readonly string[][]): string[] {
  return calls.filter((call) => call[1] === "graphql").map((call) => call.find((arg) => arg.startsWith("query=")) ?? "");
}

export const SPECCED_GITHUB: EntrySpec = { name: "auth", fields: ["Seams: CLI only", "Landing: pr-human", "Spec: #12", "Branch: spec/auth"] };

export function githubRepo(entries: EntrySpec[] = [SPECCED_GITHUB, { name: "next" }]): Fixture {
  const fixture = new Fixture().setUp("github", entries, { requirements: ["- REQ-01: Sign in (spec: auth)"] });
  fixture.git("remote", "add", "origin", "https://github.com/example/repo.git");
  return fixture;
}

export const TICKETS: FakeIssue[] = [
  { number: 13, title: "auth: login", state: "OPEN" },
  { number: 14, title: "auth: logout", state: "OPEN", blockedBy: [13] },
];

/** A directory that is not a git repository, judged like a fixture. */
export class FixtureLess {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  verdict(args: string[]): Verdict {
    return parseVerdict(runStatus([...args, "--json"], environment(this.root, runner().run)).stdout);
  }
}
