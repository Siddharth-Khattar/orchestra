// ABOUTME: orc's read-only status script: judges each orc command's preconditions from the registry, git and the tracker.
// ABOUTME: `status.mts <command> ['<target>']` prints a verdict, `registry '<key>'... [--project]` registry lines, `locked '<stamp>'` the locked-lines check.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ===========================================================================
// Vocabulary
// ===========================================================================

export const COMMANDS = ["orc", "orc-next", "orc-setup", "orc-discuss", "orc-spec", "orc-tickets", "orc-build", "orc-land"] as const;
export type Command = (typeof COMMANDS)[number];

export const ROLES = ["discuss", "domain", "spec", "tickets", "buildSpec", "buildTicket", "land", "map", "setup"] as const;
export type Role = (typeof ROLES)[number];

const TRACKERS = ["github", "local"] as const;
const PROFILES = ["hackathon", "mvp", "production"] as const;
const RESEARCH = ["off", "on-demand", "always"] as const;
const BUILD_MODES = ["implement-spec", "implement"] as const;
const LANDING_MODES = ["local-merge", "pr-agent", "pr-human"] as const;
const PUSH = ["ask", "always", "never"] as const;
const BUILD_START = ["ask", "always"] as const;
const UAT = ["off"] as const;

export type Tracker = (typeof TRACKERS)[number];
export type Profile = (typeof PROFILES)[number];
export type Research = (typeof RESEARCH)[number];
export type BuildMode = (typeof BUILD_MODES)[number];
export type LandingMode = (typeof LANDING_MODES)[number];
export type Push = (typeof PUSH)[number];
export type BuildStart = (typeof BUILD_START)[number];
export type Uat = (typeof UAT)[number];

/** The lowest Node this script supports: the first 24.x whose type stripping prints no warning on stderr. */
export const NODE_FLOOR: readonly [number, number, number] = [24, 3, 0];

const SCHEMA = 1;
const ORC_TICKET_LABEL = "orc-ticket";
const PENDING_MARKER = "<!-- orc:pending-decisions -->";
/** Authors GitHub says can write to the repo. Anyone can file an issue or comment, so text counts only from them. */
const WRITE_ACCESS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const RESOLVED_STATUSES = new Set(["resolved", "closed", "done"]);
/** The display mark the build sets on a local ticket's `Status:` line; never read as built (trailers decide). */
const BUILT_STATUS = "built";
const ORC_PATHS = [".claude/skills", "skills-lock.json", ".claude/rules", ".claude/settings.json", "docs/orc", "docs/agents"];
const CONFIG_PATH = "docs/orc/config.json";
const REGISTRY_PATH = "docs/orc/registry.md";
const LOCK_PATH = "skills-lock.json";
const TRIAGE_LABELS_PATH = "docs/agents/triage-labels.md";

/** A read that worked, or one that failed: `error` is the outside text behind it, data; `reason` says why in the script's own words, when it knows. */
export type Lookup<T> = { ok: true; value: T } | { ok: false; error: string; reason?: string };

function found<T>(value: T): Lookup<T> {
  return { ok: true, value };
}

function failed<T>(error: string, reason?: string): Lookup<T> {
  return reason === undefined ? { ok: false, error } : { ok: false, error, reason };
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Files may come with Windows line endings (`core.autocrlf`); every parser reads them as `\n`. */
function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ===========================================================================
// Safe values: the only things the text form may print (spec 9.4)
// ===========================================================================

const ENTRY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^(?:REQ|D)-\d{2,}$/;
const ID_IN_TEXT = /\b(?:REQ|D)-\d{2,}\b/g;
const ISSUE_REF = /^#\d+$/;
const LOCAL_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/\d+$/;
const SHORT_SHA = /^[0-9a-f]{7,40}$/;
const STAMP_TIME = /^[0-9a-f]{7,40} \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_NAME = /^(?!-)[\p{L}\p{M}\p{N}_./-]+$/u;
const WITHHELD = "withheld";

export function isSafeName(value: string): boolean {
  return SAFE_NAME.test(value);
}

function isTicketRef(value: string): boolean {
  return ISSUE_REF.test(value) || LOCAL_REF.test(value);
}

function safe(value: string, test: (value: string) => boolean): string {
  return test(value) ? value : WITHHELD;
}

const safeEntry = (name: string): string => safe(name, (v) => ENTRY_NAME.test(v));
const safeRef = (ref: string): string => safe(ref, isTicketRef);
const safeId = (id: string): string => safe(id, (v) => ID.test(v));
const safeSha = (sha: string): string => safe(sha, (v) => SHORT_SHA.test(v));
/** An upstream skill name: a folder name upstream controls, printed only in kebab-case like orc's own names. */
const safeSkill = (skill: string): string => safe(skill, (v) => ENTRY_NAME.test(v));
/** An upstream path: only the shape setup writes, `.claude/skills/<skill>/SKILL.md`. */
const safeSkillPath = (path: string): string => safe(path, (v) => /^\.claude\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(v));

/** A spec reference as orc builds it for an entry: `#<n>`, or exactly `.scratch/<name>/spec.md`; else withheld. */
function safeSpec(spec: string | null, name: string): string {
  if (spec === null) return "none";
  return ISSUE_REF.test(spec) || spec === `.scratch/${name}/spec.md` ? spec : WITHHELD;
}

function idsIn(text: string | null): string[] {
  return text === null ? [] : [...new Set(text.match(ID_IN_TEXT) ?? [])];
}

/** A relative path with no `..` segment, so reading it stays inside the repo. */
function isRepoPath(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.split(/[\\/]/).includes("..");
}

/**
 * Text from files and the tracker, printed raw, could redraw the terminal, so every control character becomes a
 * space. JSON escapes the C0 range by itself but leaves DEL and the C1 range raw, so JSON goes through this too.
 */
function printable(text: string): string {
  return text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ");
}

// ===========================================================================
// Registry (pure)
// ===========================================================================

export type ProblemKind =
  | "not-an-id-line"
  | "wrong-section"
  | "duplicate-id"
  | "bad-tail"
  | "bad-link"
  | "unknown-supersedes"
  | "unknown-delivers"
  | "unknown-field"
  | "repeated-field"
  | "bad-landing"
  | "not-an-entry-line"
  | "no-roadmap"
  | "not-kebab-case"
  | "duplicate-entry";

export interface Problem {
  line: number | null;
  kind: ProblemKind;
  /** The problem left a roadmap line out of the entries: every command but `/orc` and `/orc-setup` stops on it. */
  ignoresEntry: boolean;
}

export interface IdLine {
  id: string;
  kind: "requirement" | "decision";
  line: number;
  /** The line exactly as the file holds it, for the lookup. */
  text: string;
  supersedes: string | null;
  /** Requirements: the entries in its `(spec: ...)` list. */
  specs: string[];
  /** Decisions: `docs/adr/...`, `project`, `spec <name>` or `wayfinder <ref>`. */
  link: string | null;
}

export interface RoadmapEntry {
  number: number;
  name: string;
  line: number;
  /** The entry line and its field lines, exactly as the file holds them, for the lookup. */
  block: string[];
  spec: string | null;
  branch: string | null;
  seams: string | null;
  /** Whether a `Landing:` line exists: the entry has been discussed. */
  discussed: boolean;
  /** The `Landing:` value when it names a mode. */
  landing: LandingMode | null;
  delivers: string[];
  dropped: boolean;
}

export interface Registry {
  hasRoadmap: boolean;
  ids: IdLine[];
  entries: RoadmapEntry[];
  problems: Problem[];
}

const ID_LINE = /^- ((?:REQ|D)-\d{2,}): (.+)$/;
const REQUIREMENT_TAIL = /^(.+?)(?: \(supersedes (REQ-\d{2,})\))? \(spec: ([^)]*)\)$/;
const DECISION_TAIL = /^(.+?)(?: \(supersedes (D-\d{2,})\))? -> (.+)$/;
const DECISION_LINK = /^(?:docs\/adr\/\d{4}-[^ ]+\.md|project|spec [a-z0-9]+(?:-[a-z0-9]+)*|wayfinder \S+)$/;
const ENTRY_LINE = /^(\d+)\. (.+)$/;
const FIELD_LINE = /^\s+- ([A-Za-z]+): (.+)$/;
const SINGLE_FIELDS = ["Spec", "Branch", "Seams", "Landing", "Dropped"] as const;

type Section = "requirements" | "decisions" | "roadmap" | "other";

function sectionOf(heading: string): Section {
  const name = heading.trim().toLowerCase();
  return name === "requirements" || name === "decisions" || name === "roadmap" ? name : "other";
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""));
}

function parseIdLine(id: string, rest: string, line: number, text: string): IdLine | ProblemKind {
  if (id.startsWith("REQ-")) {
    const tail = REQUIREMENT_TAIL.exec(rest);
    if (tail === null) return "bad-tail";
    return { id, kind: "requirement", line, text, supersedes: tail[2] ?? null, specs: splitList(tail[3] ?? ""), link: null };
  }
  const tail = DECISION_TAIL.exec(rest);
  if (tail === null) return "bad-tail";
  const link = tail[3] ?? "";
  if (!DECISION_LINK.test(link)) return "bad-link";
  return { id, kind: "decision", line, text, supersedes: tail[2] ?? null, specs: [], link };
}

function applyField(entry: RoadmapEntry, field: string, value: string, line: number, seen: Set<string>, problems: Problem[]): void {
  const problem = (kind: ProblemKind): void => {
    problems.push({ line, kind, ignoresEntry: false });
  };
  if (field === "Delivers") {
    entry.delivers.push(...splitList(value));
    return;
  }
  if (!(SINGLE_FIELDS as readonly string[]).includes(field)) return problem("unknown-field");
  if (seen.has(field)) return problem("repeated-field");
  seen.add(field);
  switch (field) {
    case "Spec":
      entry.spec = value;
      return;
    case "Branch":
      entry.branch = value;
      return;
    case "Seams":
      entry.seams = value;
      return;
    case "Dropped":
      entry.dropped = true;
      return;
    case "Landing":
      entry.discussed = true;
      if (isOneOf(LANDING_MODES, value)) entry.landing = value;
      else problem("bad-landing");
      return;
  }
}

function checkReferences(registry: Registry): void {
  const known = new Set(registry.ids.map((line) => line.id));
  for (const line of registry.ids) {
    if (line.supersedes !== null && !known.has(line.supersedes)) {
      registry.problems.push({ line: line.line, kind: "unknown-supersedes", ignoresEntry: false });
    }
  }
  const requirements = new Set(registry.ids.filter((line) => line.kind === "requirement").map((line) => line.id));
  for (const entry of registry.entries) {
    if (entry.delivers.some((id) => !requirements.has(id))) {
      registry.problems.push({ line: entry.line, kind: "unknown-delivers", ignoresEntry: false });
    }
  }
}

export function parseRegistry(rawText: string): Registry {
  const registry: Registry = { hasRoadmap: false, ids: [], entries: [], problems: [] };
  const rawLines = normaliseLineEndings(rawText).split("\n");
  const lines = blankComments(rawLines.join("\n")).split("\n");
  const seenIds = new Set<string>();
  const problem = (line: number | null, kind: ProblemKind, ignoresEntry = false): void => {
    registry.problems.push({ line, kind, ignoresEntry });
  };
  let section: Section = "other";
  let current: { entry: RoadmapEntry; seen: Set<string> } | null = null;
  // The field lines of an ignored entry are skipped with it: its name would otherwise become a path, a branch and a target.
  let ignoringEntry = false;

  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const raw = rawLines[index] ?? line;
    if (line.trim() === "") continue;
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading !== null) {
      section = heading[0].startsWith("## ") ? sectionOf(heading[1] ?? "") : "other";
      if (section === "roadmap") registry.hasRoadmap = true;
      current = null;
      ignoringEntry = false;
      continue;
    }
    if (section === "requirements" || section === "decisions") {
      if (!line.startsWith("- ")) continue;
      const match = ID_LINE.exec(line);
      const id = match?.[1];
      if (id === undefined || match?.[2] === undefined) {
        problem(number, "not-an-id-line");
        continue;
      }
      if (!id.startsWith(section === "requirements" ? "REQ-" : "D-")) {
        problem(number, "wrong-section");
        continue;
      }
      if (seenIds.has(id)) problem(number, "duplicate-id");
      seenIds.add(id);
      const parsed = parseIdLine(id, match[2], number, raw);
      if (typeof parsed === "string") problem(number, parsed);
      else registry.ids.push(parsed);
      continue;
    }
    if (section !== "roadmap") continue;
    const entryMatch = ENTRY_LINE.exec(line);
    if (entryMatch !== null) {
      const name = (entryMatch[2] ?? "").trim();
      const kind: ProblemKind | null = !ENTRY_NAME.test(name)
        ? "not-kebab-case"
        : registry.entries.some((entry) => entry.name === name)
          ? "duplicate-entry"
          : null;
      ignoringEntry = kind !== null;
      if (kind !== null) {
        current = null;
        problem(number, kind, true);
        continue;
      }
      const entry: RoadmapEntry = {
        number: Number(entryMatch[1]),
        name,
        line: number,
        block: [raw],
        spec: null,
        branch: null,
        seams: null,
        discussed: false,
        landing: null,
        delivers: [],
        dropped: false,
      };
      registry.entries.push(entry);
      current = { entry, seen: new Set() };
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field !== null && current !== null) {
      current.entry.block.push(raw);
      applyField(current.entry, field[1] ?? "", (field[2] ?? "").trim(), number, current.seen, registry.problems);
      continue;
    }
    if (field !== null && ignoringEntry) continue;
    problem(number, "not-an-entry-line");
  }
  if (!registry.hasRoadmap) problem(null, "no-roadmap");
  checkReferences(registry);
  return registry;
}

/** Each superseded id mapped to the id that supersedes it. */
export function supersededBy(registry: Registry): Map<string, string> {
  return new Map(registry.ids.flatMap((line) => (line.supersedes === null ? [] : [[line.supersedes, line.id] as const])));
}

function liveIds(registry: Registry): IdLine[] {
  const superseded = supersededBy(registry);
  return registry.ids.filter((line) => !superseded.has(line.id));
}

/** The live requirements an entry delivers: its name in a `(spec: ...)` list, or the id on its `Delivers:` lines. */
export function requirementsOf(registry: Registry, entry: RoadmapEntry): string[] {
  return liveIds(registry)
    .filter((line) => line.kind === "requirement" && (line.specs.includes(entry.name) || entry.delivers.includes(line.id)))
    .map((line) => line.id);
}

/**
 * The ids `/orc-spec` lists for an entry: its live requirements and the live decisions linked to it. The project's
 * decisions apply too, but they grow with the project, so a verdict counts them and the lookup prints them.
 */
export function specIds(registry: Registry, entry: RoadmapEntry): string[] {
  const decisions = liveIds(registry)
    .filter((line) => line.kind === "decision" && line.link === `spec ${entry.name}`)
    .map((line) => line.id);
  return [...requirementsOf(registry, entry), ...decisions];
}

/** Every live `-> project` decision. */
export function projectDecisions(registry: Registry): string[] {
  return liveIds(registry)
    .filter((line) => line.kind === "decision" && line.link === "project")
    .map((line) => line.id);
}

// ===========================================================================
// Config and lock file (pure)
// ===========================================================================

export interface Config {
  tracker: Tracker;
  profile: Profile;
  research: Research;
  build: BuildMode;
  reviewFixRounds: number;
  landing: LandingMode;
  push: Push;
  buildStart: BuildStart;
  test: string | null;
  uat: Uat;
  upstream: Record<Role, string | null>;
}

export interface ConfigCheck {
  /** The keys that hold a valid value. */
  values: Partial<Config>;
  missingKeys: string[];
  badKeys: string[];
}

/** A test command that is one simple command: no `&&`, `||`, `;`, pipes, backticks or `$(...)`. */
function isSimpleCommand(value: string): boolean {
  return value.trim() !== "" && !/&&|\|\||[;|`\n\r]|\$\(/.test(value);
}

/** A record with one value per role, built field by field so the type needs no cast. */
function byRole<T>(value: (role: Role) => T): Record<Role, T> {
  return {
    discuss: value("discuss"), domain: value("domain"), spec: value("spec"), tickets: value("tickets"), buildSpec: value("buildSpec"),
    buildTicket: value("buildTicket"), land: value("land"), map: value("map"), setup: value("setup"),
  };
}

function checkUpstream(value: unknown, check: ConfigCheck): void {
  if (!isRecord(value)) {
    check.badKeys.push("upstream");
    return;
  }
  const problems = check.missingKeys.length + check.badKeys.length;
  for (const role of ROLES) {
    const path = value[role];
    if (path === undefined) check.missingKeys.push(`upstream.${role}`);
    else if (!(path === null || (typeof path === "string" && isRepoPath(path)))) check.badKeys.push(`upstream.${role}`);
  }
  if (check.missingKeys.length + check.badKeys.length > problems) return;
  check.values.upstream = byRole((role) => {
    const path = value[role];
    return typeof path === "string" ? path : null;
  });
}

/** Judges every key of spec 9.1. Fails only when the file is not a JSON object. */
export function parseConfig(text: string): Lookup<ConfigCheck> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return failed(`${CONFIG_PATH} is not valid JSON`);
  }
  if (!isRecord(data)) return failed(`${CONFIG_PATH} is not a JSON object`);
  const check: ConfigCheck = { values: {}, missingKeys: [], badKeys: [] };
  const values = check.values;
  const enumKey = <T extends string>(key: keyof Config, allowed: readonly T[], set: (value: T) => void): void => {
    const value = data[key];
    if (value === undefined) check.missingKeys.push(key);
    else if (isOneOf(allowed, value)) set(value);
    else check.badKeys.push(key);
  };
  enumKey("tracker", TRACKERS, (v) => (values.tracker = v));
  enumKey("profile", PROFILES, (v) => (values.profile = v));
  enumKey("research", RESEARCH, (v) => (values.research = v));
  enumKey("build", BUILD_MODES, (v) => (values.build = v));
  enumKey("landing", LANDING_MODES, (v) => (values.landing = v));
  enumKey("push", PUSH, (v) => (values.push = v));
  enumKey("buildStart", BUILD_START, (v) => (values.buildStart = v));
  enumKey("uat", UAT, (v) => (values.uat = v));
  const rounds = data.reviewFixRounds;
  if (rounds === undefined) check.missingKeys.push("reviewFixRounds");
  else if (typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 0) values.reviewFixRounds = rounds;
  else check.badKeys.push("reviewFixRounds");
  const test = data.test;
  if (test === undefined) check.missingKeys.push("test");
  else if (test === null || (typeof test === "string" && isSimpleCommand(test))) values.test = test;
  else check.badKeys.push("test");
  if (data.upstream === undefined) check.missingKeys.push("upstream");
  else checkUpstream(data.upstream, check);
  return found(check);
}

function completeConfig(check: ConfigCheck): Config | null {
  if (check.missingKeys.length > 0 || check.badKeys.length > 0) return null;
  const v = check.values;
  if (
    v.tracker === undefined || v.profile === undefined || v.research === undefined || v.build === undefined ||
    v.reviewFixRounds === undefined || v.landing === undefined || v.push === undefined || v.buildStart === undefined ||
    v.test === undefined || v.uat === undefined || v.upstream === undefined
  ) {
    return null;
  }
  return { tracker: v.tracker, profile: v.profile, research: v.research, build: v.build, reviewFixRounds: v.reviewFixRounds,
    landing: v.landing, push: v.push, buildStart: v.buildStart, test: v.test, uat: v.uat, upstream: v.upstream };
}

/** The repo `/orc-setup` vendors upstream's skills from, as `skills-lock.json` names it. */
const UPSTREAM_SOURCE = "mattpocock/skills";

export interface LockEntry {
  commit: string;
  source: string | null;
}

/** `skills-lock.json`: each locked skill to its commit and source. An unreadable file pins nothing. */
export function parseLock(text: string | null): Map<string, LockEntry> {
  if (text === null) return new Map();
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || !isRecord(data.skills)) return new Map();
    return new Map(
      Object.entries(data.skills).flatMap(([skill, entry]) =>
        isRecord(entry) && typeof entry.commit === "string" && SHORT_SHA.test(entry.commit)
          ? [[skill, { commit: entry.commit, source: typeof entry.source === "string" ? entry.source : null }] as const]
          : [],
      ),
    );
  } catch {
    return new Map();
  }
}

/** Whether a SKILL.md's frontmatter holds `disable-model-invocation: true`, so the Skill tool refuses it. */
export function isUserInvoked(skillText: string): boolean {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(normaliseLineEndings(skillText))?.[1] ?? "";
  return /^disable-model-invocation:\s*true\s*$/m.test(frontmatter);
}

// ===========================================================================
// Tracker and git output parsers (pure)
// ===========================================================================

export interface TicketFact {
  ref: string;
  title: string | null;
  resolved: boolean;
  /** null: not read (GitHub reads them for the target only). */
  blockers: Lookup<string[]> | null;
  satisfies: string[] | null;
  /** The local ticket file. */
  path: string | null;
  author: string | null;
}

export interface IgnoredIssue {
  ref: string;
  author: string;
}

export type PendingFact = { count: number; ref: string; path: string } | { count: number; commentId: number };

export interface TrackerFacts {
  /** The spec issue's state, or the local spec file's `Status:` line; null when neither says. */
  specOpen: boolean | null;
  tickets: TicketFact[];
  ignored: IgnoredIssue[];
  /** The ids the spec's `Registry:` line cites; null when the spec was not read. */
  cited: string[] | null;
  /** null: not read. */
  pending: Lookup<PendingFact | null> | null;
}

const LOCAL_TICKET_FILE = /^(\d+)-.+\.md$/;

/** The value after `<label>:` on its own line, plain or bold; null when the label is missing or its line is empty. */
function labelledValue(text: string, label: string): string | null {
  const pattern = new RegExp(`^\\*{0,2}${label}:\\*{0,2}[ \\t]*(\\S.*?)[ \\t]*$`, "im");
  return pattern.exec(text)?.[1] ?? null;
}

/** Blocker references from a `Blocked by:` value: `None`, `02 (title)`, `01, 02` or `<name>/01`. */
export function parseBlockedBy(value: string | null, entryName: string): string[] {
  if (value === null) return [];
  const withoutTitles = value.replace(/\([^)]*\)/g, " ").replace(/`[^`]*`/g, " ");
  const refs = [...withoutTitles.matchAll(/(?:\b([a-z0-9-]+)\/)?\b(\d+)\b/g)].map(
    ([, name, digits = ""]) => `${name ?? entryName}/${digits.padStart(2, "0")}`,
  );
  return [...new Set(refs)];
}

export function parseLocalTicket(entryName: string, dir: string, fileName: string, rawText: string): TicketFact | null {
  const number = LOCAL_TICKET_FILE.exec(fileName)?.[1];
  if (number === undefined) return null;
  const text = normaliseLineEndings(rawText);
  const heading = /^#\s+(.+)$/m.exec(text)?.[1] ?? fileName.replace(/\.md$/, "");
  const status = labelledValue(text, "Status");
  return {
    ref: `${entryName}/${number}`,
    title: heading.replace(/^\d+:\s*/, "").trim(),
    resolved: status !== null && RESOLVED_STATUSES.has(status.toLowerCase()),
    blockers: found(parseBlockedBy(labelledValue(text, "Blocked by"), entryName)),
    satisfies: idsIn(labelledValue(text, "Satisfies")),
    path: `${dir}/${fileName}`,
    author: null,
  };
}

/** Whether a local spec file is still open by its `Status:` line; null when there is no file or no such line. */
export function localSpecOpen(text: string | null): boolean | null {
  const status = text === null ? null : labelledValue(normaliseLineEndings(text), "Status");
  return status === null ? null : !RESOLVED_STATUSES.has(status.toLowerCase());
}

/** The local tracker's Status: lines as the spec branch holds them: what a run on that branch still has to commit. */
export interface BranchStatus {
  /** The spec path and the ticket references not resolved there. */
  open: string[];
  /** The ticket references whose Status: is neither built nor resolved there. */
  unmarked: string[];
}

/** Judges the spec and ticket files read from the spec branch. */
export function branchStatus(spec: { path: string; text: string | null }, tickets: readonly { ref: string; text: string }[]): BranchStatus {
  const status = (text: string): string => (labelledValue(normaliseLineEndings(text), "Status") ?? "").toLowerCase();
  const open = tickets.filter((t) => !RESOLVED_STATUSES.has(status(t.text))).map((t) => t.ref);
  return {
    open: [...(localSpecOpen(spec.text) === true ? [spec.path] : []), ...open],
    unmarked: tickets.filter((t) => status(t.text) !== BUILT_STATUS && !RESOLVED_STATUSES.has(status(t.text))).map((t) => t.ref),
  };
}

/** The ids a spec's `Registry:` line cites. */
export function citedIds(specText: string | null): string[] {
  return idsIn(specText === null ? null : labelledValue(normaliseLineEndings(specText), "Registry"));
}

/** The number of pending lines: those starting with `- ` after the marker, or anywhere when the marker is missing. */
export function countPending(text: string): number {
  const lines = normaliseLineEndings(text).split("\n");
  const marker = lines.findIndex((line) => line.trim() === PENDING_MARKER);
  return lines.slice(marker + 1).filter((line) => line.startsWith("- ")).length;
}

export interface Commit {
  sha: string;
  isMerge: boolean;
  refs: string[];
  files: string[];
}

/** The `git log` format `parseLog` reads, with `--name-only`: short sha, parents, then each Refs: trailer value. */
export const LOG_FORMAT = "--format=%x1e%h%x1f%P%x1f%(trailers:key=Refs,valueonly,separator=%x1f)";

export function parseLog(output: string): Commit[] {
  return output
    .split("\x1e")
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [header = "", ...files] = record.split("\n");
      const [sha = "", parents = "", ...refs] = header.split("\x1f");
      return {
        sha,
        isMerge: parents.trim().split(/\s+/).length > 1,
        refs: refs.map((ref) => ref.trim()).filter((ref) => ref !== ""),
        files: files.filter((file) => file !== ""),
      };
    });
}

/** The `git log` format `parseRefs` reads: only the Refs: trailer values, so a long history stays small. */
export const REFS_FORMAT = "--format=%(trailers:key=Refs,valueonly,separator=%x1f)%x1e";

export function parseRefs(output: string): Set<string> {
  return new Set(
    output
      .split(/[\x1e\x1f]/)
      .map((ref) => ref.trim())
      .filter((ref) => ref !== ""),
  );
}

export interface Worktree {
  path: string;
  branch: string | null;
  /** Locked, as Claude Code locks an implementer's worktree while it runs, and leaves it when one dies. */
  locked: boolean;
}

/** `git worktree list --porcelain` output; the first block is the main checkout. */
export function parseWorktrees(output: string): Worktree[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("worktree "))
    .map((block) => {
      const lines = block.split("\n");
      const branchLine = lines.find((line) => line.startsWith("branch "));
      return {
        path: (lines[0] ?? "").slice("worktree ".length),
        branch: branchLine === undefined ? null : branchLine.slice("branch refs/heads/".length),
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      };
    });
}

/** `git status --porcelain -z` output: the paths it names, a rename's both sides included. */
export function parseStatusPaths(output: string): string[] {
  const fields = output.split("\0").filter((field) => field !== "");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    paths.push(field.slice(3));
    if (field[0] === "R" || field[0] === "C") {
      const source = fields[++i];
      if (source !== undefined) paths.push(source);
    }
  }
  return paths;
}

function isUnder(path: string, prefix: string): boolean {
  const bare = path.replace(/\/$/, "");
  return bare === prefix || bare.startsWith(`${prefix}/`);
}

/** The files a discuss lock commits beside the registry: glossaries and ADRs (upstream domain-modeling). */
function isDomainPath(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return base === "GLOSSARY.md" || base === "GLOSSARY-MAP.md" || /(^|\/)docs\/adr\//.test(path) || /(^|\/)docs\/adr\/?$/.test(path);
}

// ===========================================================================
// GitHub through one GraphQL query per phase (pure query building and parsing)
// ===========================================================================

export type PullRequestState = "OPEN" | "MERGED";

export interface PullRequest {
  number: number;
  state: PullRequestState;
  draft: boolean;
  mergeCommit: string | null;
  /** The commit the PR's branch pointed at, which for a merged PR is the commit it landed. */
  headCommit: string | null;
}

export interface PullRequestFact extends PullRequest {
  /** Parent count of the merge commit, or null when that commit is not in the local repo yet. */
  mergeParents: number | null;
}

export interface GraphqlQuery {
  query: string;
  /** Search strings, passed with `-F` so gh fills in `{owner}` and `{repo}`. */
  variables: Record<string, string>;
  /** Values passed verbatim with `-f`: page cursors, which need no placeholder and no type conversion. */
  verbatim?: Record<string, string>;
}

/** gh fills `{owner}` and `{repo}` into `-F` values only, never into the query text. */
const REPOSITORY_VARIABLES: Record<string, string> = { owner: "{owner}", name: "{repo}" };
/** Every connection reports its size and where its next page starts, so a list is read to its end or fails. */
const PAGE_FIELDS = "totalCount pageInfo { hasNextPage endCursor }";
const PAGE_SIZE = 100;
/** The pages read after the first, per connection; a list longer than that fails rather than shows fewer. */
export const MAX_PAGES = 20;

/** The node fields of each connection orc reads, shared by the first query and every later page. */
const NODES = {
  subIssues: "number state",
  subIssuesDetail: `number title state body author { login } blockedBy(first: ${PAGE_SIZE}) { ${PAGE_FIELDS} nodes { number } }`,
  comments: "databaseId body authorAssociation",
  blockedBy: "number",
  labels: "name",
  pullRequests: "number state isDraft isCrossRepository headRefName baseRefName headRefOid mergeCommit { oid }",
  partOf: `number state authorAssociation author { login } labels(first: ${PAGE_SIZE}) { ${PAGE_FIELDS} nodes { name } }`,
  partOfDetail: `number title state body authorAssociation author { login } labels(first: ${PAGE_SIZE}) { ${PAGE_FIELDS} nodes { name } } blockedBy(first: ${PAGE_SIZE}) { ${PAGE_FIELDS} nodes { number } }`,
  found: "number title state author { login } parent { number }",
} as const;

function connection(field: string, args: string, nodes: string): string {
  return `${field}(first: ${PAGE_SIZE}${args}) { ${PAGE_FIELDS} nodes { ${nodes} } }`;
}

function searchConnection(variable: string, nodes: string, after = ""): string {
  return `search(query: $${variable}, type: ISSUE, first: ${PAGE_SIZE}${after}) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on Issue { ${nodes} } } }`;
}

export interface LightRequest {
  /** Spec issue numbers whose state and sub-issues every entry state needs. */
  specs: number[];
  /** Spec branch names whose PRs are looked up, filtered by head branch. */
  prHeads: string[];
  /** Whether to read what judging PRs needs of the repo: whether it allows merge commits, and its default branch. */
  pullRequestFacts: boolean;
}

/** A closed PR lands nothing, so only open and merged ones are read. */
const PR_STATES = ", states: [OPEN, MERGED]";

export function lightQuery(request: LightRequest): GraphqlQuery {
  const parts = [
    ...(request.pullRequestFacts ? ["mergeCommitAllowed", "defaultBranchRef { name }"] : []),
    ...request.specs.map((n) => `i${n}: issue(number: ${n}) { state ${connection("subIssues", "", NODES.subIssues)} }`),
    ...request.prHeads.map((head, index) => `p${index}: ${connection("pullRequests", `, headRefName: ${JSON.stringify(head)}${PR_STATES}`, NODES.pullRequests)}`),
  ];
  return { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${parts.join(" ")} } }`, variables: { ...REPOSITORY_VARIABLES } };
}

/** The search for upstream's fallback without sub-issues: issues whose body says `Part of #<spec>`. */
export function partOfSearch(spec: number): string {
  return `repo:{owner}/{repo} is:issue in:body "Part of #${spec}"`;
}

/** The search for spec issues an earlier `/orc-spec` run may have filed: titled `<name>: `. */
export function titleSearch(name: string): string {
  return `repo:{owner}/{repo} is:issue in:title "${name}:"`;
}

export interface DetailRequest {
  /** Specs with no sub-issues, searched for the `Part of` fallback. */
  partOf: number[];
  /** The target's spec issue, read with its body, comments and its tickets' bodies and blockers. */
  target: { spec: number; viaSearch: boolean } | null;
  /** An entry name whose spec issues an earlier `/orc-spec` run may have filed (`<name>: ` titles). */
  titleSearch: string | null;
}

export function detailQuery(request: DetailRequest): GraphqlQuery {
  const variables: Record<string, string> = request.target === null ? {} : { ...REPOSITORY_VARIABLES };
  const parts: string[] = [];
  const top: string[] = [];
  for (const spec of request.partOf) {
    variables[`q${spec}`] = partOfSearch(spec);
    const heavy = request.target?.viaSearch === true && request.target.spec === spec;
    top.push(`s${spec}: ${searchConnection(`q${spec}`, heavy ? NODES.partOfDetail : NODES.partOf)}`);
  }
  if (request.target !== null) {
    const subIssues = request.target.viaSearch ? "" : ` ${connection("subIssues", "", NODES.subIssuesDetail)}`;
    parts.push(`t${request.target.spec}: issue(number: ${request.target.spec}) { state body ${connection("comments", "", NODES.comments)}${subIssues} }`);
  }
  if (request.titleSearch !== null) {
    variables.qf = titleSearch(request.titleSearch);
    top.push(`f: ${searchConnection("qf", NODES.found)}`);
  }
  const declared = Object.keys(variables).map((name) => `$${name}: String!`);
  const signature = declared.length === 0 ? "" : `(${declared.join(", ")})`;
  const repository = parts.length === 0 ? "" : `repository(owner: $owner, name: $name) { ${parts.join(" ")} } `;
  return { query: `query${signature} { ${repository}${top.join(" ")} }`, variables };
}

/** Where the rest of a connection is read from: the query for the page after a cursor, and the connection in its answer. */
export interface Pager {
  what: string;
  query(cursor: string): GraphqlQuery;
  pick(answer: GraphqlAnswer): unknown;
}

const AFTER = ", after: $cursor";
const PAGE_SIGNATURE = "query($owner: String!, $name: String!, $cursor: String!)";

/** The next page of an issue's connection: its sub-issues, comments, blockers or labels. */
export function issuePager(issue: number, field: "subIssues" | "comments" | "blockedBy" | "labels", nodes: string, what: string): Pager {
  return {
    what,
    query: (cursor) => ({
      query: `${PAGE_SIGNATURE} { repository(owner: $owner, name: $name) { issue(number: ${issue}) { ${connection(field, AFTER, nodes)} } } }`,
      variables: { ...REPOSITORY_VARIABLES },
      verbatim: { cursor },
    }),
    pick: (answer) => {
      const node = answer.repository.issue;
      return isRecord(node) ? node[field] : undefined;
    },
  };
}

export function pullRequestPager(head: string): Pager {
  return {
    what: "pull requests",
    query: (cursor) => ({
      query: `${PAGE_SIGNATURE} { repository(owner: $owner, name: $name) { ${connection("pullRequests", `${AFTER}, headRefName: ${JSON.stringify(head)}${PR_STATES}`, NODES.pullRequests)} } }`,
      variables: { ...REPOSITORY_VARIABLES },
      verbatim: { cursor },
    }),
    pick: (answer) => answer.repository.pullRequests,
  };
}

export function searchPager(search: string, nodes: string, what: string): Pager {
  return {
    what,
    query: (cursor) => ({ query: `query($q: String!, $cursor: String!) { ${searchConnection("q", nodes, AFTER)} }`, variables: { q: search }, verbatim: { cursor } }),
    pick: (answer) => answer.top.search,
  };
}

/** A GraphQL answer: the data gh printed, with the error of each alias that came back null. */
export interface GraphqlAnswer {
  repository: Record<string, unknown>;
  top: Record<string, unknown>;
  aliasError(alias: string): string;
}

/** gh exits non-zero when any part of a query fails, while still printing the data of the parts that worked. */
export function parseGraphql(stdout: string, stderr: string, status: number): Lookup<GraphqlAnswer> {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return failed(`gh api graphql failed: ${firstLine(stderr) || `exit ${status}`}`);
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    return failed(`gh api graphql failed: ${firstLine(stderr) || "no data in its answer"}`);
  }
  const errors = Array.isArray(data.errors) ? data.errors.filter(isRecord) : [];
  const top = data.data;
  const repository = isRecord(top.repository) ? top.repository : {};
  return found({
    repository,
    top,
    aliasError: (alias) => {
      const error = errors.find((e) => Array.isArray(e.path) && e.path.includes(alias));
      return typeof error?.message === "string" ? `gh api graphql: ${error.message}` : `gh api graphql returned nothing for ${alias}`;
    },
  });
}

function nodesOf(connection: unknown, what: string): Lookup<Record<string, unknown>[]> {
  if (!isRecord(connection) || !Array.isArray(connection.nodes) || typeof connection.totalCount !== "number") {
    return failed(`gh api graphql printed an unexpected shape for ${what}`);
  }
  const nodes = connection.nodes.filter(isRecord);
  if (connection.totalCount > nodes.length) {
    return failed(`gh api graphql listed ${nodes.length} of ${connection.totalCount} ${what}, so some would be missing`);
  }
  return found(nodes);
}

function searchNodes(search: unknown, what: string): Lookup<Record<string, unknown>[]> {
  if (!isRecord(search) || !Array.isArray(search.nodes) || typeof search.issueCount !== "number") {
    return failed(`gh api graphql printed an unexpected shape for ${what}`);
  }
  const nodes = search.nodes.filter(isRecord);
  if (search.issueCount > nodes.length) {
    return failed(`gh api graphql listed ${nodes.length} of ${search.issueCount} ${what}, so some would be missing`);
  }
  return found(nodes);
}

function loginOf(node: Record<string, unknown>): string {
  return isRecord(node.author) && typeof node.author.login === "string" ? node.author.login : "unknown author";
}

function labelsOf(node: Record<string, unknown>): Lookup<string[]> {
  if (node.labels === undefined) return found([]);
  const labels = nodesOf(node.labels, "labels");
  if (!labels.ok) return labels;
  return found(labels.value.flatMap((label) => (typeof label.name === "string" ? [label.name] : [])));
}

function blockersOf(node: Record<string, unknown>): Lookup<string[]> | null {
  if (node.blockedBy === undefined) return null;
  const nodes = nodesOf(node.blockedBy, "blockers");
  if (!nodes.ok) return nodes;
  return found(nodes.value.flatMap((n) => (typeof n.number === "number" ? [`#${n.number}`] : [])));
}

function issueTicket(node: Record<string, unknown>): TicketFact | null {
  if (typeof node.number !== "number" || typeof node.state !== "string") return null;
  return {
    ref: `#${node.number}`,
    title: typeof node.title === "string" ? node.title : null,
    resolved: node.state.toUpperCase() === "CLOSED",
    blockers: blockersOf(node),
    satisfies: typeof node.body === "string" ? idsIn(labelledValue(normaliseLineEndings(node.body), "Satisfies")) : null,
    path: null,
    author: node.author === undefined ? null : loginOf(node),
  };
}

function issueTickets(nodes: Record<string, unknown>[]): Lookup<TicketFact[]> {
  const tickets = nodes.map(issueTicket);
  if (tickets.some((ticket) => ticket === null)) return failed("gh api graphql printed an issue without a number or state");
  return found(tickets.filter((ticket) => ticket !== null));
}

/** A spec issue's state and sub-issues. */
export function parseSpecIssue(issue: unknown): Lookup<{ specOpen: boolean; tickets: TicketFact[] }> {
  if (!isRecord(issue) || typeof issue.state !== "string") return failed("gh api graphql printed an unexpected shape for the spec issue");
  const nodes = nodesOf(issue.subIssues, "sub-issues");
  if (!nodes.ok) return nodes;
  const tickets = issueTickets(nodes.value);
  if (!tickets.ok) return tickets;
  return found({ specOpen: issue.state === "OPEN", tickets: tickets.value });
}

/** The `Part of` search: issues filed with write access or labelled `orc-ticket` are tickets, the rest ignored issues. */
export function parsePartOf(search: unknown): Lookup<{ tickets: TicketFact[]; ignored: IgnoredIssue[] }> {
  const nodes = searchNodes(search, "issues saying Part of the spec");
  if (!nodes.ok) return nodes;
  const tickets: TicketFact[] = [];
  const ignored: IgnoredIssue[] = [];
  for (const node of nodes.value) {
    const ticket = issueTicket(node);
    if (ticket === null) return failed("gh api graphql printed an issue without a number or state");
    const labels = labelsOf(node);
    if (!labels.ok) return labels;
    const counts = (typeof node.authorAssociation === "string" && WRITE_ACCESS.has(node.authorAssociation)) || labels.value.includes(ORC_TICKET_LABEL);
    if (counts) tickets.push(ticket);
    else ignored.push({ ref: ticket.ref, author: loginOf(node) });
  }
  return found({ tickets, ignored });
}

/**
 * The pending record on GitHub: the oldest comment by a write-access author whose body starts with the marker.
 * Comments are listed oldest first, so one found among those listed is the record even when the list is cut short;
 * finding none in a list cut short is a failed lookup, never "no record".
 */
export function parsePendingComment(issue: unknown): Lookup<PendingFact | null> {
  if (!isRecord(issue) || !isRecord(issue.comments) || !Array.isArray(issue.comments.nodes)) {
    return failed("gh api graphql printed an unexpected shape for the spec issue's comments");
  }
  const record = issue.comments.nodes.filter(isRecord).find(
    (node) =>
      typeof node.body === "string" &&
      normaliseLineEndings(node.body).trimStart().startsWith(PENDING_MARKER) &&
      typeof node.authorAssociation === "string" &&
      WRITE_ACCESS.has(node.authorAssociation) &&
      typeof node.databaseId === "number",
  );
  if (record !== undefined && typeof record.body === "string" && typeof record.databaseId === "number") {
    return found({ count: countPending(record.body), commentId: record.databaseId });
  }
  const complete = nodesOf(issue.comments, "comments");
  return complete.ok ? found(null) : complete;
}

const OBJECT_ID = /^[0-9a-f]{40}$/i;

/** The PRs that land a spec branch: from this repo's `head` branch into `base`, the default branch. */
export function parsePullRequests(connection: unknown, head: string, base: string): Lookup<PullRequest[]> {
  const nodes = nodesOf(connection, "pull requests");
  if (!nodes.ok) return nodes;
  const prs: PullRequest[] = [];
  for (const node of nodes.value) {
    const { number, state, isDraft, isCrossRepository, headRefName, baseRefName } = node;
    if (typeof number !== "number" || !isOneOf(["OPEN", "MERGED", "CLOSED"] as const, state) || typeof isCrossRepository !== "boolean") {
      return failed("gh api graphql printed an unexpected shape for pull requests");
    }
    // A fork's branch with the same name is never the spec branch's PR, and a closed one, or one into another branch, lands nothing.
    if (state === "CLOSED" || isCrossRepository || headRefName !== head || baseRefName !== base) continue;
    const oid = isRecord(node.mergeCommit) && typeof node.mergeCommit.oid === "string" ? node.mergeCommit.oid : null;
    const headCommit = typeof node.headRefOid === "string" ? node.headRefOid : null;
    // Each id goes to git as an argument, so it has to be an object id and nothing else.
    if (oid !== null && !OBJECT_ID.test(oid)) return failed("gh api graphql printed a merge commit that is not a commit id");
    if (headCommit !== null && !OBJECT_ID.test(headCommit)) return failed("gh api graphql printed a head commit that is not a commit id");
    prs.push({ number, state, draft: isDraft === true, mergeCommit: oid, headCommit: headCommit?.toLowerCase() ?? null });
  }
  return found(prs);
}

/**
 * Spec issues an earlier `/orc-spec` may have filed: open, titled `<name>: `, with no parent. A closed one ended an
 * earlier use of the name, and the entry it would serve has no `Spec:` line yet, so none is ever this entry's.
 */
export function parseFoundSpecs(search: unknown, name: string): Lookup<{ ref: string; title: string; author: string }[]> {
  const nodes = searchNodes(search, "issues titled like the spec");
  if (!nodes.ok) return nodes;
  return found(
    nodes.value.flatMap((node) =>
      typeof node.number === "number" && typeof node.title === "string" && node.title.startsWith(`${name}: `) && node.state === "OPEN" && !isRecord(node.parent)
        ? [{ ref: `#${node.number}`, title: node.title, author: loginOf(node) }]
        : [],
    ),
  );
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

// ===========================================================================
// Facts (gathered by I/O below, judged by the pure functions after them)
// ===========================================================================

export interface BranchFacts {
  local: boolean;
  remote: boolean;
  /** `spec/<name>`, else `origin/spec/<name>`, else null when neither exists. */
  rangeRef: string | null;
  /** Commits on the range ref that neither the default branch nor `origin/<default>` holds. */
  range: Commit[];
  /** Refs: values on the default branch (or `origin/<default>`) on commits the range ref does not hold. */
  refsOffBranch: Set<string>;
  localUnmerged: number;
  remoteUnmerged: number;
  /** `spec/<name>` against `origin/spec/<name>`; null when either is missing. */
  ahead: number | null;
  behind: number | null;
  /** Commits of the default branch the range ref lacks. */
  behindDefault: number;
  /** Whether merging the default branch into the range ref would conflict; read for the target only, else null. */
  conflictsDefault: boolean | null;
}

export interface EntryFacts {
  entry: RoadmapEntry;
  /** null when the entry has no Spec: line or is dropped. */
  tracker: Lookup<TrackerFacts> | null;
  branch: BranchFacts;
  /** null when no PR lookup was needed. */
  prs: Lookup<PullRequestFact[]> | null;
  /** The local tracker's files on the spec branch, read for the target only; null on GitHub or with no spec branch. */
  onBranch: Lookup<BranchStatus> | null;
}

export type GhState = "ok" | "not-installed" | "not-authenticated" | "failed" | "not-used";
export type Remote = "github" | "other" | "none";

export interface AgentBranch {
  name: string;
  /** Commits neither the default branch nor the target's spec branch holds. */
  unmerged: number;
  tickets: string[];
}

export interface RepoFacts {
  defaultBranch: string;
  head: string | null;
  docsFrom: string | null;
  linkedWorktree: boolean;
  origin: boolean;
  remote: Remote;
  ahead: number | null;
  behind: number | null;
  /** Whether merging `origin/<default>` into a diverged default branch would conflict; null when not diverged or unknown. */
  defaultConflicts: boolean | null;
  dirty: { orc: string[]; other: string[] };
  worktrees: (Worktree & { agent: boolean })[];
  /** Linked worktrees other than this checkout that hold a branch. */
  otherWorktreeBranches: string[];
  landedRefs: Set<string>;
  inProgressRefs: Set<string>;
}

// ===========================================================================
// Derivation (pure)
// ===========================================================================

export type State =
  | "not-started"
  | "discussed"
  | "specced"
  | "ticketed"
  | "building"
  | "built"
  | "in-review"
  | "cleanup-pending"
  | "landed"
  | "squashed"
  | "unknown"
  | "dropped";

export type Note =
  | { kind: "leftover-branch"; ref: string; unmerged: number }
  | { kind: "ignored-issues"; count: number }
  | { kind: "pending-decisions"; count: number }
  | { kind: "conflicts-default"; ref: string }
  | { kind: "lookup-failed"; what: "tickets" | "prs" | "blockers" | "pending"; error: string };

export type Progress = "landed" | "built" | "in-progress" | "ready" | "blocked" | "open";

export interface NextStep {
  command: string;
  reason: string;
  kind: "run" | "wait" | "manual";
}

export interface TicketView {
  ref: string;
  title: string | null;
  progress: Progress;
  blockers: string[] | null;
  waitingOn: string[];
  satisfies: string[];
  path: string | null;
}

/** One entry judged: its state with the counts and notes that explain it. */
export interface EntryView {
  facts: EntryFacts;
  state: State;
  landing: { mode: LandingMode; source: "entry" | "config" };
  tickets: TicketView[];
  counts: { total: number; landed: number; built: number; inProgress: number; open: number } | null;
  notes: Note[];
  /** Why the state is unknown, in the script's own words. */
  unknownReason: string | null;
  pending: PendingFact | null;
  unresolved: string[];
  openPr: PullRequestFact | null;
  /** The merged PR whose merge commit is not fetched, which alone makes the state unknown. */
  unfetchedPr: number | null;
}

function landingOf(entry: RoadmapEntry, config: Config): { mode: LandingMode; source: "entry" | "config" } {
  return entry.landing === null ? { mode: config.landing, source: "config" } : { mode: entry.landing, source: "entry" };
}

function ticketViews(facts: EntryFacts, tickets: readonly TicketFact[], repo: RepoFacts): TicketView[] {
  const rangeRefs = new Set(facts.branch.range.flatMap((commit) => commit.refs));
  const isLanded = (ref: string): boolean => repo.landedRefs.has(ref) && !rangeRefs.has(ref);
  const isBuilt = (ref: string): boolean => rangeRefs.has(ref) || repo.landedRefs.has(ref);
  return tickets.map((ticket) => {
    const base = { ref: ticket.ref, title: ticket.title, satisfies: ticket.satisfies ?? [], path: ticket.path };
    const blockers = ticket.blockers?.ok === true ? ticket.blockers.value : null;
    const view = (progress: Progress, waitingOn: string[] = []): TicketView => ({ ...base, progress, blockers, waitingOn });
    if (isLanded(ticket.ref)) return view("landed");
    if (isBuilt(ticket.ref)) return view("built");
    if (repo.inProgressRefs.has(ticket.ref)) return view("in-progress");
    if (blockers === null) return view("open");
    const waitingOn = blockers.filter((ref) => !isBuilt(ref));
    return view(waitingOn.length === 0 ? "ready" : "blocked", waitingOn);
  });
}

function isRecordCommit(commit: Commit, name: string): boolean {
  return commit.files.length > 0 && commit.files.every((file) => isUnder(file, `.scratch/${name}`));
}

/** Commits on the range without a Refs: trailer, merges and record commits left out. */
export function untrailedCommits(facts: EntryFacts): string[] {
  return facts.branch.range
    .filter((commit) => !commit.isMerge && commit.refs.length === 0 && !isRecordCommit(commit, facts.entry.name))
    .map((commit) => commit.sha);
}

/** The state of one roadmap entry, in the order of spec 9.2: squashed is checked before landed. */
export function judgeEntry(facts: EntryFacts, repo: RepoFacts, config: Config): EntryView {
  const { entry } = facts;
  const landing = landingOf(entry, config);
  const view = (state: State, rest: Partial<EntryView> = {}): EntryView => ({
    facts, state, landing, tickets: [], counts: null, notes: [], unknownReason: null, pending: null, unresolved: [], openPr: null, unfetchedPr: null, ...rest,
  });
  if (entry.dropped) return view("dropped");
  if (entry.spec === null) return view(entry.discussed ? "discussed" : "not-started");
  if (facts.tracker === null || !facts.tracker.ok) {
    const error = facts.tracker?.ok === false ? facts.tracker.error : "no ticket lookup";
    return view("unknown", { notes: [{ kind: "lookup-failed", what: "tickets", error }], unknownReason: `the tickets of ${entry.name} could not be read` });
  }
  const tracker = facts.tracker.value;
  const notes: Note[] = [];
  if (tracker.ignored.length > 0) notes.push({ kind: "ignored-issues", count: tracker.ignored.length });
  const pending = tracker.pending?.ok === true ? tracker.pending.value : null;
  if (tracker.pending?.ok === false) notes.push({ kind: "lookup-failed", what: "pending", error: tracker.pending.error });
  for (const ticket of tracker.tickets) {
    if (ticket.blockers?.ok === false) notes.push({ kind: "lookup-failed", what: "blockers", error: ticket.blockers.error });
  }
  if (facts.branch.conflictsDefault === true && facts.branch.rangeRef !== null) notes.push({ kind: "conflicts-default", ref: facts.branch.rangeRef });
  const tickets = ticketViews(facts, tracker.tickets, repo);
  const tally = (...progress: Progress[]): number => tickets.filter((t) => progress.includes(t.progress)).length;
  const counts = { total: tickets.length, landed: tally("landed"), built: tally("built"), inProgress: tally("in-progress"), open: tally("ready", "blocked", "open") };
  const unresolved = [...(tracker.specOpen === true ? [entry.spec] : []), ...tracker.tickets.filter((t) => !t.resolved).map((t) => t.ref)];
  const base = { tickets, counts, notes, pending, unresolved };
  // A count or a list that could not be read in full is unknown, never zero or empty.
  if (tracker.pending?.ok === false) return view("unknown", { ...base, unknownReason: `the pending decisions of ${entry.name} could not be read` });
  if (tracker.tickets.some((t) => t.blockers?.ok === false)) return view("unknown", { ...base, unknownReason: `the blockers of the tickets of ${entry.name} could not be read` });
  if (facts.onBranch?.ok === false) {
    notes.push({ kind: "lookup-failed", what: "tickets", error: facts.onBranch.error });
    return view("unknown", { ...base, unknownReason: `the tickets of ${entry.name} on its spec branch could not be read` });
  }
  if (tickets.length === 0) return view("specced", base);

  if (facts.prs?.ok === false) {
    notes.push({ kind: "lookup-failed", what: "prs", error: facts.prs.error });
    return view("unknown", { ...base, unknownReason: facts.prs.reason ?? `the PRs of spec/${entry.name} could not be read` });
  }
  const prs = facts.prs?.value ?? [];
  const merged = prs.filter((pr) => pr.state === "MERGED");
  const unfetched = unfetchedMerge(facts);
  if (unfetched !== undefined) return view("unknown", { ...base, unknownReason: unfetchedReason(unfetched.number), unfetchedPr: unfetched.number });
  const rangeRefs = new Set(facts.branch.range.flatMap((commit) => commit.refs));
  const squashedPr = merged.some((pr) => pr.mergeParents !== 2);
  const rebased = tracker.tickets.some((t) => rangeRefs.has(t.ref) && facts.branch.refsOffBranch.has(t.ref));
  if (squashedPr || rebased) return view("squashed", base);

  const openPr = prs.find((pr) => pr.state === "OPEN") ?? null;
  if (counts.landed === counts.total) {
    if (facts.branch.local) notes.push({ kind: "leftover-branch", ref: `spec/${entry.name}`, unmerged: facts.branch.localUnmerged });
    if (facts.branch.remote) notes.push({ kind: "leftover-branch", ref: `origin/spec/${entry.name}`, unmerged: facts.branch.remoteUnmerged });
    if (pending !== null && pending.count > 0) notes.push({ kind: "pending-decisions", count: pending.count });
    return view(unresolved.length === 0 ? "landed" : "cleanup-pending", { ...base, openPr });
  }
  const builtCount = counts.landed + counts.built;
  if (builtCount === counts.total) return view(openPr === null ? "built" : "in-review", { ...base, openPr });
  return view(builtCount === 0 ? "ticketed" : "building", { ...base, openPr });
}

/** A merged PR whose merge commit this clone lacks: only a fetch can tell how it merged. */
function unfetchedMerge(facts: EntryFacts): PullRequestFact | undefined {
  return facts.prs?.ok === true ? facts.prs.value.find((pr) => pr.state === "MERGED" && pr.mergeParents === null) : undefined;
}

function unfetchedReason(pr: number): string {
  return `PR #${pr} is merged and its merge commit is not fetched yet: /orc-land fetches it`;
}

const manual = (command: string, reason: string): NextStep => ({ command, reason, kind: "manual" });
const run = (command: string, reason: string): NextStep => ({ command, reason, kind: "run" });

/** The ticket references still to build. */
function toBuildRefs(view: EntryView): string[] {
  return view.tickets.filter((t) => t.progress !== "built" && t.progress !== "landed").map((t) => t.ref);
}

export function nextForEntry(view: EntryView): NextStep {
  const { entry, branch } = view.facts;
  const name = entry.name;
  const total = view.counts?.total ?? 0;
  const spec = safeSpec(entry.spec, name);
  switch (view.state) {
    case "dropped":
    case "landed":
      return run("/orc-discuss", "add the next roadmap entry");
    case "not-started":
      return interviewNext(name);
    case "discussed":
      return run(`/orc-spec ${name}`, `${name} is discussed, no spec yet; run it in the interview's session`);
    case "specced": {
      const ignored = view.facts.tracker?.ok === true ? view.facts.tracker.value.ignored : [];
      if (ignored.length === 0) return run(`/orc-tickets ${name}`, `spec ${spec} exists, no tickets yet; run it in the spec's session`);
      return {
        command: `/orc-tickets ${name}`,
        reason: `${count(ignored.length, "issue")} saying Part of ${spec} ${ignored.length === 1 ? "is" : "are"} ignored (${ignored.map((i) => safeRef(i.ref)).join(", ")}): a maintainer adopts them with the ${ORC_TICKET_LABEL} label, or /orc-tickets ${name} files tickets beside them`,
        kind: "manual",
      };
    }
    case "ticketed":
    case "building": {
      if (branch.conflictsDefault === true) return conflictNext("orc-build", name);
      const where = branch.local ? ` on spec/${name}` : branch.remote ? ` on origin/spec/${name}` : "";
      return run(`/orc-build ${name}`, `${toBuildRefs(view).length} of ${total} tickets to build${where}; start it after /clear`);
    }
    case "built":
      if (view.pending !== null && view.pending.count > 0) {
        return run(`/orc-discuss ${name}`, `every ticket is built; ${count(view.pending.count, "decision")} to lock first`);
      }
      if (branch.conflictsDefault === true) return conflictNext("orc-land", name);
      return run(`/orc-land ${name}`, `every ticket is built; landing mode ${view.landing.mode}`);
    case "in-review": {
      const pr = view.openPr === null ? "the PR" : `PR #${view.openPr.number}`;
      if (view.landing.mode === "pr-human") {
        return { command: `/orc-land ${name}`, reason: `${pr} is waiting for review: merge it with a merge commit, then run this`, kind: "wait" };
      }
      return run(`/orc-land ${name}`, `${pr} is open; landing mode ${view.landing.mode}`);
    }
    case "cleanup-pending":
      return run(`/orc-land ${name}`, `landed; ${view.unresolved.length} tracker ${view.unresolved.length === 1 ? "item" : "items"} still open`);
    case "squashed":
      return manual("/orc", `after checking the landing of ${name} by hand: it was squashed or rebased`);
    case "unknown": {
      // A PR merged elsewhere is the one unknown that needs no fixing: /orc-land fetches before it judges.
      if (view.unfetchedPr !== null) return run(`/orc-land ${name}`, unfetchedReason(view.unfetchedPr));
      return manual("/orc", `after fixing what kept ${name} from being read: ${view.unknownReason ?? "a lookup failed"}`);
    }
  }
}

/** A spec branch the default branch cannot merge into cleanly: the user merges by hand, then the step goes on. */
function conflictNext(step: "orc-build" | "orc-land", name: string): NextStep {
  return manual(`/${step} ${name}`, `after merging the default branch into spec/${name} by hand: they conflict`);
}

/** The next step of an entry not discussed yet, also of a new entry the user chose to add. */
function interviewNext(name: string): NextStep {
  return run(`/orc-discuss ${name}`, `spec interview for ${name}`);
}

/** The entry the main flow is on: the first one not dropped and not finished. `/orc`, `/orc-next` and every bare step command but `/orc-discuss` and `/orc-land` act on it. */
export function focusOf(views: readonly EntryView[]): EntryView | null {
  return views.find((view) => view.state !== "dropped" && view.state !== "landed") ?? null;
}

// ===========================================================================
// Target resolution (pure)
// ===========================================================================

export type TargetMatch =
  | { kind: "entry"; entry: RoadmapEntry; ticket: string | null }
  | { kind: "none" | "ambiguous" | "dropped"; candidates: RoadmapEntry[] };

/** A `Spec:` value matches as a whole: `#12` exactly, a path exactly or by whole leading segments (`.scratch/auth`). */
function specMatches(spec: string, argument: string): boolean {
  if (spec === argument) return true;
  if (argument.startsWith("#") || argument === "") return false;
  return spec.startsWith(argument.endsWith("/") ? argument : `${argument}/`);
}

/**
 * Resolves an argument by spec 3.3. With `ticketsOf` (for `/orc-build`) a ticket reference names its entry too:
 * `<name>/<NN>` by its prefix, `#<n>` by the entry whose tickets hold it.
 */
export function resolveTarget(
  entries: readonly RoadmapEntry[],
  argument: string,
  ticketsOf: ((entry: RoadmapEntry) => string[]) | null = null,
): TargetMatch {
  const matches = entries.filter((entry) => entry.name === argument || (entry.spec !== null && specMatches(entry.spec, argument)));
  const live = entries.filter((entry) => !entry.dropped);
  const liveMatches = matches.filter((entry) => !entry.dropped);
  const only = liveMatches[0];
  if (liveMatches.length === 1 && only !== undefined) return { kind: "entry", entry: only, ticket: null };
  if (liveMatches.length > 1) return { kind: "ambiguous", candidates: liveMatches };
  if (matches.length === 0 && ticketsOf !== null && isTicketRef(argument)) {
    const owners = live.filter((entry) => ticketsOf(entry).includes(argument));
    const owner = owners[0];
    if (owners.length === 1 && owner !== undefined) return { kind: "entry", entry: owner, ticket: argument };
  }
  return { kind: matches.length === 0 ? "none" : "dropped", candidates: live };
}

// ===========================================================================
// Verdicts (pure, from the facts a Context gathers)
// ===========================================================================

export type StopReason =
  | "not-a-repo" | "no-commits" | "no-default-branch" | "not-root" | "no-config" | "bad-config"
  | "no-registry" | "broken-registry" | "ignored-lines" | "gh" | "lookup-failed" | "usage" | "error"
  | "off-default" | "state" | "blocker" | "dirty-orc" | "dirty" | "registry-dirty" | "pending-blocked"
  | "linked-worktree" | "branch-held" | "pr-blocked" | "spec-diverged" | "conflict" | "waiting" | "manual" | "node" | "null-role" | "other-repo";

export interface Stop {
  kind: "stop";
  reason: StopReason;
  message: string[];
  next: NextStep;
  /** Data: the git, gh or runtime text behind an error. */
  error?: string;
}

export type PickWhy = "none" | "ambiguous" | "dropped" | "choose" | "new-entry" | "leftovers";

/** What a landed entry still holds that `/orc-land` clears: its merged spec branches and its open tracker items. */
export interface Leftover {
  branches: string[];
  unresolved: string[];
}

export interface Candidate {
  number: number;
  name: string;
  spec: string | null;
}

export interface Pick {
  kind: "pick";
  why: PickWhy;
  candidates: Candidate[];
  other: boolean;
  offerAdd: boolean;
  /** With `leftovers`: what the first candidate, the landed entry, still holds. */
  leftover?: Leftover;
}

export interface EntryRef {
  number: number;
  name: string;
  spec: string | null;
  branch: string;
}

export interface UpstreamUse {
  role: Role | null;
  skill: string | null;
  path: string | null;
  pin: string | null;
  invoke: "skill-tool" | "read" | null;
}

export type Go = { kind: "go" } & (
  | { for: "orc"; report: string[]; status?: Status }
  | { for: "orc-next"; proposed: NextStep; verdict: Verdict }
  | {
      for: "orc-setup"; run: "first" | "update"; config: Partial<Config> | null; missingKeys: string[]; badKeys: string[];
      trackerLocked: boolean; remote: Remote; gh: GhState; testCandidates: string[]; vendored: { skill: string; pin: string }[];
    }
  | {
      for: "orc-discuss"; mode: "project" | "spec"; entry: EntryRef | null; visit: "first" | "revisit" | "new" | null; next: NextStep;
      tracker: Tracker; push: Push; landing: LandingMode; pending: PendingFact | null; remote: Remote; uncommitted: { registry: boolean; domain: string[] };
      problems: { line: number | null; kind: ProblemKind }[];
    }
  | {
      for: "orc-spec"; entry: EntryRef; next: NextStep; tracker: Tracker; push: Push; resume: "none" | "commit-record" | "found"; found: string[];
      foundDetail?: { ref: string; title: string; author: string }[]; ids: string[]; projectDecisions: number; triageLabels: boolean; byHand: NextStep | null;
    }
  | {
      for: "orc-tickets"; entry: EntryRef; next: NextStep; tracker: Tracker; push: Push; cited: string[]; triageLabels: boolean; byHand: NextStep | null;
      set: "none" | "complete" | "partial" | "uncommitted" | "ignored-only";
      tickets: { ref: string; satisfies: string[]; title?: string }[]; uncovered: string[]; ignored: { ref: string; author?: string }[];
    }
  | {
      for: "orc-build"; entry: EntryRef; next: NextStep; ticket: string | null; phase: "build" | "review-ask" | "cleanup"; mode: BuildMode;
      toBuild: { ref: string; path: string | null; satisfies: string[]; blockers: string[] }[]; built: string[]; landed: string[];
      branch: "local" | "restore" | "create"; mergeDefault: boolean; agentBranches: { name: string; unmerged: number }[];
      dirtyOther: string[]; reviewFixRounds: number; research: Research; test: string | null; buildStart: BuildStart;
      defaultBranch: string; pending: PendingFact | null;
      /** Local tracker: the built tickets the spec branch does not mark built yet; null on GitHub. */
      toMark: string[] | null;
    }
  | {
      for: "orc-land"; entry: EntryRef; next: NextStep; mode: LandingMode; modeSource: "entry" | "config"; push: Push; phase: "land" | "cleanup";
      tickets: string[]; unresolved: string[];
      /** Local tracker, phase land: what the spec branch does not read resolved yet; null otherwise. */
      toResolve: string[] | null;
      branch: { local: boolean; remote: boolean; ahead: number | null; behind: number | null; behindDefault: number };
      defaultBranch: { name: string; ahead: number | null; behind: number | null };
      pr: { number: number; state: PullRequestState; draft: boolean } | null; pending: number; test: string | null; remote: Remote;
    }
);

export interface Verdict {
  schema: 1;
  /** null only for a usage error that named no command. */
  command: Command | null;
  stamp: { head: string | null; at: string };
  origin: boolean;
  banner: string[];
  lines: string[];
  ids: string[];
  upstream: UpstreamUse[];
  /** The headings of the command's reference.md to follow, in the order the run meets them. */
  reference: string[];
  outcome: Stop | Pick | Go;
}

export interface Status {
  next: NextStep;
  config: Config;
  upstream: Record<Role, { path: string; skill: string } | null>;
  pins: Record<string, string>;
  repo: {
    defaultBranch: string;
    head: string | null;
    docsFrom: string | null;
    linkedWorktree: boolean;
    origin: boolean;
    ahead: number | null;
    behind: number | null;
    gh: GhState;
    dirty: { orc: string[]; other: string[] };
    worktrees: { path: string; branch: string | null; agent: boolean; locked: boolean }[];
    agentBranches: AgentBranch[];
  };
  registry: { requirements: number; decisions: number; superseded: number; problems: Problem[] } | null;
  entries: StatusEntry[];
  discussable: string[];
  target: StatusTarget | null;
}

export interface StatusEntry {
  number: number;
  name: string;
  state: State;
  discussed: boolean;
  spec: string | null;
  landing: { mode: LandingMode; source: "entry" | "config" };
  ticketCounts: { total: number; landed: number; built: number; inProgress: number; open: number } | null;
  pendingDecisions: number | null;
  notes: Note[];
}

export interface StatusTarget extends StatusEntry {
  ticket: string | null;
  branch: { name: string; local: boolean; remote: boolean; ahead: number | null; behind: number | null; behindDefault: number };
  tickets: { ref: string; title: string | null; progress: Progress; blockers: string[] | null; waitingOn: string[] }[];
  ignoredIssues: IgnoredIssue[];
  unresolved: string[];
  prs: { number: number; state: PullRequestState; draft: boolean; mergeParents: number | null }[] | null;
  untrailedCommits: string[];
  pending: PendingFact | null;
  requirements: string[];
}

// ---------------------------------------------------------------------------
// Banners: fixed per command; only Target: depends on the target (spec 3.1)
// ---------------------------------------------------------------------------

interface BannerText {
  title: string;
  runs: string;
  reads: string;
  writes: string;
  outward: string;
}

const BANNERS: Record<Command, BannerText> = {
  orc: {
    title: "/orc  (GSD: progress)",
    runs: "orc's status script (no upstream skill)",
    reads: "orc's verdict",
    writes: "nothing",
    outward: "none",
  },
  "orc-next": {
    title: "/orc-next  (GSD: next)",
    runs: "the orc command you confirm, by following its skill file",
    reads: "orc's verdict, then the confirmed command's skill file",
    writes: "nothing until you confirm; then what that command's banner says",
    outward: "none until you confirm; then what that command's banner says",
  },
  "orc-setup": {
    title: "/orc-setup  (GSD: new-project, tooling part)",
    runs: "npx -y skills@1 add mattpocock/skills at one pinned commit; first run: upstream setup-matt-pocock-skills",
    reads: "orc's verdict, mattpocock/skills (a shallow clone)",
    writes: ".claude/skills/, skills-lock.json, .claude/rules/, .claude/settings.json, .gitignore, docs/agents/, docs/orc/config.json; one commit after you confirm",
    outward: "GitHub tracker: creates upstream's labels and orc's built and orc-ticket",
  },
  "orc-discuss": {
    title: "/orc-discuss  (GSD: new-project interview, discuss-phase)",
    runs: "upstream grilling and domain-modeling, at their locked commits",
    reads: "orc's verdict, docs/orc/registry.md, GLOSSARY.md and docs/adr/, the pending decisions",
    writes: "the glossary and ADRs during the interview; registry lines only after you confirm, one commit",
    outward: "pushes the default branch (per push); GitHub, whatever push says: edits or deletes the pending-decisions comment",
  },
  "orc-spec": {
    title: "/orc-spec  (GSD: spec-phase)",
    runs: "upstream to-spec (config role spec), at its locked commit",
    reads: "orc's verdict, the registry lines it cites, GLOSSARY.md and docs/adr/, this conversation",
    writes: "the spec, then its Spec: and Branch: lines in docs/orc/registry.md, one commit",
    outward: "GitHub: creates the spec issue; both: pushes the default branch (per push)",
  },
  "orc-tickets": {
    title: "/orc-tickets  (GSD: plan-phase)",
    runs: "upstream to-tickets (config role tickets), at its locked commit",
    reads: "orc's verdict, the spec, the registry lines it cites, GLOSSARY.md and docs/adr/",
    writes: "tickets with blocking edges, only after you approve the breakdown",
    outward: "GitHub: creates the ticket issues; local: pushes the default branch (both per push)",
  },
  "orc-build": {
    title: "/orc-build  (GSD: execute-phase)",
    runs: "upstream implement-spec or implement, with tdd and code-review, at their locked commits",
    reads: "orc's verdict, the spec, its tickets, the registry lines they cite",
    writes: "code and tests on spec/<name>, every commit with its ticket's Refs: trailer",
    outward: "none (no push, no PR; /orc-land lands the branch); GitHub, whatever push says: built labels and the pending-decisions comment",
  },
  "orc-land": {
    title: "/orc-land  (GSD: ship)",
    runs: "the landing mode; PR modes: upstream pr (config role land), at its locked commit",
    reads: "orc's verdict, git, the PR and its checks",
    writes: "on spec/<name>: the default branch merged in and local tickets resolved; then the merge, branches and worktrees removed",
    outward: "per push: pushes, opens and merges PRs as the mode says, deletes origin/spec/<name>; GitHub, whatever push says: closes the issues",
  },
};

function banner(command: Command, target: string): string[] {
  const text = BANNERS[command];
  return [
    text.title,
    `Runs:    ${text.runs}`,
    `Target:  ${target}`,
    `Reads:   ${text.reads}`,
    `Writes:  ${text.writes}`,
    `Outward: ${text.outward}`,
  ];
}

/** A name or reference typed into a command: safe-name characters, or `#<n>`. */
function isTypedName(value: string): boolean {
  return isSafeName(value) || ISSUE_REF.test(value);
}

function typedTarget(argument: string): string {
  return `${safe(argument, isTypedName)} (as given)`;
}

// ---------------------------------------------------------------------------
// The judging context: facts gathered lazily, each at most once
// ---------------------------------------------------------------------------

/** Everything a verdict may need, gathered on first use. Implemented by `Gatherer` in the I/O section. */
export interface Facts {
  cwdIsRoot: boolean;
  hasCommits: boolean;
  head: string | null;
  headBranch: string | null;
  defaultBranch: string | null;
  origin: boolean;
  remote: Remote;
  config: DocRead;
  registryDoc: DocRead;
  /** The registry as HEAD holds it, when HEAD is on the default branch: what the working tree has not committed. */
  committedRegistry(): DocRead;
  docsFrom: string | null;
  lockDoc: DocRead;
  /** Each locked skill's commit and source; empty when the lock file is absent. */
  lock(): Map<string, LockEntry>;
  userInvoked(path: string): boolean | null;
  repo(config: Config): RepoFacts;
  /** Every roadmap entry's facts; the target, when named, is read in detail. */
  entries(config: Config, registry: Registry, detailFor: (views: EntryView[]) => RoadmapEntry | null): EntryFacts[];
  gh(): GhState;
  /** gh's state: what an earlier call showed, else `gh auth status`. */
  checkGh(): GhState;
  /** Known once the entries are gathered, since the same query reads it. */
  mergeCommitAllowed(): boolean | null;
  /** The worktree-agent-* branches, counted against the default branch and the given spec branch. */
  agentBranches(specRef: string | null): AgentBranch[];
  testCandidates(): string[];
  foundSpecs(config: Config, entry: RoadmapEntry): Lookup<{ ref: string; title: string; author: string }[]>;
  localTicketFilesUncommitted(name: string): boolean;
  /** Whether upstream's setup wrote its triage label mapping, which it does when it creates those labels. */
  triageLabels(): boolean;
}

/** The stop for a doc that exists and cannot be read: never the path that would write a new one over it. */
function unreadableStop(path: string, read: DocRead, on: string): Stop | null {
  if (read.kind !== "unreadable") return null;
  return stop("error", [`${path} exists but could not be read${on}; the reason is in --json.`], manual("/orc", `after making ${path} readable`), read.error);
}

/** Where the docs were read, for a message: nothing for the working tree. */
function docsOn(facts: Facts): string {
  return facts.docsFrom === null ? "" : ` on ${facts.docsFrom.startsWith("origin/") ? "origin's default branch" : "the default branch"}`;
}

interface Judged {
  config: Config;
  registry: Registry;
  repo: RepoFacts;
  views: EntryView[];
  status: Status;
  agentBranches: AgentBranch[];
  /** Read by the same query as the entries, so it is known once they are gathered. */
  mergeCommitAllowed: boolean | null;
}

/** Where a verdict is being built: the command, its argument, the clock and the facts. */
interface Request {
  command: Command;
  argument: string | null;
  /** The argument names a new roadmap entry the user chose to add (`--new`). */
  newEntry: boolean;
  facts: Facts;
  now: Date;
}

function stamp(head: string | null, now: Date): Verdict["stamp"] {
  return { head, at: `${now.toISOString().slice(0, 19)}Z` };
}

/**
 * A pointer to wait or to fix something by hand never names the command that gives it, since running that again
 * first changes nothing: it points at `/orc`, which judges again and names the step, and `/orc`'s own at
 * `/orc-next`. A step to run may name the same command on another target (`/orc-build <blocker>`).
 */
export function awayFrom(command: Command, next: NextStep): NextStep {
  if (next.kind === "run" || next.command.split(" ")[0] !== `/${command}`) return next;
  return { ...next, command: command === "orc" ? "/orc-next" : "/orc" };
}

function verdictOf(request: Request, parts: Partial<Omit<Verdict, "outcome">> & { outcome: Verdict["outcome"] }): Verdict {
  const target = request.argument === null ? "none given" : typedTarget(request.argument);
  const outcome = parts.outcome.kind === "stop" ? { ...parts.outcome, next: awayFrom(request.command, parts.outcome.next) } : parts.outcome;
  return {
    schema: SCHEMA,
    command: request.command,
    stamp: stamp(request.facts.head, request.now),
    origin: request.facts.origin,
    banner: banner(request.command, target),
    lines: [],
    ids: [],
    upstream: [],
    reference: [],
    ...parts,
    outcome,
  };
}

function stop(reason: StopReason, message: string[], next: NextStep, error?: string): Stop {
  return error === undefined ? { kind: "stop", reason, message, next } : { kind: "stop", reason, message, next, error };
}

function entryRef(entry: RoadmapEntry): EntryRef {
  return { number: entry.number, name: entry.name, spec: entry.spec, branch: `spec/${entry.name}` };
}

function targetLine(entry: RoadmapEntry): string {
  const spec = entry.spec === null ? "no spec yet" : `spec ${safeSpec(entry.spec, entry.name)}`;
  return `Target:  ${entry.name} (roadmap entry ${entry.number}), ${spec}`;
}

function invocation(request: Request, argument: string | null): string {
  return argument === null || !isTypedName(argument) ? `/${request.command}` : `/${request.command} ${argument}`;
}

/** One upstream skill: its pin from `skills-lock.json` and how it is called. */
function upstreamUse(facts: Facts, role: Role | null, path: string | null): UpstreamUse {
  const skill = path === null ? null : skillOfPath(path);
  const userInvoked = path === null ? null : facts.userInvoked(path);
  return {
    role,
    skill,
    path,
    pin: skill === null ? null : (facts.lock().get(skill)?.commit.slice(0, 7) ?? null),
    invoke: userInvoked === null ? null : userInvoked ? "read" : "skill-tool",
  };
}

/** The upstream skills a command uses: its roles' skills from the config, then the ones it calls by name. */
function upstreamUses(facts: Facts, config: Config, roles: readonly Role[], byName: readonly string[] = []): UpstreamUse[] {
  return [...roles.map((role) => upstreamUse(facts, role, config.upstream[role])), ...byName.map((skill) => upstreamUse(facts, null, vendoredPath(skill)))];
}

function vendoredPath(skill: string): string {
  return `.claude/skills/${skill}/SKILL.md`;
}

/** The setup role's skill as `config-template.json` names it: what a first run follows before any config exists. */
const TEMPLATE_SETUP_SKILL = "setup-matt-pocock-skills";

/** A role's skill is the folder of its config path. */
function skillOfPath(path: string): string {
  const parts = path.split("/");
  return parts.length >= 2 ? (parts[parts.length - 2] ?? path) : path;
}

function pinnedLine(uses: readonly UpstreamUse[]): string[] {
  if (uses.length === 0) return [];
  const pins = uses.map((use) => (use.skill === null ? `${use.role ?? "skill"} @ unresolved` : `${safeSkill(use.skill)} @ ${use.pin ?? "unlocked"}`));
  return [`Pinned:  ${pins.join(", ")}`];
}

function nullRole(uses: readonly UpstreamUse[]): string[] {
  return uses.some((use) => use.role !== null && use.skill === null) ? ["null-role"] : [];
}

/** The upstream command each wrapper with no reference file briefs, named when its role is unresolved. */
const BRIEFED_COMMAND: Partial<Record<Role, string>> = { spec: "/to-spec", tickets: "/to-tickets" };

/**
 * `/orc-spec` and `/orc-tickets` have no reference file, so an unresolved role is a stop of their own, judged once
 * the run would need the skill: the message says what to type instead, and setup resolves it.
 */
function unresolvedRoleStop(lines: string[], role: Role, uses: readonly UpstreamUse[]): Stop | null {
  if (!uses.some((use) => use.role === role && use.skill === null)) return null;
  return stop(
    "null-role",
    [
      ...lines,
      `No upstream skill is resolved for the ${role} role (upstream.${role} is null in ${CONFIG_PATH}), so orc has nothing to brief.`,
      `Typing ${BRIEFED_COMMAND[role] ?? "the upstream command"} (or what replaced it upstream) runs upstream's own step, without orc's brief or registry ids.`,
    ],
    run("/orc-setup", "resolves the missing upstream skill"),
  );
}

// ---------------------------------------------------------------------------
// The stops every verdict judges first (spec 9.3)
// ---------------------------------------------------------------------------

export function nodeIsSupported(version: string): boolean {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (const [index, floor] of NODE_FLOOR.entries()) {
    const part = parts[index] ?? 0;
    if (part !== floor) return part > floor;
  }
  return true;
}

const SETUP_NEXT = run("/orc-setup", "sets the repo up for orc");

/** The repo-level stops, before any config is read. null when the command may go on. */
function repoStops(request: Request, nodeVersion: string): Stop | null {
  const { facts } = request;
  if (!nodeIsSupported(nodeVersion)) {
    return stop("node", [`orc needs Node ${NODE_FLOOR.join(".")} or newer, and this is Node ${safe(nodeVersion.replace(/^v/, ""), (v) => /^[0-9.]+$/.test(v))}.`],
      manual("/orc", "after installing a newer Node"));
  }
  if (request.command === "orc-setup") return null;
  if (!facts.hasCommits) {
    return stop("no-commits", ["This repo has no commits yet, so it has no default branch."], manual("/orc-setup", "commit its files as it offers, then run any orc command"));
  }
  if (facts.defaultBranch === null) {
    return stop("no-default-branch", ["orc cannot tell the default branch: origin/HEAD is not set and there is no main or master branch. git remote set-head origin --auto, or renaming the branch to main, settles it."],
      manual("/orc", "after settling the default branch"));
  }
  return null;
}

type ConfigOutcome = { ok: true; config: Config } | { ok: false; stop: Stop };

function configStops(facts: Facts): ConfigOutcome {
  const on = docsOn(facts);
  const unreadable = unreadableStop(CONFIG_PATH, facts.config, on) ?? unreadableStop(LOCK_PATH, facts.lockDoc, on);
  if (unreadable !== null) return { ok: false, stop: unreadable };
  if (facts.config.kind !== "text") {
    return { ok: false, stop: stop("no-config", [`This repo is not set up for orc: ${CONFIG_PATH} does not exist${on}.`], SETUP_NEXT) };
  }
  const check = parseConfig(facts.config.text);
  if (!check.ok) return { ok: false, stop: stop("bad-config", [`${check.error}${on}.`], run("/orc-setup", "repairs the config")) };
  const config = completeConfig(check.value);
  if (config === null) {
    const keys = [...check.value.missingKeys.map((k) => `${k} (missing)`), ...check.value.badKeys.map((k) => `${k} (unknown value)`)];
    return { ok: false, stop: stop("bad-config", [`${CONFIG_PATH}${on} is incomplete: ${keys.join(", ")}.`], run("/orc-setup", "fills in the config")) };
  }
  return { ok: true, config };
}

/** A registry that cannot be read stops with an empty one beside it, so `/orc` can still report. */
type RegistryOutcome = { kind: "ok"; registry: Registry } | { kind: "none" } | { kind: "stop"; stop: Stop; registry: Registry };

function problemText(problem: { line: number | null; kind: ProblemKind }): string {
  return problem.line === null ? problem.kind : `line ${problem.line} ${problem.kind}`;
}

function registryStops(facts: Facts): RegistryOutcome {
  const unreadable = unreadableStop(REGISTRY_PATH, facts.registryDoc, docsOn(facts));
  if (unreadable !== null) return { kind: "stop", stop: unreadable, registry: parseRegistry("## Roadmap\n") };
  if (facts.registryDoc.kind !== "text") return { kind: "none" };
  const registry = parseRegistry(facts.registryDoc.text);
  if (!registry.hasRoadmap) {
    return { kind: "stop", registry, stop: stop("broken-registry", [`${REGISTRY_PATH} has no ## Roadmap heading, so it is broken, not an empty roadmap.`], manual("/orc", `after fixing ${REGISTRY_PATH}`)) };
  }
  const ignored = registry.problems.filter((problem) => problem.ignoresEntry);
  if (ignored.length > 0) {
    return {
      kind: "stop",
      registry,
      stop: stop("ignored-lines", [`${REGISTRY_PATH} has roadmap lines that are not entries: ${ignored.map(problemText).join(", ")}.`, "Give each a kebab-case name no other entry has, or delete a line that repeats an entry."],
        manual("/orc", `after fixing ${REGISTRY_PATH}`)),
    };
  }
  return { kind: "ok", registry };
}

const NO_REGISTRY_NEXT = run("/orc-discuss", "project interview: requirements, architecture, roadmap");

function ghNeeded(command: Command, config: Config, view: EntryView | null): boolean {
  if (config.tracker === "github") return true;
  return command === "orc-land" && view !== null && view.landing.mode !== "local-merge";
}

/** What fixes gh when it is not usable, in the script's own words. */
function ghFix(state: GhState): NextStep | null {
  switch (state) {
    case "not-installed":
      return manual("/orc", "after installing gh and running gh auth login");
    case "not-authenticated":
      return manual("/orc", "after gh auth login");
    case "failed":
      return manual("/orc", "after the GitHub lookup works again: orc --json holds its error");
    case "ok":
    case "not-used":
      return null;
  }
}

function ghStop(state: GhState): Stop | null {
  const fix = ghFix(state);
  if (fix === null || state === "failed") return null;
  return stop("gh", [state === "not-installed" ? "gh is not installed, and this step needs it." : "gh is not logged in, and this step needs it."], fix);
}

/** `/orc` needs gh for the GitHub tracker, and for the PRs of an entry that lands through one. */
function orcNeedsGh(config: Config, views: readonly EntryView[], origin: boolean): boolean {
  return config.tracker === "github" || (origin && views.some((v) => v.facts.entry.spec !== null && v.landing.mode !== "local-merge"));
}

// ---------------------------------------------------------------------------
// The /orc report (title-free) and Status
// ---------------------------------------------------------------------------

/** One note on an entry, its pointers naming the entry so they reach it from any state. */
function noteText(note: Note, name: string, push: Push): string {
  switch (note.kind) {
    case "leftover-branch":
      if (note.unmerged > 0) return `${note.ref} holds ${count(note.unmerged, "commit")} that never landed: check them, then delete it by hand`;
      // The landing's cleanup removes a merged branch, origin's too unless push is never, which leaves that delete to the user.
      return note.ref.startsWith("origin/") && push === "never"
        ? `${note.ref} is merged and still exists: delete it by hand with git push origin --delete ${note.ref.slice("origin/".length)}, since push is never`
        : `${note.ref} is merged and still exists: /orc-land ${name} removes it`;
    case "ignored-issues":
      return `${count(note.count, "issue")} saying Part of the spec ignored, since ${note.count === 1 ? "its author has" : "their authors have"} no write access and no ${ORC_TICKET_LABEL} label`;
    case "pending-decisions":
      return `${count(note.count, "pending decision")} left: /orc-discuss ${name} locks them`;
    case "lookup-failed":
      return `the ${note.what} lookup failed (its error is in --json)`;
    case "conflicts-default":
      return `${note.ref} and the default branch conflict: merge the default branch into it by hand, since the build and the landing merge it in first`;
  }
}

function stateLabel(view: EntryView): string {
  const c = view.counts;
  switch (view.state) {
    case "ticketed":
    case "building":
      return `${view.state}, ${c === null ? 0 : c.built + c.landed} of ${c?.total ?? 0} tickets built`;
    case "in-review":
      return view.openPr === null ? "in-review" : `in-review, PR #${view.openPr.number}`;
    default:
      return view.state;
  }
}

function orcReport(judged: Judged, target: EntryView | null, ticket: string | null, ghNeeded: boolean): string[] {
  const { status, repo } = judged;
  const lines: string[] = [];
  if (ghNeeded && status.repo.gh !== "ok") lines.push(`Gh: ${status.repo.gh}, and this repo's tracker or landing mode needs it`);
  const docsTip = repo.docsFrom?.startsWith("origin/") === true ? "origin's default branch tip" : "the default branch tip";
  lines.push(repo.docsFrom === null ? "Docs: the working tree" : `Docs: ${docsTip}, since HEAD is ${repo.head === null ? "detached" : "off the default branch"}`);
  lines.push("Roadmap:");
  if (judged.views.length === 0) lines.push("  (no entries)");
  for (const view of judged.views) lines.push(`  ${view.facts.entry.number}. ${view.facts.entry.name}  ${stateLabel(view)}`);
  if (target !== null) {
    const entry = target.facts.entry;
    lines.push(`Target: ${entry.name}, branch spec/${entry.name}${ticket === null ? "" : `, ticket ${safeRef(ticket)}`}`);
    lines.push(`State: ${stateLabel(target)}`);
    lines.push(`Landing: ${target.landing.mode} (${target.landing.source === "entry" ? "the entry's Landing: line" : "the config default"})`);
    const requirements = requirementsOf(judged.registry, entry);
    lines.push(`Delivers: ${requirements.length === 0 ? "none named" : requirements.join(" ")}`);
    if (target.counts !== null && target.counts.total > 0) {
      const c = target.counts;
      lines.push(`Tickets: ${c.landed} landed, ${c.built} built, ${c.inProgress} in progress, ${c.open} open, of ${c.total}`);
      for (const t of target.tickets) {
        const waiting = t.waitingOn.length === 0 ? "" : ` (waiting on ${t.waitingOn.map(safeRef).join(" ")})`;
        lines.push(`  ${safeRef(t.ref)} ${t.progress}${waiting}`);
      }
    }
    if (target.facts.branch.rangeRef !== null) {
      const untrailed = untrailedCommits(target.facts).map(safeSha);
      lines.push(`Untrailed commits on ${target.facts.branch.rangeRef}: ${untrailed.length === 0 ? "none" : untrailed.join(" ")}`);
    }
    if (target.pending !== null && target.pending.count > 0) lines.push(`${count(target.pending.count, "decision")} to lock`);
    for (const note of target.notes) lines.push(`Note: ${noteText(note, target.facts.entry.name, judged.config.push)}`);
  }
  for (const view of judged.views) {
    if (view === target) continue;
    for (const note of view.notes) lines.push(`Note on ${view.facts.entry.name}: ${noteText(note, view.facts.entry.name, judged.config.push)}`);
  }
  const leftover = repo.worktrees.filter((w) => w.agent);
  if (leftover.length > 0) {
    const locked = leftover.filter((w) => w.locked).length;
    lines.push(`Worktrees left behind: ${leftover.length}${locked > 0 ? `, ${locked} locked` : ""}: the cleanup of /orc-build or /orc-land shows each with its files before removing it`);
  }
  if (repo.ahead !== null && repo.behind !== null && repo.ahead > 0 && repo.behind > 0) {
    const sides = repo.ahead === repo.behind ? `each hold ${count(repo.ahead, "commit")} the other lacks` : `hold ${repo.ahead} and ${count(repo.behind, "commit")} the other lacks`;
    const merge = repo.defaultConflicts === true ? "and they conflict: merge origin's into it by hand" : repo.defaultConflicts === false ? "and merge cleanly: /orc-land merges origin's in" : "and whether they conflict is unknown";
    lines.push(`Diverged: the default branch and origin's (as last fetched) ${sides}, ${merge}`);
  } else if (repo.ahead !== null && repo.ahead > 0) {
    lines.push(`Unpushed: ${count(repo.ahead, "commit")} on the default branch that origin's lacks (as last fetched)`);
  }
  const problems = status.registry?.problems ?? [];
  if (problems.length > 0) lines.push(`Registry problems: ${problems.map(problemText).join(", ")}`);
  lines.push("Off the main flow, ask upstream's /ask-matt.");
  lines.push(pointer(status.next));
  return lines;
}

export function pointer(next: NextStep): string {
  return `Done. Next: ${next.command}   (${next.reason})`;
}

function statusEntry(view: EntryView): StatusEntry {
  const entry = view.facts.entry;
  return {
    number: entry.number,
    name: entry.name,
    state: view.state,
    discussed: entry.discussed,
    spec: entry.spec,
    landing: view.landing,
    ticketCounts: view.counts,
    pendingDecisions: view.facts.tracker?.ok === true && view.facts.tracker.value.pending?.ok === true ? (view.pending?.count ?? 0) : null,
    notes: view.notes,
  };
}

function statusTarget(view: EntryView, registry: Registry, ticket: string | null): StatusTarget {
  const { entry, branch } = view.facts;
  const prs = view.facts.prs?.ok === true ? view.facts.prs.value : null;
  return {
    ...statusEntry(view),
    ticket,
    branch: { name: `spec/${entry.name}`, local: branch.local, remote: branch.remote, ahead: branch.ahead, behind: branch.behind, behindDefault: branch.behindDefault },
    tickets: view.tickets.map((t) => ({ ref: t.ref, title: t.title, progress: t.progress, blockers: t.blockers, waitingOn: t.waitingOn })),
    ignoredIssues: view.facts.tracker?.ok === true ? view.facts.tracker.value.ignored : [],
    unresolved: view.unresolved,
    prs: prs === null ? null : prs.map((pr) => ({ number: pr.number, state: pr.state, draft: pr.draft, mergeParents: pr.mergeParents })),
    untrailedCommits: untrailedCommits(view.facts),
    pending: view.pending,
    requirements: requirementsOf(registry, entry),
  };
}

/** The entries `/orc-discuss` offers with no argument: not dropped and not landed, undiscussed first, in roadmap order. */
function discussable(views: readonly EntryView[]): RoadmapEntry[] {
  const eligible = views.filter((v) => v.state !== "dropped" && v.state !== "landed" && v.state !== "cleanup-pending").map((v) => v.facts.entry);
  return [...eligible.filter((e) => !e.discussed), ...eligible.filter((e) => e.discussed)];
}

function overallNext(registry: Registry, views: readonly EntryView[], target: EntryView | null): NextStep {
  if (target !== null && target.state !== "landed" && target.state !== "dropped") return nextForEntry(target);
  if (registry.entries.length === 0) return run("/orc-discuss", "add the first roadmap entry");
  const focus = focusOf(views);
  return focus === null ? run("/orc-discuss", "add the next roadmap entry") : nextForEntry(focus);
}

// ---------------------------------------------------------------------------
// Judging the roadmap
// ---------------------------------------------------------------------------

type JudgedRoadmap = Judged & { target: EntryView | null };

/** Gathers and judges every entry, the target in detail, and builds the Status of 9.5. */
function judge(request: Request, config: Config, registry: Registry, pick: (views: EntryView[]) => RoadmapEntry | null): JudgedRoadmap {
  const { facts } = request;
  const repo = facts.repo(config);
  let chosen: RoadmapEntry | null = null;
  const entryFacts = facts.entries(config, registry, (views) => {
    chosen = pick(views);
    return chosen;
  });
  const views = entryFacts.map((f) => judgeEntry(f, repo, config));
  const targetEntry: RoadmapEntry | null = chosen ?? pick(views);
  const target = views.find((v) => v.facts.entry.name === targetEntry?.name) ?? null;
  const agentBranches = facts.agentBranches(target?.facts.branch.rangeRef ?? null);
  const lock = facts.lock();
  const status: Status = {
    next: overallNext(registry, views, target),
    config,
    upstream: byRole((role) => {
      const path = config.upstream[role];
      return path === null ? null : { path, skill: skillOfPath(path) };
    }),
    pins: Object.fromEntries([...lock].map(([skill, entry]) => [skill, entry.commit])),
    repo: {
      defaultBranch: repo.defaultBranch,
      head: repo.head,
      docsFrom: repo.docsFrom,
      linkedWorktree: repo.linkedWorktree,
      origin: repo.origin,
      ahead: repo.ahead,
      behind: repo.behind,
      gh: facts.gh(),
      dirty: repo.dirty,
      worktrees: repo.worktrees,
      agentBranches,
    },
    registry: {
      requirements: registry.ids.filter((l) => l.kind === "requirement").length,
      decisions: registry.ids.filter((l) => l.kind === "decision").length,
      superseded: supersededBy(registry).size,
      problems: registry.problems,
    },
    entries: views.map(statusEntry),
    discussable: discussable(views).map((e) => e.name),
    target: null,
  };
  return { config, registry, repo, views, status, target, agentBranches, mergeCommitAllowed: facts.mergeCommitAllowed() };
}

/** A pick for an argument that names no single live entry, or for entries the user chooses among. */
function pickOf(why: PickWhy, entries: readonly RoadmapEntry[], offerAdd = false, other = false): Pick {
  const many = entries.length > 4;
  const shown = many ? entries.slice(0, 3) : entries;
  return {
    kind: "pick",
    why,
    candidates: shown.map((e) => ({ number: e.number, name: e.name, spec: e.spec })),
    other: other || many,
    offerAdd,
  };
}

type Resolution = { kind: "target"; view: EntryView; ticket: string | null } | { kind: "pick"; pick: Pick } | { kind: "none" };

/** Each entry's ticket references, for resolving a ticket target. */
function ticketRefsOf(views: readonly EntryView[]): (entry: RoadmapEntry) => string[] {
  return (entry) => views.find((v) => v.facts.entry === entry)?.tickets.map((t) => t.ref) ?? [];
}

/** Resolves the argument, or the focus without one, against judged entries. */
function resolveFor(judged: JudgedRoadmap, argument: string | null, ticketTargets: boolean): Resolution {
  if (argument === null) return judged.target === null ? { kind: "none" } : { kind: "target", view: judged.target, ticket: null };
  const match = resolveTarget(judged.registry.entries, argument, ticketTargets ? ticketRefsOf(judged.views) : null);
  // A pick needs something to choose: with no candidate the argument resolves as no argument would on that roadmap.
  if (match.kind !== "entry") return match.candidates.length === 0 ? { kind: "none" } : { kind: "pick", pick: pickOf(match.kind, match.candidates) };
  const view = judged.views.find((v) => v.facts.entry === match.entry);
  return view === undefined ? { kind: "none" } : { kind: "target", view, ticket: match.ticket };
}

/** A bare `/orc-land`: its target, or the choice between finishing a landed entry and going on to the next. */
function resolveLanding(judged: JudgedRoadmap): Resolution {
  const target = landTarget(judged.views, judged.config);
  if (target.kind === "none") return target;
  if (target.kind === "target") return { kind: "target", view: target.view, ticket: null };
  return { kind: "pick", pick: { ...pickOf("leftovers", [target.landed.facts.entry, target.next.facts.entry]), leftover: target.leftover } };
}

/**
 * What a landing can still clear on a landed entry: tracker items left open, and spec branches git shows merged.
 * A branch holding commits that never landed is not one, nor is origin's under `push: never`, since no run removes them.
 */
function leftoverOf(view: EntryView, config: Config): Leftover | null {
  if (view.state !== "landed" && view.state !== "cleanup-pending") return null;
  const branches = view.notes.flatMap((note) =>
    note.kind === "leftover-branch" && note.unmerged === 0 && !(note.ref.startsWith("origin/") && config.push === "never") ? [note.ref] : [],
  );
  return branches.length + view.unresolved.length === 0 ? null : { branches, unresolved: view.unresolved };
}

/**
 * What a bare `/orc-land` acts on. The first landed entry with leftovers and the first entry that has not landed
 * are a choice for the user when both exist; alone, either one is the target.
 */
type LandTarget = { kind: "choice"; landed: EntryView; leftover: Leftover; next: EntryView } | { kind: "target"; view: EntryView } | { kind: "none" };

function landTarget(views: readonly EntryView[], config: Config): LandTarget {
  const landed = views.find((view) => leftoverOf(view, config) !== null);
  const leftover = landed === undefined ? null : leftoverOf(landed, config);
  const next = views.find((view) => view.state !== "dropped" && view.state !== "landed" && view.state !== "cleanup-pending");
  if (landed !== undefined && leftover !== null) return next === undefined ? { kind: "target", view: landed } : { kind: "choice", landed, leftover, next };
  return next === undefined ? { kind: "none" } : { kind: "target", view: next };
}

/**
 * What the gatherer reads in detail: the argument's entry when it names one, else the command's own default:
 * the one entry `/orc-discuss` would use, the one a bare `/orc-land` acts on, else the focus.
 */
function detailPicker(command: Command, config: Config, registry: Registry, argument: string | null): (views: EntryView[]) => RoadmapEntry | null {
  const ticketTargets = command === "orc-build";
  return (views) => {
    if (argument === null && command === "orc-discuss") {
      const eligible = discussable(views);
      return eligible.length === 1 ? (eligible[0] ?? null) : null;
    }
    if (argument === null && command === "orc-land") {
      const target = landTarget(views, config);
      return target.kind === "target" ? target.view.facts.entry : null;
    }
    if (argument === null) return focusOf(views)?.facts.entry ?? null;
    const match = resolveTarget(registry.entries, argument, ticketTargets ? ticketRefsOf(views) : null);
    return match.kind === "entry" ? match.entry : null;
  };
}

// ---------------------------------------------------------------------------
// Per-command verdicts
// ---------------------------------------------------------------------------

/** The stops every command but `orc-setup` judges before its registry: the repo's, then the config's. */
function commonStops(request: Request, nodeVersion: string): ConfigOutcome {
  const repoStop = repoStops(request, nodeVersion);
  return repoStop === null ? configStops(request.facts) : { ok: false, stop: repoStop };
}

function noTargetVerdict(request: Request): Verdict {
  return verdictOf(request, { outcome: stop("state", ["The roadmap has no entry left to act on."], run("/orc-discuss", "add the next roadmap entry")) });
}

/** Builds a verdict for a command, its target resolved and the common stops judged. */
export function buildVerdict(request: Request, nodeVersion: string): Verdict {
  if (request.command === "orc-setup") return setupVerdict(request, nodeVersion);
  const common = commonStops(request, nodeVersion);
  if (!common.ok) return verdictOf(request, { outcome: common.stop });
  const { config } = common;
  const registry = registryStops(request.facts);
  if (request.command === "orc") return orcVerdict(request, config, registry);
  if (registry.kind === "stop") return verdictOf(request, { outcome: registry.stop });
  if (registry.kind === "none") {
    if (request.command === "orc-discuss") return discussProjectVerdict(request, config);
    return verdictOf(request, { outcome: stop("no-registry", [`No registry yet: ${REGISTRY_PATH} does not exist.`], NO_REGISTRY_NEXT) });
  }
  const command = request.command;
  const judged = judge(request, config, registry.registry, detailPicker(command, config, registry.registry, request.argument));
  return commandVerdict({ ...request, command }, judged);
}

/** The commands judged against the roadmap: every one but `orc` and `orc-setup`, which judge on their own. */
type JudgedCommand = Exclude<Command, "orc" | "orc-setup">;

/** A step command's verdict from judged entries; `/orc-next` reuses them for the command it proposes. */
function commandVerdict(request: Request & { command: JudgedCommand }, judged: JudgedRoadmap): Verdict {
  const ghState = ghNeeded(request.command, judged.config, judged.target) ? ghStop(request.facts.checkGh()) : null;
  if (ghState !== null) return verdictOf(request, { outcome: ghState });
  if (request.command === "orc-next") return nextVerdict(request, judged);
  if (request.command === "orc-discuss") return discussVerdict(request, judged);

  const resolution = request.command === "orc-land" && request.argument === null ? resolveLanding(judged) : resolveFor(judged, request.argument, request.command === "orc-build");
  if (resolution.kind === "pick") return verdictOf(request, { outcome: resolution.pick });
  if (resolution.kind === "none") return noTargetVerdict(request);
  const { view, ticket } = resolution;
  const withTarget = (parts: Partial<Omit<Verdict, "outcome">> & { outcome: Verdict["outcome"] }): Verdict =>
    verdictOf(request, { banner: targetBanner(request, view), ...parts });
  const unknown = unknownStop(view);
  if (unknown !== null) return withTarget({ lines: unknown.message.slice(0, 2), outcome: unknown });
  switch (request.command) {
    case "orc-spec":
      return specVerdict(request, judged, view, withTarget);
    case "orc-tickets":
      return ticketsVerdict(request, judged, view, withTarget);
    case "orc-build":
      return buildVerdictFor(request, judged, view, ticket, withTarget);
    case "orc-land":
      return landVerdict(request, judged, view, withTarget);
  }
}

/** A target whose state is unknown because a lookup failed stops every step command. */
function unknownStop(view: EntryView): Stop | null {
  if (view.state !== "unknown") return null;
  const lines = [targetLine(view.facts.entry), `State:   unknown`];
  return stop("lookup-failed", [...lines, `A lookup failed: ${view.unknownReason ?? "see --json"}.`], nextForEntry(view), lookupError(view));
}

function lookupError(view: EntryView): string | undefined {
  const note = view.notes.find((n) => n.kind === "lookup-failed");
  return note?.kind === "lookup-failed" ? note.error : undefined;
}

/** The banner with Target: naming the resolved entry when no argument was given. */
function targetBanner(request: Request, view: EntryView): string[] {
  const target = request.argument === null ? `${view.facts.entry.name} (none given: the active spec)` : typedTarget(request.argument);
  return banner(request.command, target);
}

function orcVerdict(request: Request, config: Config, outcome: RegistryOutcome): Verdict {
  // With no registry, a broken one or ignored roadmap lines, /orc still reports: the next step is the way out.
  const registry = outcome.kind === "none" ? parseRegistry("## Roadmap\n") : outcome.registry;
  const held: { message: string[]; next: NextStep } | null =
    outcome.kind === "none" ? { message: [`No registry yet: ${REGISTRY_PATH} does not exist.`], next: NO_REGISTRY_NEXT } : outcome.kind === "stop" ? outcome.stop : null;
  const judged = judge(request, config, registry, detailPicker("orc", config, registry, request.argument));
  const resolution = resolveFor(judged, request.argument, false);
  if (resolution.kind === "pick") return verdictOf(request, { outcome: resolution.pick });
  const target = resolution.kind === "target" ? resolution.view : null;
  const needsGh = orcNeedsGh(config, judged.views, request.facts.origin);
  const gh = needsGh ? request.facts.checkGh() : request.facts.gh();
  const next = held?.next ?? (needsGh ? ghFix(gh) : null) ?? overallNext(judged.registry, judged.views, target);
  const status: Status = {
    ...judged.status,
    next: awayFrom("orc", next),
    repo: { ...judged.status.repo, gh },
    registry: outcome.kind === "none" ? null : judged.status.registry,
    target: target === null ? null : statusTarget(target, judged.registry, null),
  };
  const report = held !== null && outcome.kind !== "stop" ? [...held.message, pointer(status.next)] : [...(held?.message ?? []), ...orcReport({ ...judged, status }, target, null, needsGh)];
  const lines = target === null ? [] : [targetLine(target.facts.entry), `State:   ${stateLabel(target)}`];
  const bannerLines = target === null ? banner("orc", request.argument === null ? "none given: no entry left" : typedTarget(request.argument)) : targetBanner(request, target);
  return verdictOf(request, { banner: bannerLines, lines, outcome: { kind: "go", for: "orc", report, status } });
}

/** The command a proposed next step names, when it is one the roadmap judges. */
function proposedCommand(next: NextStep): JudgedCommand | null {
  const word = next.command.split(" ")[0];
  return COMMANDS.find((c): c is JudgedCommand => c !== "orc" && c !== "orc-setup" && c !== "orc-next" && `/${c}` === word) ?? null;
}

function nextVerdict(request: Request, judged: JudgedRoadmap): Verdict {
  const proposed = judged.status.next;
  const view = judged.target;
  const bannerLines = view === null ? banner("orc-next", "none given: no entry left") : targetBanner(request, view);
  const command = proposedCommand(proposed);
  if (proposed.kind === "manual" || command === null) {
    return verdictOf(request, { banner: bannerLines, outcome: stop("manual", [`The next step is manual: ${proposed.reason}.`], proposed) });
  }
  const argument = proposed.command.split(" ")[1] ?? null;
  const nested = commandVerdict({ ...request, command, argument, newEntry: false }, judged);
  return verdictOf(request, { banner: bannerLines, outcome: { kind: "go", for: "orc-next", proposed, verdict: nested } });
}

function setupVerdict(request: Request, nodeVersion: string): Verdict {
  const { facts } = request;
  const base = { banner: banner("orc-setup", "this repo") };
  const repoStop = repoStops(request, nodeVersion);
  if (repoStop !== null) return verdictOf(request, { ...base, outcome: repoStop });
  if (!facts.cwdIsRoot) {
    return verdictOf(request, { ...base, outcome: stop("not-root", ["This session did not start at the checkout root, where setup writes its files."], manual("/orc-setup", "in a session started at the checkout root")) });
  }
  const on = docsOn(facts);
  const unreadable = unreadableStop(CONFIG_PATH, facts.config, on) ?? unreadableStop(REGISTRY_PATH, facts.registryDoc, on) ?? unreadableStop(LOCK_PATH, facts.lockDoc, on);
  if (unreadable !== null) return verdictOf(request, { ...base, outcome: unreadable });
  const configText = textOf(facts.config);
  const registryText = textOf(facts.registryDoc);
  const check = configText === null ? null : parseConfig(configText);
  const values = check?.ok === true ? check.value : null;
  const registry = registryText === null ? null : parseRegistry(registryText);
  const lock = facts.lock();
  // Only upstream's skills are setup's to re-add or remove: orc's own and any other pack's are left alone.
  const vendored = [...lock].filter(([, entry]) => entry.source === UPSTREAM_SOURCE).map(([skill, entry]) => ({ skill, pin: entry.commit }));
  const first = configText === null;
  const config = values === null ? null : values.values;
  const complete = values === null ? null : completeConfig(values);
  // A first run has no config to name the setup role yet: once the template's skill is vendored, it is that one.
  const uses = complete !== null ? upstreamUses(facts, complete, ["setup"]) : first && lock.has(TEMPLATE_SETUP_SKILL) ? [upstreamUse(facts, "setup", vendoredPath(TEMPLATE_SETUP_SKILL))] : [];
  const go: Go = {
    kind: "go",
    for: "orc-setup",
    run: first ? "first" : "update",
    config,
    missingKeys: values === null ? (first ? [] : ["(the whole file)"]) : values.missingKeys,
    badKeys: values?.badKeys ?? [],
    trackerLocked: registry?.entries.some((e) => e.spec !== null) ?? false,
    remote: facts.remote,
    gh: facts.checkGh(),
    testCandidates: facts.testCandidates(),
    vendored,
  };
  const lines = [`Mode:    ${first ? "first run" : "update"}`, ...pinnedLine(uses)];
  return verdictOf(request, { ...base, lines, upstream: uses, reference: first ? [] : ["update"], outcome: go });
}

function discussProjectVerdict(request: Request, config: Config): Verdict {
  const { facts } = request;
  const offDefault = offDefaultStop(request);
  const projectBanner = banner("orc-discuss", "the project (no registry yet)");
  if (offDefault !== null) return verdictOf(request, { banner: projectBanner, outcome: offDefault });
  const repo = facts.repo(config);
  const uses = upstreamUses(facts, config, ["discuss", "domain"]);
  const go: Go = {
    kind: "go", for: "orc-discuss", mode: "project", entry: null, visit: null, next: run("/orc-discuss", "spec interview for the first roadmap entry"), tracker: config.tracker, push: config.push, landing: config.landing, pending: null, remote: repo.remote,
    uncommitted: uncommittedDocs(repo),
    problems: [],
  };
  return verdictOf(request, {
    banner: projectBanner,
    lines: ["Mode:    project interview", ...pinnedLine(uses)],
    upstream: uses,
    reference: ["project-interview", ...nullRole(uses)],
    outcome: go,
  });
}

/** The registry and domain files the working tree holds uncommitted: what a lock would commit with its own lines. */
function uncommittedDocs(repo: RepoFacts): { registry: boolean; domain: string[] } {
  const dirty = [...repo.dirty.orc, ...repo.dirty.other];
  return { registry: dirty.some((p) => isUnder(p, REGISTRY_PATH)), domain: dirty.filter(isDomainPath) };
}

function offDefaultStop(request: Request): Stop | null {
  const { facts } = request;
  if (facts.headBranch !== null && facts.headBranch === facts.defaultBranch) return null;
  const where = facts.headBranch === null ? "HEAD is detached" : "HEAD is on another branch";
  return stop("off-default", [`${where}, and this command commits on the default branch only.`], manual(invocation(request, request.argument), "after switching to the default branch"));
}

function discussVerdict(request: Request, judged: JudgedRoadmap): Verdict {
  const { facts } = request;
  const offDefault = offDefaultStop(request);
  if (offDefault !== null) return verdictOf(request, { outcome: offDefault });
  const eligible = discussable(judged.views);
  const uses = upstreamUses(facts, judged.config, ["discuss", "domain"]);
  const repo = judged.repo;
  const uncommitted = uncommittedDocs(repo);
  const problems = judged.registry.problems.map((p) => ({ line: p.line, kind: p.kind }));

  let entry: RoadmapEntry;
  if (request.argument === null) {
    const only = eligible[0];
    if (eligible.length !== 1 || only === undefined) {
      const pick = eligible.length === 0 ? pickOf("new-entry", [], false, true) : pickOf("choose", eligible);
      return verdictOf(request, { outcome: pick });
    }
    entry = only;
  } else {
    const taken = judged.registry.entries.some((e) => e.name === request.argument);
    if (request.newEntry && !taken) {
      if (!ENTRY_NAME.test(request.argument)) return verdictOf(request, { outcome: pickOf("new-entry", [], false, true) });
      return newEntryVerdict(request, judged, request.argument, { uses, uncommitted, problems });
    }
    const match = resolveTarget(judged.registry.entries, request.argument);
    if (match.kind !== "entry") {
      const isNewName = match.kind === "none" && ENTRY_NAME.test(request.argument);
      const pick = isNewName ? pickOf("new-entry", eligible, true, true) : pickOf(match.kind, match.candidates);
      return verdictOf(request, { outcome: pick });
    }
    entry = match.entry;
  }
  const view = judged.views.find((v) => v.facts.entry === entry);
  const unknown = view === undefined ? null : unknownStop(view);
  if (unknown !== null) return verdictOf(request, { lines: unknown.message.slice(0, 2), outcome: unknown });
  const pending = view?.pending ?? null;
  const pendingRef = pending !== null && "ref" in pending ? pending.ref : null;
  const onBranch = pending !== null && pending.count > 0 && pendingRef !== null && pendingRef !== repo.defaultBranch;
  const target = request.argument === null ? `${entry.name} (none given: the one entry to discuss)` : typedTarget(request.argument);
  const lines = [
    targetLine(entry),
    ...pinnedLine(uses),
    `Mode:    spec interview, ${entry.discussed ? "revisit" : "first visit"}`,
    ...(pending !== null && pending.count > 0 ? [`Pending: ${count(pending.count, "decision")} to lock${pendingRef === null ? " (the spec issue's comment)" : ` (on ${pendingRefText(pendingRef, entry.name)})`}`] : []),
  ];
  const parts = { banner: banner("orc-discuss", target), lines, upstream: uses };
  if (onBranch && pendingRef !== null) {
    const branch = pendingRef.replace(/^origin\//, "");
    if (repo.otherWorktreeBranches.includes(branch)) {
      return verdictOf(request, { ...parts, outcome: stop("branch-held", [...lines, `Another worktree holds ${branch}, where the pending record lives.`], manual(`/orc-discuss ${entry.name}`, `after freeing ${branch} from the other worktree`)) });
    }
    const beyondLock = [...repo.dirty.orc, ...repo.dirty.other].filter((p) => !isUnder(p, REGISTRY_PATH) && !isDomainPath(p));
    if (beyondLock.length > 0) {
      return verdictOf(request, { ...parts, outcome: stop("pending-blocked", [...lines, `${count(beyondLock.length, "path")} beyond the registry and domain files ${beyondLock.length === 1 ? "is" : "are"} uncommitted, and resolving the pending record switches to ${branch}.`], manual(`/orc-discuss ${entry.name}`, "after committing or stashing them")) });
    }
  }
  const go: Go = {
    kind: "go", for: "orc-discuss", mode: "spec", entry: entryRef(entry), visit: entry.discussed ? "revisit" : "first",
    next: view === undefined ? run("/orc-spec", "the entry's next step") : awayFrom("orc-discuss", nextForEntry(view)),
    tracker: judged.config.tracker, push: judged.config.push, landing: judged.config.landing, pending,
    remote: repo.remote, uncommitted, problems,
  };
  return verdictOf(request, { ...parts, reference: [...(onBranch ? ["pending-on-branch"] : []), ...nullRole(uses)], outcome: go });
}

/** A new entry the user chose to add: a first visit of an entry numbered after the roadmap's last, judged like one. */
function newEntryVerdict(
  request: Request,
  judged: JudgedRoadmap,
  name: string,
  judgedHere: { uses: UpstreamUse[]; uncommitted: { registry: boolean; domain: string[] }; problems: { line: number | null; kind: ProblemKind }[] },
): Verdict {
  const number = Math.max(0, ...judged.registry.entries.map((e) => e.number)) + 1;
  const entry: EntryRef = { number, name, spec: null, branch: `spec/${name}` };
  const lines = [`Target:  ${name} (new roadmap entry ${number})`, ...pinnedLine(judgedHere.uses), "Mode:    spec interview, new entry"];
  const go: Go = {
    kind: "go", for: "orc-discuss", mode: "spec", entry, visit: "new", next: interviewNext(name),
    tracker: judged.config.tracker, push: judged.config.push, landing: judged.config.landing, pending: null,
    remote: judged.repo.remote, uncommitted: judgedHere.uncommitted, problems: judgedHere.problems,
  };
  return verdictOf(request, { lines, upstream: judgedHere.uses, reference: nullRole(judgedHere.uses), outcome: go });
}

type WithTarget = (parts: Partial<Omit<Verdict, "outcome">> & { outcome: Verdict["outcome"] }) => Verdict;

function conflictStop(lines: string[], name: string, again: string): Stop {
  const message = `spec/${name} and the default branch conflict, so the merge of the default branch into it, which this step makes first, would stop.`;
  return stop("conflict", [...lines, message], manual(again, `after merging the default branch into spec/${name} by hand: they conflict`));
}

function stateStop(lines: string[], view: EntryView, what: string): Stop {
  return stop("state", [...lines, `${view.facts.entry.name} is ${stateLabel(view)}, ${what}.`], nextForEntry(view));
}

/** The registry diff the working tree holds, judged for `/orc-spec`: only the target's Spec: and Branch: lines is a resume. */
function registryChange(facts: Facts, entry: RoadmapEntry): "none" | "spec-lines" | "other" | "unreadable" {
  const committedRead = facts.committedRegistry();
  if (committedRead.kind === "unreadable") return "unreadable";
  const committed = textOf(committedRead);
  const working = textOf(facts.registryDoc);
  if (committed === null || working === null || normaliseLineEndings(committed) === normaliseLineEndings(working)) return "none";
  const committedEntry = parseRegistry(committed).entries.find((e) => e.name === entry.name);
  const block = entry.block.filter((line) => /^\s+- (Spec|Branch): /.test(line));
  const without = normaliseLineEndings(working).split("\n").filter((line) => !block.includes(line)).join("\n");
  return committedEntry !== undefined && committedEntry.spec === null && without === normaliseLineEndings(committed) ? "spec-lines" : "other";
}

/**
 * The pointer of a docs run that printed its `gh issue create` commands for the user, as `push: never` has it on
 * GitHub: filing them is the user's step, so it names `/orc`, which judges again once they are filed.
 */
function byHand(config: Config, after: string, then?: string): NextStep | null {
  if (config.tracker !== "github" || config.push !== "never") return null;
  return manual("/orc", then === undefined ? after : `${after}; ${then}`);
}

function specVerdict(request: Request, judged: Judged, view: EntryView, withTarget: WithTarget): Verdict {
  const { facts } = request;
  const entry = view.facts.entry;
  const uses = upstreamUses(facts, judged.config, ["spec"]);
  const lines = [targetLine(entry), ...pinnedLine(uses), `State:   ${stateLabel(view)}`];
  const parts = { lines, upstream: uses };
  const offDefault = offDefaultStop(request);
  if (offDefault !== null) return withTarget({ ...parts, outcome: { ...offDefault, message: [...lines, ...offDefault.message] } });
  const change = registryChange(facts, entry);
  const ids = specIds(judged.registry, entry);
  const go = (resume: "none" | "commit-record" | "found", foundSpecs: { ref: string; title: string; author: string }[]): Verdict =>
    withTarget({
      ...parts,
      ids,
      outcome: { kind: "go", for: "orc-spec", entry: entryRef(entry), next: awayFrom("orc-spec", nextForEntry(view)), tracker: judged.config.tracker, push: judged.config.push, resume,
        found: foundSpecs.map((f) => f.ref), foundDetail: foundSpecs, ids, projectDecisions: projectDecisions(judged.registry).length,
        triageLabels: facts.triageLabels(), byHand: byHand(judged.config, "after running the printed gh issue create command", `the next /orc-spec ${entry.name} records the issue`) },
    });
  if (change === "spec-lines") return go("commit-record", []);
  if (change === "unreadable") {
    const committed = facts.committedRegistry();
    const error = committed.kind === "unreadable" ? committed.error : undefined;
    return withTarget({ ...parts, outcome: stop("error", [...lines, `${REGISTRY_PATH} as HEAD holds it could not be read.`], manual("/orc", "after fixing what the error in --json names"), error) });
  }
  if (change === "other") {
    return withTarget({ ...parts, outcome: stop("registry-dirty", [...lines, `${REGISTRY_PATH} has uncommitted changes beyond this entry's Spec: and Branch: lines.`], manual(`/orc-spec ${entry.name}`, `after committing or reverting ${REGISTRY_PATH}`)) });
  }
  if (view.state !== "discussed") return withTarget({ ...parts, outcome: stateStop(lines, view, "and /orc-spec acts on a discussed entry with no spec") });
  const unresolved = unresolvedRoleStop(lines, "spec", uses);
  if (unresolved !== null) return withTarget({ ...parts, outcome: unresolved });
  const search = facts.foundSpecs(judged.config, entry);
  if (!search.ok) {
    return withTarget({ ...parts, outcome: stop("lookup-failed", [...lines, "The search for a spec an earlier run may have filed failed."], manual(`/orc-spec ${entry.name}`, "after fixing what the error in --json names"), search.error) });
  }
  return go(search.value.length === 0 ? "none" : "found", search.value);
}

function ticketsVerdict(request: Request, judged: Judged, view: EntryView, withTarget: WithTarget): Verdict {
  const { facts } = request;
  const entry = view.facts.entry;
  const uses = upstreamUses(facts, judged.config, ["tickets"]);
  const lines = [targetLine(entry), ...pinnedLine(uses), `State:   ${stateLabel(view)}`];
  const parts = { lines, upstream: uses };
  const offDefault = offDefaultStop(request);
  if (offDefault !== null) return withTarget({ ...parts, outcome: { ...offDefault, message: [...lines, ...offDefault.message] } });
  if (entry.spec === null) return withTarget({ ...parts, outcome: stateStop(lines, view, "and /orc-tickets needs a spec first") });
  const tracker = view.facts.tracker?.ok === true ? view.facts.tracker.value : null;
  const cited = tracker?.cited ?? [];
  const tickets = (tracker?.tickets ?? []).map((t) => ({ ref: t.ref, satisfies: t.satisfies ?? [], ...(t.title === null ? {} : { title: t.title }) }));
  const covered = new Set(tickets.flatMap((t) => t.satisfies));
  const uncovered = cited.filter((id) => !covered.has(id));
  const ignored = (tracker?.ignored ?? []).map((i) => ({ ref: i.ref, author: i.author }));
  const uncommittedFiles = judged.config.tracker === "local" && facts.localTicketFilesUncommitted(entry.name);
  const set = uncommittedFiles ? "uncommitted" : tickets.length === 0 ? (ignored.length > 0 ? "ignored-only" : "none") : uncovered.length > 0 ? "partial" : "complete";
  // A complete set only needs its pointer, and uncommitted tickets that cover every cited id only a commit.
  const drafts = set !== "complete" && !(set === "uncommitted" && uncovered.length === 0);
  const unresolved = drafts ? unresolvedRoleStop(lines, "tickets", uses) : null;
  if (unresolved !== null) return withTarget({ ...parts, ids: cited, outcome: unresolved });
  const go: Go = {
    kind: "go", for: "orc-tickets", entry: entryRef(entry), next: awayFrom("orc-tickets", nextForEntry(view)), tracker: judged.config.tracker, push: judged.config.push, cited, set, tickets, uncovered, ignored,
    triageLabels: facts.triageLabels(), byHand: byHand(judged.config, "after running the printed gh issue create commands in their order"),
  };
  return withTarget({ ...parts, ids: cited, outcome: go });
}

function buildVerdictFor(request: Request, judged: Judged, view: EntryView, ticket: string | null, withTarget: WithTarget): Verdict {
  const { facts } = request;
  const { config, repo } = judged;
  const entry = view.facts.entry;
  const role: Role = ticket !== null || config.build === "implement" ? "buildTicket" : "buildSpec";
  const uses = upstreamUses(facts, config, [role], ["tdd", "code-review"]);
  const built = view.tickets.filter((t) => t.progress === "built").map((t) => t.ref);
  const landed = view.tickets.filter((t) => t.progress === "landed").map((t) => t.ref);
  const scope = ticket === null ? view.tickets : view.tickets.filter((t) => t.ref === ticket);
  const toBuild = scope.filter((t) => t.progress !== "built" && t.progress !== "landed");
  const branchKind: "local" | "restore" | "create" = view.facts.branch.local ? "local" : view.facts.branch.remote ? "restore" : "create";
  const progress = view.tickets.length === 0
    ? "no tickets yet"
    : `${toBuild.length} of ${view.tickets.length} tickets to build (built: ${built.map(safeRef).join(" ") || "none"}; landed: ${landed.map(safeRef).join(" ") || "none"})`;
  const buildLine = `Build:   ${ticket === null ? config.build : `implement, ticket ${safeRef(ticket)}`}, ${progress}, research: ${config.research}`;
  const lines = [targetLine(entry), ...pinnedLine(uses), buildLine];
  const cited = view.facts.tracker?.ok === true ? (view.facts.tracker.value.cited ?? []) : [];
  const ids = [...new Set([...cited, ...scope.flatMap((t) => t.satisfies)])];
  const parts = { lines, upstream: uses, ids };
  if (!["ticketed", "building", "built", "in-review"].includes(view.state)) {
    return withTarget({ ...parts, outcome: stateStop(lines, view, "and /orc-build acts on a ticketed entry that has not landed") });
  }
  if (toBuild.some((t) => t.blockers === null)) {
    return withTarget({ ...parts, outcome: stop("lookup-failed", [...lines, "The blockers of the tickets to build were not read, so none can be called ready."], manual("/orc", "after fixing what the error in --json names")) });
  }
  if (ticket !== null) {
    const target = view.tickets.find((t) => t.ref === ticket);
    const unbuilt = (target?.blockers ?? []).filter((ref) => !view.tickets.some((t) => t.ref === ref && (t.progress === "built" || t.progress === "landed")));
    const blocker = unbuilt[0];
    if (target !== undefined && target.progress !== "built" && target.progress !== "landed" && blocker !== undefined) {
      return withTarget({ ...parts, outcome: stop("blocker", [...lines, `${safeRef(ticket)} waits on ${unbuilt.map(safeRef).join(", ")}, not built yet.`], run(`/orc-build ${safeRef(blocker)}`, `builds the blocker of ${safeRef(ticket)} first`)) });
    }
  }
  if (repo.otherWorktreeBranches.includes(`spec/${entry.name}`)) {
    return withTarget({ ...parts, outcome: stop("branch-held", [...lines, `Another worktree holds spec/${entry.name}, which the build switches to.`], manual(invocation(request, request.argument), "after freeing the branch from the other worktree")) });
  }
  if (repo.dirty.orc.length > 0) {
    return withTarget({ ...parts, outcome: stop("dirty-orc", [...lines, `Uncommitted changes under the orc paths (${orcPaths(config).join(" ")}), which a worktree would not see.`], manual(invocation(request, request.argument), "after committing them")) });
  }
  const phase = ticket !== null ? (toBuild.length === 0 ? "cleanup" : "build") : toBuild.length === 0 ? "review-ask" : "build";
  // Building and reviewing both start by merging the default branch in; the cleanup of a built ticket merges nothing.
  if (phase !== "cleanup" && branchKind !== "create" && view.facts.branch.conflictsDefault === true) {
    return withTarget({ ...parts, outcome: conflictStop(lines, entry.name, invocation(request, request.argument)) });
  }
  const agentBranches = judged.agentBranches.map((b) => ({ name: b.name, unmerged: b.unmerged }));
  const { unmarked } = onBranch(view, built);
  const go: Go = {
    kind: "go", for: "orc-build", entry: entryRef(entry), next: awayFrom("orc-build", nextForEntry(view)), ticket, phase, mode: ticket === null ? config.build : "implement",
    toBuild: toBuild.map((t) => ({ ref: t.ref, path: t.path, satisfies: t.satisfies, blockers: t.blockers ?? [] })),
    built, landed, branch: branchKind, mergeDefault: branchKind !== "create" && view.facts.branch.behindDefault > 0,
    agentBranches, dirtyOther: repo.dirty.other, reviewFixRounds: config.reviewFixRounds, research: config.research,
    test: config.test, buildStart: config.buildStart, defaultBranch: repo.defaultBranch, pending: view.pending,
    toMark: config.tracker === "local" ? built.filter((ref) => unmarked.includes(ref)) : null,
  };
  const reference = [
    ...(agentBranches.some((b) => b.unmerged > 0) ? ["agent-branches"] : []),
    ...(phase === "review-ask" ? ["review-only"] : []),
    ...(config.research === "always" ? ["notes"] : []),
    // Only building follows the build role: the review and the cleanup need no unresolved skill.
    ...(phase === "build" ? nullRole(uses) : []),
  ];
  return withTarget({ ...parts, reference, outcome: go });
}

/**
 * The target's files on its spec branch. With no branch there is nothing to commit on one; files that were not read
 * count as all still to commit, so "not read" can never pass for "done".
 */
function onBranch(view: EntryView, built: readonly string[]): BranchStatus {
  if (view.facts.onBranch?.ok === true) return view.facts.onBranch.value;
  if (view.facts.branch.rangeRef === null) return { open: [], unmarked: [] };
  return { open: view.unresolved, unmarked: [...built] };
}

function orcPaths(config: Config): string[] {
  return config.tracker === "local" ? [...ORC_PATHS, ".scratch"] : ORC_PATHS;
}

function landVerdict(request: Request, judged: Judged, view: EntryView, withTarget: WithTarget): Verdict {
  const { config, repo } = judged;
  const entry = view.facts.entry;
  const name = entry.name;
  const prMode = view.landing.mode !== "local-merge";
  const uses = prMode ? upstreamUses(request.facts, config, ["land"]) : [];
  const branch = view.facts.branch;
  const lines = [
    targetLine(entry),
    ...pinnedLine(uses),
    `Mode:    ${view.landing.mode} (${view.landing.source === "entry" ? "the entry's Landing: line" : "the config default"})`,
    `State:   ${stateLabel(view)}`,
  ];
  const parts = { lines, upstream: uses };
  const again = invocation(request, request.argument);
  if (repo.linkedWorktree) {
    return withTarget({ ...parts, outcome: stop("linked-worktree", [...lines, "This is a linked worktree, and landing switches to the default branch."], manual(again, "from the main checkout")) });
  }
  const held = [`spec/${name}`, repo.defaultBranch].filter((b) => repo.otherWorktreeBranches.includes(b));
  if (held.length > 0) {
    const names = held.map((b) => (b === repo.defaultBranch ? "the default branch" : b));
    return withTarget({ ...parts, outcome: stop("branch-held", [...lines, `Another worktree holds ${names.join(" and ")}.`], manual(again, "after freeing the branch from the other worktree")) });
  }
  if (!["built", "in-review", "cleanup-pending", "landed"].includes(view.state)) {
    const unbuilt = view.tickets.filter((t) => t.progress !== "built" && t.progress !== "landed").map((t) => safeRef(t.ref));
    const what = unbuilt.length === 0 ? "and only a built entry lands" : `and only a built entry lands; not built: ${unbuilt.join(" ")}`;
    return withTarget({ ...parts, outcome: stateStop(lines, view, what) });
  }
  if (repo.dirty.orc.length + repo.dirty.other.length > 0) {
    return withTarget({ ...parts, outcome: stop("dirty", [...lines, "The working tree has uncommitted changes, and landing switches branches."], manual(again, "after committing or stashing them")) });
  }
  const phase = view.state === "cleanup-pending" || view.state === "landed" ? "cleanup" : "land";
  if (phase === "land" && prMode) {
    const why = repo.remote !== "github" ? "origin is not a github.com remote" : config.push === "never" ? "push is never" : judged.mergeCommitAllowed === false ? "the repo forbids merge commits" : null;
    if (why !== null) {
      const next = judged.mergeCommitAllowed === false || repo.remote !== "github" ? manual(`/orc-discuss ${name}`, "choose local-merge, or change what stops the PR mode") : manual(again, `after setting push to ask or always in ${CONFIG_PATH}`);
      return withTarget({ ...parts, outcome: stop("pr-blocked", [...lines, `${view.landing.mode} cannot land here: ${why}.`], next) });
    }
  }
  if (phase === "land" && branch.ahead !== null && branch.behind !== null && branch.ahead > 0 && branch.behind > 0) {
    return withTarget({ ...parts, outcome: stop("spec-diverged", [...lines, `spec/${name} and origin/spec/${name} have diverged: ${branch.ahead} ahead, ${branch.behind} behind.`], manual(again, `after reconciling spec/${name} with origin/spec/${name} by hand`)) });
  }
  if (phase === "land" && repo.defaultConflicts === true) {
    const message = "The default branch and origin's have diverged and conflict, so the merge of origin's into it, which the landing makes first, would stop.";
    return withTarget({ ...parts, outcome: stop("conflict", [...lines, message], manual(again, "after merging origin's default branch into the default branch by hand: they conflict")) });
  }
  if (phase === "land" && branch.conflictsDefault === true) return withTarget({ ...parts, outcome: conflictStop(lines, name, again) });
  const prs = view.facts.prs?.ok === true ? view.facts.prs.value : [];
  // The PR the landing concerns: the open one, else the one that merged, else the latest that was closed.
  const pr = view.openPr ?? prs.findLast((p) => p.state === "MERGED") ?? prs.at(-1) ?? null;
  const nothingNew = !branch.local || branch.ahead === 0;
  if (phase === "land" && view.landing.mode === "pr-human" && view.openPr !== null && nothingNew) {
    return withTarget({ ...parts, outcome: stop("waiting", [...lines, `PR #${view.openPr.number} is open and spec/${name} holds nothing new to push.`], nextForEntry(view)) });
  }
  const go: Go = {
    kind: "go", for: "orc-land", entry: entryRef(entry), next: awayFrom("orc-land", nextForEntry(view)), mode: view.landing.mode, modeSource: view.landing.source, push: config.push, phase,
    tickets: view.tickets.map((t) => t.ref), unresolved: view.unresolved,
    toResolve: config.tracker === "local" && phase === "land" ? onBranch(view, []).open : null,
    branch: { local: branch.local, remote: branch.remote, ahead: branch.ahead, behind: branch.behind, behindDefault: branch.behindDefault },
    defaultBranch: { name: repo.defaultBranch, ahead: repo.ahead, behind: repo.behind },
    pr: pr === null ? null : { number: pr.number, state: pr.state, draft: pr.draft }, pending: view.pending?.count ?? 0, test: config.test, remote: repo.remote,
  };
  const diverged = repo.ahead !== null && repo.behind !== null && repo.ahead > 0 && repo.behind > 0;
  // The land role writes the PR body, which only the landing needs: the cleanup goes on without it.
  const reference = [...(prMode && phase === "land" ? ["pr-modes", ...nullRole(uses)] : []), ...(diverged ? ["diverged"] : [])];
  return withTarget({ ...parts, reference, outcome: go });
}

// ===========================================================================
// The registry lookup (spec 9.3)
// ===========================================================================

export interface LookupResult {
  schema: 1;
  keys: { key: string; lines: string[] | null; supersededBy: string | null }[];
  /** With `--project`: every live `-> project` decision's line. */
  project?: string[];
}

export function lookupKeys(registry: Registry, keys: readonly string[], project = false): LookupResult {
  const superseded = supersededBy(registry);
  const result: LookupResult = {
    schema: SCHEMA,
    keys: keys.map((key) => {
      const id = registry.ids.find((line) => line.id === key);
      if (id !== undefined) return { key, lines: [id.text], supersededBy: superseded.get(key) ?? null };
      const entry = registry.entries.find((e) => e.name === key);
      return { key, lines: entry === undefined ? null : entry.block, supersededBy: null };
    }),
  };
  if (!project) return result;
  const live = new Set(projectDecisions(registry));
  return { ...result, project: registry.ids.filter((line) => live.has(line.id)).map((line) => line.text) };
}

export function renderLookup(result: LookupResult): string[] {
  const keys = result.keys.flatMap(({ key, lines, supersededBy: by }) => {
    if (lines === null) return [`${key}: not in the registry`];
    return by === null ? lines : lines.map((line) => `${line} (superseded by ${by})`);
  });
  return [...keys, ...(result.project ?? [])];
}

// ===========================================================================
// The locked-lines check (spec 8)
// ===========================================================================

const FIELD_OF = /^\s+- (Seams|Landing): /;

/** A registry line with what owns it: its section, and inside the roadmap the entry it sits under. */
interface OwnedLine {
  number: number;
  text: string;
  owner: string;
}

/** Every non-blank line with its owner. Headings, entry lines and comments are classified as parseRegistry reads them. */
function ownedLines(text: string): OwnedLine[] {
  const raw = normaliseLineEndings(text).split("\n");
  const blanked = blankComments(raw.join("\n")).split("\n");
  const headings = new Map<string, number>();
  let section = "preamble";
  let inRoadmap = false;
  let owner = section;
  const owned: OwnedLine[] = [];
  for (const [index, line] of raw.entries()) {
    if (line.trim() === "") continue;
    const parsed = blanked[index] ?? "";
    const heading = /^#{1,6} (.+)$/.exec(parsed);
    if (heading !== null) {
      // A repeated heading is a section of its own, so each copy keeps its own lines.
      const seen = (headings.get(parsed) ?? 0) + 1;
      headings.set(parsed, seen);
      section = `section ${seen} ${parsed}`;
      inRoadmap = parsed.startsWith("## ") && sectionOf(heading[1] ?? "") === "roadmap";
      owner = section;
    } else if (inRoadmap) {
      const entry = ENTRY_LINE.exec(parsed);
      if (entry !== null) owner = `${section} entry ${(entry[2] ?? "").trim()}`;
    }
    owned.push({ number: index + 1, text: line, owner });
  }
  return owned;
}

/** The indexes of `old` that a longest common subsequence with `now` leaves out: the fewest lines that changed or went. */
function unmatched<T>(old: readonly T[], now: readonly T[]): number[] {
  const lengths = Array.from({ length: old.length + 1 }, () => new Array<number>(now.length + 1).fill(0));
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      const row = lengths[i] ?? [];
      row[j] = old[i] === now[j] ? (lengths[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lengths[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const left: number[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length) {
    if (j < now.length && old[i] === now[j]) {
      i++;
      j++;
    } else if (j < now.length && (lengths[i]?.[j + 1] ?? 0) >= (lengths[i + 1]?.[j] ?? 0)) {
      j++;
    } else {
      left.push(i);
      i++;
    }
  }
  return left;
}

function byOwner(lines: readonly OwnedLine[]): Map<string, OwnedLine[]> {
  const owners = new Map<string, OwnedLine[]>();
  for (const line of lines) owners.set(line.owner, [...(owners.get(line.owner) ?? []), line]);
  return owners;
}

/**
 * The line numbers of the registry at a commit that the working tree no longer holds as it did, in order: every
 * line then is locked, and lines may only be added. Each locked line is held to its owner, its section or the
 * roadmap entry it sits under, so a line moved elsewhere, or edited while a copy of its old text is appended
 * under another entry, is a change; and the owners keep their order. With an entry, its Seams: and Landing: lines
 * may change or go (a revisit).
 */
export function lockedChanges(before: string, after: string, entry: string | null): number[] {
  const target = entry === null ? null : parseRegistry(before).entries.find((e) => e.name === entry);
  const isExempt = (line: OwnedLine): boolean => target !== null && target !== undefined && line.owner.endsWith(` entry ${target.name}`) && FIELD_OF.test(line.text);
  const old = byOwner(ownedLines(before).filter((line) => !isExempt(line)));
  const now = byOwner(ownedLines(after));
  const changed = new Set<number>();
  for (const [owner, lines] of old) {
    const texts = (now.get(owner) ?? []).map((line) => line.text);
    for (const index of unmatched(lines.map((line) => line.text), texts)) changed.add(lines[index]?.number ?? 0);
  }
  // Owners out of their order: the first line of each one a longest common order leaves out.
  const kept = [...now.keys()].filter((owner) => old.has(owner));
  const order = [...old.keys()].filter((owner) => now.has(owner));
  for (const index of unmatched(order, kept)) changed.add(old.get(order[index] ?? "")?.[0]?.number ?? 0);
  return [...changed].sort((a, b) => a - b);
}

// ===========================================================================
// The text form (spec 9.5): safe values only
// ===========================================================================

const yesNo = (value: boolean): string => (value ? "yes" : "no");
const list = (values: readonly string[], each: (value: string) => string): string => (values.length === 0 ? "none" : values.map(each).join(" "));
const orNone = (value: number | null): string => (value === null ? "none" : String(value));

function block(key: string, lines: readonly string[], indent = ""): string[] {
  return lines.length === 0 ? [`${indent}${key}: none`] : [`${indent}${key}:`, ...lines.map((line) => `${indent}  ${line}`)];
}

function nextText(next: NextStep, indent: string): string[] {
  return [`${indent}Kind: ${next.kind}`, `${indent}Pointer: ${pointer(next)}`];
}

function entryText(entry: EntryRef): string {
  return `number=${entry.number} name=${safeEntry(entry.name)} spec=${safeSpec(entry.spec, entry.name)} branch=spec/${safeEntry(entry.name)}`;
}

/** The ref a local pending record is on: the spec branch by its name, the default branch by that word, never its name. */
function pendingRefText(ref: string, name: string): string {
  return ref === `spec/${name}` || ref === `origin/spec/${name}` ? ref : "default-branch";
}

function pendingText(pending: PendingFact | null, name: string): string {
  if (pending === null) return "none";
  return "ref" in pending ? `count=${pending.count} ref=${pendingRefText(pending.ref, name)} path=.scratch/${safeEntry(name)}/pending-decisions.md` : `count=${pending.count} comment=${pending.commentId}`;
}

/** The test command is the config's own text, so the text form says only whether one is set; --json holds it. */
function testText(test: string | null): string {
  return test === null ? "none" : "set";
}

function goText(go: Go, indent: string): string[] {
  const fields = goFields(go, indent);
  return "next" in go ? [...fields, `${indent}Pointer: ${pointer(go.next)}`] : fields;
}

/** `never` says what it stops, since it is easily read as no GitHub writes at all (spec 3.2). */
function pushText(push: Push): string {
  return push === "never" ? "never (no push, PR or new issue; tracker bookkeeping still runs)" : push;
}

function goFields(go: Go, indent: string): string[] {
  const i = indent;
  const kv = (key: string, value: string): string => `${i}${key}: ${value}`;
  switch (go.for) {
    case "orc":
      return block("Report", go.report, i);
    case "orc-next":
      return [kv("Proposed", `${go.proposed.kind} ${pointer(go.proposed).replace(/^Done\. Next: /, "")}`), `${i}Verdict:`, ...renderVerdictLines(go.verdict, `${i}  `)];
    case "orc-setup":
      return [
        kv("Run", go.run),
        kv("Config", go.config === null ? "none" : "present"),
        kv("MissingKeys", list(go.missingKeys, (k) => safe(k, (v) => /^[A-Za-z.()\s]+$/.test(v)))),
        kv("BadKeys", list(go.badKeys, (k) => safe(k, (v) => /^[A-Za-z.]+$/.test(v)))),
        kv("TrackerLocked", yesNo(go.trackerLocked)),
        kv("Remote", go.remote),
        kv("Gh", go.gh),
        kv("TestCandidates", String(go.testCandidates.length)),
        ...block("Vendored", go.vendored.map((v) => `skill=${safeSkill(v.skill)} pin=${safeSha(v.pin)}`), i),
      ];
    case "orc-discuss":
      return [
        kv("Mode", go.mode),
        kv("Entry", go.entry === null ? "none" : entryText(go.entry)),
        kv("Visit", go.visit ?? "none"),
        kv("Tracker", go.tracker),
        kv("Push", pushText(go.push)),
        kv("Landing", go.landing),
        kv("Pending", go.entry === null ? "none" : pendingText(go.pending, go.entry.name)),
        kv("Remote", go.remote),
        kv("UncommittedRegistry", yesNo(go.uncommitted.registry)),
        kv("UncommittedDomain", String(go.uncommitted.domain.length)),
        kv("Problems", go.problems.length === 0 ? "none" : go.problems.map(problemText).join(", ")),
      ];
    case "orc-spec":
      return [
        kv("Entry", entryText(go.entry)),
        kv("Tracker", go.tracker),
        kv("Push", pushText(go.push)),
        kv("Resume", go.resume),
        kv("Found", list(go.found, (v) => (ISSUE_REF.test(v) ? v : safeSpec(v, go.entry.name)))),
        kv("Ids", list(go.ids, safeId)),
        kv("ProjectDecisions", `${go.projectDecisions} (registry --project)`),
        kv("TriageLabels", yesNo(go.triageLabels)),
        ...(go.byHand === null ? [] : [kv("ByHand", pointer(go.byHand))]),
      ];
    case "orc-tickets":
      return [
        kv("Entry", entryText(go.entry)),
        kv("Tracker", go.tracker),
        kv("Push", pushText(go.push)),
        kv("Cited", list(go.cited, safeId)),
        kv("Set", go.set),
        ...block("Tickets", go.tickets.map((t) => `ref=${safeRef(t.ref)} satisfies=${t.satisfies.length === 0 ? "none" : t.satisfies.map(safeId).join(",")}`), i),
        kv("Uncovered", list(go.uncovered, safeId)),
        kv("Ignored", list(go.ignored.map((x) => x.ref), safeRef)),
        kv("TriageLabels", yesNo(go.triageLabels)),
        ...(go.byHand === null ? [] : [kv("ByHand", pointer(go.byHand))]),
      ];
    case "orc-build":
      return [
        kv("Entry", entryText(go.entry)),
        kv("Ticket", go.ticket === null ? "none" : safeRef(go.ticket)),
        kv("Phase", go.phase),
        kv("Mode", go.mode),
        ...block("ToBuild", go.toBuild.map((t) => `ref=${safeRef(t.ref)} satisfies=${t.satisfies.length === 0 ? "none" : t.satisfies.map(safeId).join(",")} blockers=${t.blockers.length === 0 ? "none" : t.blockers.map(safeRef).join(",")}`), i),
        kv("Built", list(go.built, safeRef)),
        kv("Landed", list(go.landed, safeRef)),
        kv("Branch", go.branch),
        kv("MergeDefault", yesNo(go.mergeDefault)),
        ...(go.agentBranches.length === 0 ? [kv("AgentBranches", "0")] : block("AgentBranches", go.agentBranches.map((b) => `unmerged=${b.unmerged}`), i)),
        kv("DirtyOther", String(go.dirtyOther.length)),
        kv("ReviewFixRounds", String(go.reviewFixRounds)),
        kv("Research", go.research),
        kv("Test", testText(go.test)),
        kv("BuildStart", go.buildStart),
        kv("DefaultBranch", safe(go.defaultBranch, isSafeName)),
        kv("Pending", pendingText(go.pending, go.entry.name)),
        ...(go.toMark === null ? [] : [kv("ToMark", list(go.toMark, safeRef))]),
      ];
    case "orc-land":
      return [
        kv("Entry", entryText(go.entry)),
        kv("Mode", `${go.mode} source=${go.modeSource}`),
        kv("Push", pushText(go.push)),
        kv("Phase", go.phase),
        kv("Tickets", list(go.tickets, safeRef)),
        kv("Unresolved", list(go.unresolved, (v) => (isTicketRef(v) ? v : safeSpec(v, go.entry.name)))),
        ...(go.toResolve === null ? [] : [kv("ToResolve", list(go.toResolve, (v) => (isTicketRef(v) ? v : safeSpec(v, go.entry.name))))]),
        kv("Branch", `local=${yesNo(go.branch.local)} remote=${yesNo(go.branch.remote)} ahead=${orNone(go.branch.ahead)} behind=${orNone(go.branch.behind)} behindDefault=${go.branch.behindDefault}`),
        kv("DefaultBranch", `name=${safe(go.defaultBranch.name, isSafeName)} ahead=${orNone(go.defaultBranch.ahead)} behind=${orNone(go.defaultBranch.behind)}`),
        kv("Pr", go.pr === null ? "none" : `number=${go.pr.number} state=${go.pr.state} draft=${yesNo(go.pr.draft)}`),
        kv("Pending", String(go.pending)),
        kv("Test", testText(go.test)),
        kv("Remote", go.remote),
      ];
  }
}

/** A landed entry's leftovers: its spec branches by the names orc builds, its open tracker items by reference. */
function leftoverText(leftover: Leftover, name: string): string {
  const branches = leftover.branches.filter((ref) => ref === `spec/${name}` || ref === `origin/spec/${name}`);
  const unresolved = leftover.unresolved.map((ref) => (isTicketRef(ref) ? ref : safeSpec(ref, name)));
  return `branches=${branches.join(",") || "none"} unresolved=${unresolved.join(",") || "none"}`;
}

function upstreamText(use: UpstreamUse): string {
  return `role=${use.role ?? "none"} skill=${use.skill === null ? "none" : safeSkill(use.skill)} path=${use.path === null ? "none" : safeSkillPath(use.path)} pin=${use.pin ?? "none"} invoke=${use.invoke ?? "none"}`;
}

/** How the banner is printed, carried on its own label so every run reads it where it reads the banner (spec 3.1). */
const BANNER_RULE = "print first, before any tool call, as plain text without this indent, never in a code block";

export function renderVerdictLines(verdict: Verdict, indent = ""): string[] {
  const i = indent;
  const lines = [
    `${i}orc verdict ${verdict.schema} ${verdict.command ?? "none"} ${verdict.outcome.kind}`,
    `${i}Stamp: ${verdict.stamp.head ?? "none"} ${verdict.stamp.at}`,
    `${i}Origin: ${yesNo(verdict.origin)}`,
    ...(verdict.banner.length === 0 ? [`${i}Banner: none`] : [`${i}Banner: ${BANNER_RULE}`, ...verdict.banner.map((line) => `${i}  ${line}`)]),
    ...block("Lines", verdict.lines, i),
    ...(verdict.lines.length === 0 ? [] : [`${i}LinesOpen: every picker question, stop message and the final report`]),
    `${i}Ids: ${list(verdict.ids, safeId)}`,
    ...(verdict.upstream.length === 0 ? [`${i}Upstream: none`] : block("Upstream", verdict.upstream.map(upstreamText), i)),
    `${i}Reference: ${verdict.reference.length === 0 ? "none" : verdict.reference.join(" ")}`,
  ];
  const outcome = verdict.outcome;
  const inner = `${i}  `;
  switch (outcome.kind) {
    case "stop":
      return [...lines, `${i}Stop:`, `${inner}Reason: ${outcome.reason}`, ...block("Message", outcome.message, inner), ...nextText(outcome.next, inner)];
    case "pick":
      return [
        ...lines,
        `${i}Pick:`,
        `${inner}Why: ${outcome.why}`,
        ...block("Candidates", outcome.candidates.map((c) => `number=${c.number} name=${safeEntry(c.name)} spec=${safeSpec(c.spec, c.name)}`), inner),
        `${inner}Other: ${yesNo(outcome.other)}`,
        `${inner}OfferAdd: ${yesNo(outcome.offerAdd)}`,
        ...(outcome.leftover === undefined ? [] : [`${inner}Leftover: ${leftoverText(outcome.leftover, outcome.candidates[0]?.name ?? "")}`]),
      ];
    case "go":
      return [...lines, `${i}Go:`, ...goText(outcome, inner)];
  }
}

// ===========================================================================
// I/O: running git and gh, reading files, gathering the facts
// ===========================================================================

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `git` or `gh` in `cwd`. A program that is not installed reports status 127, as a shell would, and one that
 * does not answer within its timeout is killed and reports `TIMED_OUT`, as `timeout(1)` would.
 */
export type Runner = (program: "git" | "gh", args: readonly string[], cwd: string) => CommandResult;

export const TIMED_OUT = 124;

/**
 * How long each program may run, in milliseconds. A hung call must never reach the Bash tool's two-minute limit,
 * which would abort the skill: one git timeout ends the run, and after one gh timeout no other gh call is made.
 */
export const TIMEOUTS: Readonly<Record<"git" | "gh", number>> = { git: 45_000, gh: 20_000 };

/**
 * The variables that select a repository, its index or its config for git, as `git rev-parse --local-env-vars`
 * lists them. A child never inherits them, so the working directory alone decides which repository `git`, and `gh`
 * through its own git calls, reads: `GIT_DIR` set in the session would otherwise pass the repository check against a
 * foreign repository and point every later read there.
 */
const GIT_REPOSITORY_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
] as const;

/** The script's own environment without the variables that would choose a repository for its children. */
function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  for (const name of GIT_REPOSITORY_ENV) delete env[name];
  return env;
}

export function systemRunnerWith(timeouts: Readonly<Record<"git" | "gh", number>>): Runner {
  return (program, args, cwd) => {
    const timeout = timeouts[program];
    const result = spawnSync(program, args, { cwd, env: childEnvironment(process.env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout, killSignal: "SIGKILL" });
    if (result.error !== undefined) {
      const code = "code" in result.error ? result.error.code : undefined;
      if (code === "ENOENT") return { status: 127, stdout: "", stderr: `${program}: command not found` };
      if (code === "ETIMEDOUT") return { status: TIMED_OUT, stdout: "", stderr: `${program} did not answer within ${timeout / 1000} s` };
      return { status: 1, stdout: "", stderr: result.error.message };
    }
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
}

export const systemRunner: Runner = systemRunnerWith(TIMEOUTS);

/**
 * Every git call the script makes: in `root`, and with `--no-optional-locks`, since `git status` would otherwise
 * refresh and rewrite the index, holding `index.lock` while a command the session runs may need it. No fsmonitor
 * command starts, since `status` needs none to be right. A bare repository found from the directory is refused: a
 * checkout can hold one as plain files, and git would run the commands its config names, while orc's own repository
 * always has a working tree.
 */
function gitArgs(root: string, args: readonly string[]): string[] {
  return ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "safe.bareRepository=explicit", "-C", root, ...args];
}

/** A path git printed as one line: only the line end goes, so a path that itself ends in a newline stays whole. */
function printedPath(stdout: string): string {
  return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
}

type Checkout = { kind: "checkout"; root: string } | { kind: "not-a-repo" } | { kind: "other-repo" } | { kind: "error"; message: string; detail: string };

/**
 * The checkout the working directory is in, judged before any other git call there. It is read only when it shares
 * its repository with the checkout this script lives in, a linked worktree of it included: git runs the commands a
 * repository's own config names (a merge driver in `merge-tree`, a clean filter in `status`), and only orc's own
 * checkout is trusted with that.
 */
function findCheckout(env: Environment): Checkout {
  const top = env.run("git", gitArgs(env.cwd, ["rev-parse", "--show-toplevel"]), env.cwd);
  if (top.status === 127) return { kind: "error", message: "git is not installed, and orc needs it.", detail: top.stderr };
  if (top.status === TIMED_OUT) return { kind: "error", message: "git did not answer in time.", detail: top.stderr };
  if (top.status !== 0) return { kind: "not-a-repo" };
  const root = printedPath(top.stdout);
  const commonDir = (dir: string): CommandResult => env.run("git", gitArgs(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), dir);
  const here = commonDir(root);
  if (here.status !== 0) return { kind: "error", message: "git could not name this checkout's repository.", detail: here.stderr };
  const own = commonDir(env.scriptDir);
  if (own.status !== 0 || !sameDirectory(printedPath(own.stdout), printedPath(here.stdout))) return { kind: "other-repo" };
  return { kind: "checkout", root };
}

/**
 * Whether two paths name one directory, by device and inode: a path compared as text differs in letter case on a
 * filesystem that folds it, and through a symlink. A path that cannot be read names nothing the other one does.
 */
function sameDirectory(a: string, b: string): boolean {
  try {
    const [first, second] = [statSync(a, { bigint: true }), statSync(b, { bigint: true })];
    return first.isDirectory() && first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
}

const OTHER_REPO = "this directory is in another repository than the one orc is installed in";

/** A git failure the facts cannot explain: it becomes a stop of kind `error`. */
export class GitError extends Error {
  constructor(args: readonly string[], result: CommandResult) {
    super(`git ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
    this.name = "GitError";
  }
}

/**
 * A file read by path: its text, absent, or there and unreadable. Only a path that does not exist is absent: a
 * file that cannot be read, or one that is a directory or anything but a regular file, is unreadable, so a run
 * never takes it for missing and writes over it.
 */
export type DocRead = { kind: "text"; text: string } | { kind: "absent" } | { kind: "unreadable"; error: string };

const ABSENT: DocRead = { kind: "absent" };

function textOf(read: DocRead): string | null {
  return read.kind === "text" ? read.text : null;
}

/** Reads the committed docs by path from the repo root: from the working tree, or from a ref. */
interface DocsReader {
  read(path: string): DocRead;
  /** The file names in a directory, sorted; empty when it does not exist, failed when it cannot be listed. */
  list(dir: string): Lookup<string[]>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workingTreeReader(root: string): DocsReader {
  return {
    read: (path) => {
      const full = join(root, path);
      try {
        // A FIFO or a device would block or stream forever, so only a regular file is opened.
        if (!statSync(full).isFile()) return { kind: "unreadable", error: `${path} is not a regular file` };
        return { kind: "text", text: readFileSync(full, "utf8") };
      } catch (error) {
        return errorCode(error) === "ENOENT" ? ABSENT : { kind: "unreadable", error: errorText(error) };
      }
    },
    list: (dir) => {
      try {
        return found(readdirSync(join(root, dir)).sort());
      } catch (error) {
        return errorCode(error) === "ENOENT" ? found([]) : failed(`${dir} could not be listed: ${errorText(error)}`);
      }
    },
  };
}

/** One `git ls-tree -z` entry: mode, type and object id, then the path after a tab. */
function treeEntry(output: string): { mode: string; type: string; oid: string } | null {
  const [meta = ""] = output.split("	");
  const [mode, type, oid] = meta.split(" ");
  return mode === undefined || type === undefined || oid === undefined ? null : { mode, type, oid };
}

/** An entry's local spec and ticket files as a reader holds them: the docs, or a branch. */
function localFiles(entry: RoadmapEntry, docs: DocsReader): Lookup<{ specText: string | null; tickets: { fact: TicketFact; text: string }[] }> {
  if (entry.spec !== null && !isRepoPath(entry.spec)) return failed(`Spec: of ${entry.name} is not a path inside the repo`);
  const dir = `.scratch/${entry.name}/issues`;
  const files = docs.list(dir);
  if (!files.ok) return files;
  const tickets: { fact: TicketFact; text: string }[] = [];
  for (const fileName of files.value) {
    if (!LOCAL_TICKET_FILE.test(fileName)) continue;
    const read = docs.read(`${dir}/${fileName}`);
    if (read.kind === "unreadable") return failed(read.error);
    const fact = read.kind === "text" ? parseLocalTicket(entry.name, dir, fileName, read.text) : null;
    if (fact !== null && read.kind === "text") tickets.push({ fact, text: read.text });
  }
  const spec = entry.spec === null ? ABSENT : docs.read(entry.spec);
  if (spec.kind === "unreadable") return failed(spec.error);
  return found({ specText: textOf(spec), tickets });
}

/** Reads from a ref by asking git for the entry first, so absent and unreadable never depend on git's wording. */
function refReader(git: (args: readonly string[]) => CommandResult, ref: string): DocsReader {
  const entry = (path: string): Lookup<{ mode: string; type: string; oid: string } | null> => {
    const result = git(["ls-tree", "-z", ref, "--", path]);
    if (result.status !== 0) return failed(`git ls-tree ${ref} failed: ${firstLine(result.stderr) || `exit ${result.status}`}`);
    return found(result.stdout === "" ? null : treeEntry(result.stdout));
  };
  return {
    read: (path) => {
      const found = entry(path);
      if (!found.ok) return { kind: "unreadable", error: found.error };
      if (found.value === null) return ABSENT;
      if (found.value.type !== "blob" || !/^1006[0-7]{2}$/.test(found.value.mode)) return { kind: "unreadable", error: `${path} on ${ref} is not a regular file` };
      const result = git(["cat-file", "blob", found.value.oid]);
      return result.status === 0 ? { kind: "text", text: result.stdout } : { kind: "unreadable", error: `${path} on ${ref} could not be read: ${firstLine(result.stderr) || `exit ${result.status}`}` };
    },
    list: (dir) => {
      const found = entry(dir);
      if (!found.ok) return found;
      if (found.value === null) return { ok: true, value: [] };
      if (found.value.type !== "tree") return failed(`${dir} on ${ref} is not a folder`);
      // -z keeps names verbatim: without it git quotes and escapes any name that is not plain ASCII.
      const result = git(["ls-tree", "-z", "--name-only", found.value.oid]);
      if (result.status !== 0) return failed(`${dir} on ${ref} could not be listed: ${firstLine(result.stderr) || `exit ${result.status}`}`);
      return { ok: true, value: result.stdout.split("\0").filter((n) => n !== "").sort() };
    },
  };
}

function memo<T>(compute: () => T): () => T {
  let value: { v: T } | null = null;
  return () => {
    if (value === null) value = { v: compute() };
    return value.v;
  };
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The facts of one checkout, each read from git, gh or the files on first use. */
class Gatherer implements Facts {
  readonly root: string;
  readonly cwdIsRoot: boolean;
  readonly hasCommits: boolean;
  readonly head: string | null;
  readonly headBranch: string | null;
  readonly defaultBranch: string | null;
  readonly origin: boolean;
  readonly remote: Remote;
  readonly config: DocRead;
  readonly registryDoc: DocRead;
  readonly lockDoc: DocRead;
  readonly docsFrom: string | null;
  private readonly refs: ReadonlySet<string>;
  private readonly docs: DocsReader;
  private readonly runner: Runner;
  private ghState: GhState = "not-used";
  private ghTimedOut: CommandResult | null = null;
  private mergeAllowed: boolean | null = null;
  private mergeTreeTimedOut = false;
  /** Specs whose tickets came from the Part of search, since they have no sub-issues. */
  private readonly searchedSpecs = new Set<number>();

  constructor(root: string, cwd: string, runner: Runner) {
    this.root = root;
    this.runner = runner;
    this.cwdIsRoot = realpathOr(cwd) === realpathOr(root);
    const head = this.git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    this.hasCommits = head.status === 0;
    this.head = this.hasCommits ? head.stdout.trim().slice(0, 7) : null;
    const current = this.git(["branch", "--show-current"]).stdout.trim();
    this.headBranch = current === "" ? null : current;
    this.refs = new Set(this.gitOut(["for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/"]).split("\n").filter((r) => r !== ""));
    this.defaultBranch = this.findDefaultBranch();
    const url = this.git(["remote", "get-url", "origin"]);
    this.origin = url.status === 0;
    this.remote = !this.origin ? "none" : /github\.com[:/]/.test(url.stdout) ? "github" : "other";
    const docsRef = this.docsRef();
    this.docsFrom = docsRef;
    this.docs = docsRef === null ? workingTreeReader(root) : refReader((args) => this.git(args), docsRef);
    this.config = this.docs.read(CONFIG_PATH);
    this.registryDoc = this.docs.read(REGISTRY_PATH);
    this.lockDoc = this.docs.read(LOCK_PATH);
  }

  /** A git call; a timeout is never a fact about the repo, so it ends the run as an error. */
  git(args: readonly string[]): CommandResult {
    const result = this.runner("git", gitArgs(this.root, args), this.root);
    if (result.status === TIMED_OUT) throw new GitError(args, result);
    return result;
  }

  gitOut(args: readonly string[]): string {
    const result = this.git(args);
    if (result.status !== 0) throw new GitError(args, result);
    return result.stdout;
  }

  private has(ref: string): boolean {
    return this.refs.has(ref);
  }

  /**
   * origin/HEAD, else main, else master. The name goes to git as a revision, so an origin/HEAD that git would read
   * as an option is passed over.
   */
  private findDefaultBranch(): string | null {
    const head = this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const named = head.status === 0 ? head.stdout.trim().replace(/^origin\//, "") : "";
    if (named !== "" && !named.startsWith("-")) return named;
    return ["main", "master"].find((name) => this.has(`refs/heads/${name}`)) ?? null;
  }

  /** The docs come from the working tree on the default branch, else from its tip (local, else origin/). */
  private docsRef(): string | null {
    const branch = this.defaultBranch;
    if (branch === null || this.headBranch === branch) return null;
    if (this.has(`refs/heads/${branch}`)) return branch;
    if (this.has(`refs/remotes/origin/${branch}`)) return `origin/${branch}`;
    return null;
  }

  committedRegistry(): DocRead {
    if (this.docsFrom !== null || !this.hasCommits) return ABSENT;
    return refReader((args) => this.git(args), "HEAD").read(REGISTRY_PATH);
  }

  readonly lock = memo(() => parseLock(textOf(this.lockDoc)));

  userInvoked(path: string): boolean | null {
    if (!isRepoPath(path)) return null;
    const text = textOf(this.docs.read(path));
    return text === null ? null : isUserInvoked(text);
  }

  gh(): GhState {
    return this.ghState;
  }

  /** Runs gh and records what its result says about gh itself. After one timeout, later calls fail without waiting. */
  private runGh(args: readonly string[]): CommandResult {
    if (this.ghTimedOut !== null) return this.ghTimedOut;
    const result = this.runner("gh", args, this.root);
    if (result.status === TIMED_OUT) this.ghTimedOut = result;
    // gh exits non-zero when part of a GraphQL query fails, yet it ran and answered: gh itself is fine.
    const answered = result.stdout.trimStart().startsWith("{");
    this.ghState = result.status === 0 || answered ? "ok" : result.status === 127 ? "not-installed" : result.status === 4 ? "not-authenticated" : "failed";
    return result;
  }

  checkGh(): GhState {
    if (this.ghState !== "not-used") return this.ghState;
    const result = this.runGh(["auth", "status"]);
    // gh auth status exits 1 when no account is logged in.
    this.ghState = result.status === 0 ? "ok" : result.status === 127 ? "not-installed" : result.status === TIMED_OUT ? "failed" : "not-authenticated";
    return this.ghState;
  }

  mergeCommitAllowed(): boolean | null {
    return this.mergeAllowed;
  }

  /** The default branch and `origin/<default>`, those that exist: the commits that count as landed. */
  private defaultBases(): string[] {
    const def = this.defaultBranch ?? "main";
    return [...(this.has(`refs/heads/${def}`) ? [def] : []), ...(this.has(`refs/remotes/origin/${def}`) ? [`origin/${def}`] : [])];
  }

  readonly agentBranches = (specRef: string | null): AgentBranch[] => {
    const bases = this.defaultBases();
    const exclude = [...bases, ...(specRef === null ? [] : [specRef])].map((b) => `^${b}`);
    return [...this.refs]
      .filter((r) => r.startsWith("refs/heads/worktree-agent-"))
      .map((r) => r.slice("refs/heads/".length))
      .map((name) => ({ name, unmerged: this.count([name, ...exclude]), tickets: [...parseRefs(this.gitOut(["log", REFS_FORMAT, name, ...exclude, "--"]))] }));
  };

  private graphql(query: GraphqlQuery): Lookup<GraphqlAnswer> {
    const args = [
      "api", "graphql", "-f", `query=${query.query}`,
      ...Object.entries(query.variables).flatMap(([name, value]) => ["-F", `${name}=${value}`]),
      ...Object.entries(query.verbatim ?? {}).flatMap(([name, value]) => ["-f", `${name}=${value}`]),
    ];
    const result = this.runGh(args);
    if (result.status === 127) return failed("gh is not installed");
    if (result.status === 4) return failed("gh is not logged in: gh auth login");
    if (result.status === TIMED_OUT) return failed(result.stderr);
    return parseGraphql(result.stdout, result.stderr, result.status);
  }

  /** A connection read to its end: the pages after the first one fetched, up to MAX_PAGES. */
  private rest(connection: unknown, pager: Pager): Lookup<unknown> {
    if (!isRecord(connection) || !Array.isArray(connection.nodes)) return found(connection);
    let nodes: unknown[] = connection.nodes;
    let info = connection.pageInfo;
    for (let page = 0; page < MAX_PAGES && isRecord(info) && info.hasNextPage === true && typeof info.endCursor === "string"; page++) {
      const answer = this.graphql(pager.query(info.endCursor));
      if (!answer.ok) return answer;
      const next = pager.pick(answer.value);
      if (!isRecord(next) || !Array.isArray(next.nodes)) return failed(`gh api graphql printed an unexpected shape for the next page of ${pager.what}`);
      nodes = [...nodes, ...next.nodes];
      info = next.pageInfo;
    }
    return found({ ...connection, nodes, pageInfo: info });
  }

  /** A list of issues read to its end, with each issue's own blockers and labels read to theirs. */
  private restOfIssues(connection: unknown, pager: Pager): Lookup<unknown> {
    const whole = this.rest(connection, pager);
    if (!whole.ok || !isRecord(whole.value) || !Array.isArray(whole.value.nodes)) return whole;
    const nodes: unknown[] = [];
    for (const node of whole.value.nodes) {
      if (!isRecord(node) || typeof node.number !== "number") {
        nodes.push(node);
        continue;
      }
      let complete: Record<string, unknown> = node;
      for (const field of ["blockedBy", "labels"] as const) {
        if (node[field] === undefined) continue;
        const nested = this.rest(node[field], issuePager(node.number, field, NODES[field], field === "labels" ? "labels" : "blockers"));
        if (!nested.ok) return nested;
        complete = { ...complete, [field]: nested.value };
      }
      nodes.push(complete);
    }
    return found({ ...whole.value, nodes });
  }

  testCandidates(): string[] {
    const candidates: string[] = [];
    const pkg = textOf(this.docs.read("package.json"));
    if (pkg !== null) {
      try {
        const data: unknown = JSON.parse(pkg);
        if (isRecord(data) && isRecord(data.scripts) && typeof data.scripts.test === "string") candidates.push("npm test");
      } catch {
        // A package.json that does not parse offers no candidate.
      }
    }
    const makefile = textOf(this.docs.read("Makefile"));
    if (makefile !== null && /^test\s*:/m.test(normaliseLineEndings(makefile))) candidates.push("make test");
    return candidates;
  }

  triageLabels(): boolean {
    return this.docs.read(TRIAGE_LABELS_PATH).kind === "text";
  }

  localTicketFilesUncommitted(name: string): boolean {
    return this.gitOut(["status", "--porcelain", "-z", "--untracked-files=all", "--", `.scratch/${name}/issues`]) !== "";
  }

  foundSpecs(config: Config, entry: RoadmapEntry): Lookup<{ ref: string; title: string; author: string }[]> {
    if (config.tracker === "local") {
      const path = `.scratch/${entry.name}/spec.md`;
      const spec = this.docs.read(path);
      if (spec.kind === "unreadable") return failed(spec.error);
      return found(spec.kind === "absent" ? [] : [{ ref: path, title: path, author: "" }]);
    }
    const answer = this.graphql(detailQuery({ partOf: [], target: null, titleSearch: entry.name }));
    if (!answer.ok) return answer;
    const search = this.rest(answer.value.top.f, searchPager(titleSearch(entry.name), NODES.found, "issues titled like the spec"));
    if (!search.ok) return search;
    return parseFoundSpecs(search.value, entry.name);
  }

  // ---- repo facts --------------------------------------------------------

  readonly repo = (config: Config): RepoFacts => this.repoFacts(config);

  private readonly repoFacts = memoByConfig((config: Config): RepoFacts => {
    const def = this.defaultBranch ?? "main";
    const bases = this.defaultBases();
    const landedRefs = bases.length === 0 ? new Set<string>() : parseRefs(this.gitOut(["log", REFS_FORMAT, ...bases, "--"]));
    const agents = [...this.refs].filter((r) => r.startsWith("refs/heads/worktree-agent-")).map((r) => r.slice("refs/heads/".length));
    const exclude = bases.map((b) => `^${b}`);
    const inProgressRefs = agents.length === 0 ? new Set<string>() : parseRefs(this.gitOut(["log", REFS_FORMAT, ...agents, ...exclude, "--"]));
    const [ahead, behind] = bases.length === 2 ? this.leftRight(def, `origin/${def}`) : [null, null];
    const statusOut = this.gitOut(["status", "--porcelain", "-z", "--untracked-files=all"]);
    const paths = parseStatusPaths(statusOut);
    const orcPrefixes = orcPaths(config);
    const isOrc = (p: string): boolean => orcPrefixes.some((prefix) => isUnder(p, prefix));
    const worktrees = parseWorktrees(this.gitOut(["worktree", "list", "--porcelain"]));
    const main = worktrees[0];
    const agentDir = main === undefined ? null : `${main.path}/.claude/worktrees/`;
    const linked = worktrees.slice(1).map((w) => ({ ...w, agent: agentDir !== null && w.path.startsWith(agentDir) }));
    const here = realpathOr(this.root);
    const gitDir = this.git(["rev-parse", "--absolute-git-dir"]).stdout.trim();
    const commonDir = this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();
    return {
      defaultBranch: def,
      head: this.headBranch,
      docsFrom: this.docsFrom,
      linkedWorktree: gitDir !== "" && commonDir !== "" && realpathOr(gitDir) !== realpathOr(commonDir),
      origin: this.origin,
      remote: this.remote,
      ahead,
      behind,
      defaultConflicts: ahead !== null && behind !== null && ahead > 0 && behind > 0 ? this.mergeConflicts(def, `origin/${def}`) : null,
      dirty: { orc: paths.filter(isOrc), other: paths.filter((p) => !isOrc(p)) },
      worktrees: linked,
      otherWorktreeBranches: worktrees.filter((w) => realpathOr(w.path) !== here).flatMap((w) => (w.branch === null ? [] : [w.branch])),
      landedRefs,
      inProgressRefs,
    };
  });

  private leftRight(left: string, right: string): [number | null, number | null] {
    const result = this.git(["rev-list", "--left-right", "--count", `${left}...${right}`, "--"]);
    const [a, b] = result.stdout.trim().split(/\s+/).map(Number);
    return result.status === 0 && a !== undefined && b !== undefined ? [a, b] : [null, null];
  }

  private count(args: readonly string[]): number {
    return Number(this.gitOut(["rev-list", "--count", ...args, "--"]).trim());
  }

  private branchFacts(name: string, detail: boolean): BranchFacts {
    const bases = this.defaultBases();
    const exclude = bases.map((b) => `^${b}`);
    const local = this.has(`refs/heads/spec/${name}`);
    const remote = this.has(`refs/remotes/origin/spec/${name}`);
    const rangeRef = local ? `spec/${name}` : remote ? `origin/spec/${name}` : null;
    if (rangeRef === null) {
      return { local, remote, rangeRef, range: [], refsOffBranch: new Set(), localUnmerged: 0, remoteUnmerged: 0, ahead: null, behind: null, behindDefault: 0, conflictsDefault: null };
    }
    const range = parseLog(this.gitOut(["log", LOG_FORMAT, "--name-only", rangeRef, ...exclude, "--"]));
    const refsOffBranch = bases.length === 0 ? new Set<string>() : parseRefs(this.gitOut(["log", REFS_FORMAT, ...bases, `^${rangeRef}`, "--"]));
    const [ahead, behind] = detail && local && remote ? this.leftRight(`spec/${name}`, `origin/spec/${name}`) : [null, null];
    const behindDefault = bases[0] === undefined ? 0 : this.count([bases[0], `^${rangeRef}`]);
    return {
      local,
      remote,
      rangeRef,
      range,
      refsOffBranch,
      localUnmerged: local ? this.count([`spec/${name}`, ...exclude]) : 0,
      remoteUnmerged: remote ? this.count([`origin/spec/${name}`, ...exclude]) : 0,
      ahead,
      behind,
      behindDefault,
      conflictsDefault: detail && bases[0] !== undefined && behindDefault > 0 ? this.mergeConflicts(rangeRef, bases[0]) : null,
    };
  }

  /**
   * Whether merging `theirs` into `ours` would conflict, judged by `git merge-tree --quiet`, which keeps the objects
   * it makes in a temporary store and moves no ref, index or file. A timeout or a git too old for it is unknown, and
   * after one timeout no further check waits, so two can never add up to the Bash tool's limit.
   */
  private mergeConflicts(ours: string, theirs: string): boolean | null {
    if (this.mergeTreeTimedOut) return null;
    const result = this.runner("git", gitArgs(this.root, ["merge-tree", "--write-tree", "--quiet", ours, theirs]), this.root);
    if (result.status === TIMED_OUT) this.mergeTreeTimedOut = true;
    return result.status === 0 ? false : result.status === 1 ? true : null;
  }

  /**
   * Whether a merged PR landed an earlier use of the branch name, not the branch as it is now; each spec branch
   * (local and origin's) is asked. When git has the PR's head commit, the PR is the branch's own while the branch
   * holds that head on its first-parent history, as it does every commit made on it, merges of the default branch
   * into it included, or is still behind it; an earlier use's head is only a side parent of its merge, or not in the
   * branch at all. When git lacks the head, a branch that holds the PR's merge commit was cut or updated from a
   * default branch that held it. With both branches gone every merged PR counts.
   */
  private landedEarlier(pr: PullRequestFact, name: string): boolean {
    if (pr.state !== "MERGED") return false;
    const tips = [`refs/heads/spec/${name}`, `refs/remotes/origin/spec/${name}`].filter((ref) => this.has(ref));
    const head = pr.headCommit !== null && this.isCommit(pr.headCommit) ? pr.headCommit : null;
    const merge = pr.mergeCommit;
    if (head !== null) return tips.some((tip) => !this.onFirstParentHistory(head, tip) && !this.isAncestor(tip, head));
    return merge !== null && pr.mergeParents !== null && tips.some((tip) => this.isAncestor(merge, tip));
  }

  private isCommit(oid: string): boolean {
    return this.git(["cat-file", "-e", `${oid}^{commit}`]).status === 0;
  }

  private isAncestor(ancestor: string, descendant: string): boolean {
    return this.git(["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
  }

  /**
   * Whether `commit` is on `tip`'s first-parent history, read without listing it: the first-parent walk from `tip`
   * stops at the first commit `commit` reaches, which is `commit` itself exactly when it is on that history.
   */
  private onFirstParentHistory(commit: string, tip: string): boolean {
    const steps = this.git(["rev-list", "--first-parent", "--count", tip, `^${commit}`, "--"]);
    if (steps.status !== 0) return false;
    const reached = this.git(["rev-parse", "--verify", "--quiet", `${tip}~${steps.stdout.trim()}^{commit}`]);
    return reached.status === 0 && reached.stdout.trim() === commit;
  }

  private mergeParents(oid: string): number | null {
    const line = this.git(["rev-list", "--parents", "-n", "1", oid, "--"]);
    return line.status === 0 ? line.stdout.trim().split(/\s+/).length - 1 : null;
  }

  // ---- entries -----------------------------------------------------------

  entries(config: Config, registry: Registry, detailFor: (views: EntryView[]) => RoadmapEntry | null): EntryFacts[] {
    const repo = this.repo(config);
    const live = registry.entries.filter((e) => !e.dropped);
    const specced = live.filter((e) => e.spec !== null);
    const needsPrs = (e: RoadmapEntry): boolean => this.origin && (config.tracker === "github" || landingOf(e, config).mode !== "local-merge");
    const prHeads = specced.filter(needsPrs).map((e) => `spec/${e.name}`);
    const issueNumber = (e: RoadmapEntry): number | null => {
      const n = /^#(\d+)$/.exec(e.spec ?? "")?.[1];
      return n === undefined ? null : Number(n);
    };
    const githubSpecs = config.tracker === "github" ? specced.flatMap((e) => (issueNumber(e) === null ? [] : [issueNumber(e) ?? 0])) : [];

    // Phase 1: every spec issue's state and sub-issues, every spec branch's PRs, in one query.
    const light = githubSpecs.length + prHeads.length > 0 ? this.graphql(lightQuery({ specs: githubSpecs, prHeads, pullRequestFacts: this.origin && prHeads.length > 0 })) : null;
    if (light?.ok === true && typeof light.value.repository.mergeCommitAllowed === "boolean") this.mergeAllowed = light.value.repository.mergeCommitAllowed;
    const githubDefault = light?.ok === true ? light.value.repository.defaultBranchRef : null;
    // A PR counts only into the default branch, so the local name must be GitHub's: a clone keeps an old origin/HEAD after a rename.
    const defaultDiffers = isRecord(githubDefault) && githubDefault.name !== repo.defaultBranch;

    const prsOf = (e: RoadmapEntry): Lookup<PullRequestFact[]> | null => {
      const index = prHeads.indexOf(`spec/${e.name}`);
      if (index < 0 || light === null) return null;
      if (!light.ok) return light;
      const alias = `p${index}`;
      const connection = light.value.repository[alias];
      if (connection === undefined || connection === null) return failed(light.value.aliasError(alias));
      if (defaultDiffers) return failed("GitHub's default branch is not the one origin/HEAD names", "origin/HEAD names another branch than GitHub's default branch, which git remote set-head origin -a updates");
      const whole = this.rest(connection, pullRequestPager(`spec/${e.name}`));
      if (!whole.ok) return whole;
      const prs = parsePullRequests(whole.value, `spec/${e.name}`, repo.defaultBranch);
      if (!prs.ok) return prs;
      const facts = prs.value.map((pr) => ({ ...pr, mergeParents: pr.state === "MERGED" && pr.mergeCommit !== null ? this.mergeParents(pr.mergeCommit) : null }));
      return found(facts.filter((pr) => !this.landedEarlier(pr, e.name)));
    };

    const lightTracker = new Map<string, Lookup<TrackerFacts>>();
    const partOf: number[] = [];
    for (const e of specced) lightTracker.set(e.name, this.lightTrackerFacts(config, e, issueNumber(e), light, partOf));

    // Phase 2: the Part of fallback for specs with no sub-issues.
    for (const spec of partOf) this.searchedSpecs.add(spec);
    if (partOf.length > 0) {
      const answer = this.graphql(detailQuery({ partOf, target: null, titleSearch: null }));
      for (const e of specced) {
        const n = issueNumber(e);
        if (n === null || !partOf.includes(n)) continue;
        const previous = lightTracker.get(e.name);
        if (previous === undefined || !previous.ok) continue;
        lightTracker.set(e.name, this.withPartOf(previous.value, answer, n));
      }
    }

    const build = (e: RoadmapEntry, detail: boolean, tracker: Lookup<TrackerFacts> | null): EntryFacts => ({
      entry: e,
      tracker,
      branch: this.branchFacts(e.name, detail),
      prs: e.dropped || e.spec === null ? null : prsOf(e),
      onBranch: null,
    });
    const facts = registry.entries.map((e) => build(e, false, e.dropped ? null : (lightTracker.get(e.name) ?? null)));
    const target = detailFor(facts.map((f) => judgeEntry(f, repo, config)));
    if (target === null) return facts;

    // Phase 3: the target in detail: its spec's Registry: line, ticket bodies and blockers, the pending record.
    return facts.map((f) => {
      if (f.entry !== target) return f;
      const tracker = f.tracker === null ? null : this.detailTrackerFacts(config, f.tracker, issueNumber(target));
      const branch = this.branchFacts(target.name, true);
      const onBranch = config.tracker === "local" && target.spec !== null ? this.localBranchStatus(target, branch) : null;
      return { ...f, tracker, branch, onBranch };
    });
  }

  private lightTrackerFacts(config: Config, entry: RoadmapEntry, spec: number | null, light: Lookup<GraphqlAnswer> | null, partOf: number[]): Lookup<TrackerFacts> {
    if (config.tracker === "local") return this.localTrackerFacts(entry);
    if (spec === null) return failed(`Spec: of ${entry.name} is not a GitHub issue reference (#<n>)`);
    if (light === null) return failed("no GitHub lookup was made");
    if (!light.ok) return light;
    const issue = light.value.repository[`i${spec}`];
    if (issue === undefined || issue === null) return failed(light.value.aliasError(`i${spec}`));
    const parsed = this.specIssue(issue, spec, NODES.subIssues);
    if (!parsed.ok) return parsed;
    if (parsed.value.tickets.length === 0) partOf.push(spec);
    return found({ specOpen: parsed.value.specOpen, tickets: parsed.value.tickets, ignored: [], cited: null, pending: null });
  }

  private withPartOf(previous: TrackerFacts, answer: Lookup<GraphqlAnswer>, spec: number): Lookup<TrackerFacts> {
    if (!answer.ok) return answer;
    const search = answer.value.top[`s${spec}`];
    if (search === undefined || search === null) return failed(answer.value.aliasError(`s${spec}`));
    const parsed = this.partOf(search, spec, NODES.partOf);
    if (!parsed.ok) return parsed;
    return found({ ...previous, tickets: parsed.value.tickets, ignored: parsed.value.ignored });
  }

  /** A spec issue's state and its sub-issues, read to the end. */
  private specIssue(issue: unknown, spec: number, nodes: string): Lookup<{ specOpen: boolean; tickets: TicketFact[] }> {
    if (!isRecord(issue)) return parseSpecIssue(issue);
    const subIssues = this.restOfIssues(issue.subIssues, issuePager(spec, "subIssues", nodes, "sub-issues"));
    return subIssues.ok ? parseSpecIssue({ ...issue, subIssues: subIssues.value }) : subIssues;
  }

  /** The Part of search, read to the end. */
  private partOf(search: unknown, spec: number, nodes: string): Lookup<{ tickets: TicketFact[]; ignored: IgnoredIssue[] }> {
    const whole = this.restOfIssues(search, searchPager(partOfSearch(spec), nodes, "issues saying Part of the spec"));
    return whole.ok ? parsePartOf(whole.value) : whole;
  }

  private localTrackerFacts(entry: RoadmapEntry): Lookup<TrackerFacts> {
    const files = localFiles(entry, this.docs);
    if (!files.ok) return files;
    const { specText, tickets } = files.value;
    return found({ specOpen: localSpecOpen(specText), tickets: tickets.map((t) => t.fact), ignored: [], cited: citedIds(specText), pending: this.localPending(entry) });
  }

  /** The local files on the spec branch as the run lands it: `origin/spec/<name>` when the local branch only lags it. */
  private localBranchStatus(entry: RoadmapEntry, branch: BranchFacts): Lookup<BranchStatus> | null {
    const lagging = branch.local && branch.remote && branch.ahead === 0 && branch.behind !== null && branch.behind > 0;
    const ref = lagging ? `origin/spec/${entry.name}` : branch.rangeRef;
    if (ref === null || entry.spec === null) return null;
    const files = localFiles(entry, refReader((args) => this.git(args), ref));
    if (!files.ok) return files;
    return found(branchStatus({ path: entry.spec, text: files.value.specText }, files.value.tickets.map((t) => ({ ref: t.fact.ref, text: t.text }))));
  }

  /** The local pending record: on the spec branch tip while that branch holds commits the default branch lacks, else the docs. */
  private localPending(entry: RoadmapEntry): Lookup<PendingFact | null> {
    const path = `.scratch/${entry.name}/pending-decisions.md`;
    const branchRef = this.has(`refs/heads/spec/${entry.name}`) ? `spec/${entry.name}` : this.has(`refs/remotes/origin/spec/${entry.name}`) ? `origin/spec/${entry.name}` : null;
    if (branchRef !== null && !this.branchMerged(branchRef)) {
      const onBranch = refReader((args) => this.git(args), branchRef).read(path);
      if (onBranch.kind === "unreadable") return failed(onBranch.error);
      if (onBranch.kind === "text") return found({ count: countPending(onBranch.text), ref: branchRef, path });
    }
    const read = this.docs.read(path);
    if (read.kind === "unreadable") return failed(read.error);
    return found(read.kind === "absent" ? null : { count: countPending(read.text), ref: this.docsFrom ?? this.defaultBranch ?? "main", path });
  }

  /** Whether the default branch already holds every commit of the ref: the entry has landed from it. */
  private branchMerged(ref: string): boolean {
    const bases = this.defaultBases();
    return bases.length > 0 && this.count([ref, ...bases.map((b) => `^${b}`)]) === 0;
  }

  /** The pending comment: found among the first comments, else looked for to the end of them. */
  private pendingComment(issue: unknown, spec: number): Lookup<PendingFact | null> {
    const first = parsePendingComment(issue);
    if (first.ok || !isRecord(issue)) return first;
    const comments = this.rest(issue.comments, issuePager(spec, "comments", NODES.comments, "comments"));
    return comments.ok ? parsePendingComment({ ...issue, comments: comments.value }) : comments;
  }

  private detailTrackerFacts(config: Config, previous: Lookup<TrackerFacts>, spec: number | null): Lookup<TrackerFacts> {
    if (config.tracker === "local" || !previous.ok || spec === null) return previous;
    const viaSearch = this.searchedSpecs.has(spec);
    const answer = this.graphql(detailQuery({ partOf: viaSearch ? [spec] : [], target: { spec, viaSearch }, titleSearch: null }));
    if (!answer.ok) return answer;
    const issue = answer.value.repository[`t${spec}`];
    if (issue === undefined || issue === null) return failed(answer.value.aliasError(`t${spec}`));
    const body = isRecord(issue) && typeof issue.body === "string" ? issue.body : null;
    const pending = this.pendingComment(issue, spec);
    let tickets = previous.value.tickets;
    let ignored = previous.value.ignored;
    if (viaSearch) {
      const search = this.partOf(answer.value.top[`s${spec}`], spec, NODES.partOfDetail);
      if (!search.ok) return search;
      tickets = search.value.tickets;
      ignored = search.value.ignored;
    } else if (previous.value.tickets.length > 0) {
      const parsed = this.specIssue(issue, spec, NODES.subIssuesDetail);
      if (!parsed.ok) return parsed;
      tickets = parsed.value.tickets;
    }
    return found({ ...previous.value, tickets, ignored, cited: citedIds(body), pending });
  }
}

/** Memoises a function of the config, which is the same object for a whole run. */
function memoByConfig<T>(compute: (config: Config) => T): (config: Config) => T {
  const cache = new Map<Config, T>();
  return (config) => {
    const cached = cache.get(config);
    if (cached !== undefined) return cached;
    const value = compute(config);
    cache.set(config, value);
    return value;
  };
}

// ===========================================================================
// Entry point: always exit 0, never write to stderr (spec 9.4)
// ===========================================================================

export interface Environment {
  cwd: string;
  /** This script's own path; the permission hook allows only calls that resolve to it. */
  scriptPath: string;
  /** The directory this script lives in: its checkout's repository is the only one the script reads. */
  scriptDir: string;
  /** Standard input, which only the permission hook reads. */
  readInput: () => string;
  run: Runner;
  now: Date;
  nodeVersion: string;
  /** The shared core, read from `conventions.md` beside the script; null when it is missing. */
  readCore: () => string | null;
}

export interface Output {
  code: 0;
  stdout: string;
}

const USAGE_LINE =
  "usage: status.mts <command> ['<target>'] [--json] [--core], status.mts orc-discuss '<new entry>' --new [--json] [--core], status.mts registry ['<key>'...] [--project] [--json], status.mts locked '<commit>' ['<entry>'] [--json], or status.mts hook (a PreToolUse call on stdin)";

interface ParsedArgs {
  kind: "verdict" | "lookup" | "locked" | "hook";
  command: Command | null;
  argument: string | null;
  keys: string[];
  /** The lookup's `--project`: every live project decision. */
  project: boolean;
  /** `orc-discuss`'s `--new`: the target is a new roadmap entry the user chose to add. */
  newEntry: boolean;
  json: boolean;
  core: boolean;
  usage: string | null;
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const json = args.includes("--json");
  const core = args.includes("--core");
  const project = args.includes("--project");
  const newEntry = args.includes("--new");
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));
  const [first, ...rest] = positional;
  const base: ParsedArgs = { kind: "verdict", command: null, argument: null, keys: [], project, newEntry, json, core, usage: null };
  const unknownFlag = flags.find((f) => f !== "--json" && f !== "--core" && f !== "--project" && f !== "--new");
  if (unknownFlag !== undefined) return { ...base, usage: `unknown flag ${safe(unknownFlag, (f) => /^--[a-z][a-z-]*$/.test(f))}` };
  if (newEntry && (first !== "orc-discuss" || rest.length !== 1)) return { ...base, usage: "--new goes with orc-discuss and the new entry's name" };
  if (first === "hook") {
    return args.length === 1 ? { ...base, kind: "hook" } : { ...base, kind: "hook", usage: "hook takes nothing but the tool call on stdin" };
  }
  if (first === "locked") {
    if (core || project) return { ...base, kind: "locked", usage: "locked takes only --json" };
    const [since, entry, extra] = rest;
    if (since === undefined || extra !== undefined) return { ...base, kind: "locked", usage: "locked takes a commit and at most one entry" };
    return { ...base, kind: "locked", keys: entry === undefined ? [since] : [since, entry] };
  }
  if (first === "registry") {
    if (core) return { ...base, kind: "lookup", usage: "--core goes with a command, not with registry" };
    return rest.length === 0 && !project ? { ...base, kind: "lookup", usage: "registry needs a key or --project" } : { ...base, kind: "lookup", keys: rest };
  }
  if (project) return { ...base, usage: "--project goes with registry, not with a command" };
  const command = COMMANDS.find((c) => c === first) ?? null;
  if (command === null) return { ...base, usage: first === undefined ? "no command given" : `unknown command ${safe(first, isSafeName)}` };
  if (rest.length > 1) return { ...base, command, usage: "at most one target" };
  if (core && json) return { ...base, command, usage: "--core goes with the text form, not with --json" };
  if (rest[0] !== undefined && rest[0].startsWith("-")) return { ...base, command, usage: "a target never starts with -" };
  return { ...base, command, argument: rest[0] ?? null };
}

function errorVerdict(command: Command | null, reason: "usage" | "error" | "not-a-repo" | "other-repo", message: string, env: Environment, error?: string): Verdict {
  const next =
    reason === "not-a-repo" ? manual("/orc-setup", "after git init")
    : reason === "other-repo" ? manual("/orc", "from the checkout orc is installed in")
    : reason === "usage" ? manual("/orc", "with a valid command")
    : manual("/orc", "after fixing what the error in --json names");
  return {
    schema: SCHEMA,
    command,
    stamp: stamp(null, env.now),
    origin: false,
    banner: command === null ? [] : banner(command, "none given"),
    lines: [],
    ids: [],
    upstream: [],
    reference: [],
    outcome: stop(reason, [message], command === null ? next : awayFrom(command, next), error),
  };
}

function render(verdict: Verdict, parsed: ParsedArgs, env: Environment): string {
  if (parsed.json) return JSON.stringify(verdict, null, 2);
  if (!parsed.core) return renderVerdictLines(verdict).join("\n");
  const core = env.readCore();
  if (core === null) return renderVerdictLines(verdict.outcome.kind === "stop" ? verdict : withoutCore(verdict)).join("\n");
  return [...renderVerdictLines(verdict), ...block("Core", normaliseLineEndings(core).trimEnd().split("\n"))].join("\n");
}

/** A run cannot follow a core it never got: a pick or a go asked for with --core stops when the core is missing, and a stop prints as it is. */
function withoutCore(verdict: Verdict): Verdict {
  const message = "orc's shared core, conventions.md, is missing beside status.mts, so this install is incomplete.";
  return { ...verdict, lines: [], outcome: stop("error", [message], manual("/orc", "after reinstalling orc")) };
}

/** Why a lookup or the locked-lines check reads nothing here. */
function checkoutProblem(checkout: Exclude<Checkout, { kind: "checkout" }>): string {
  if (checkout.kind === "error") return checkout.message.replace(/\.$/, "");
  return checkout.kind === "not-a-repo" ? "not inside a git repository" : OTHER_REPO;
}

function lookupOutput(parsed: ParsedArgs, env: Environment): string {
  const problem = (message: string): string => (parsed.json ? JSON.stringify({ schema: SCHEMA, error: message }, null, 2) : `orc lookup error: ${message}`);
  const checkout = findCheckout(env);
  if (checkout.kind !== "checkout") return problem(checkoutProblem(checkout));
  const facts = new Gatherer(checkout.root, env.cwd, env.run);
  if (facts.registryDoc.kind === "unreadable") return problem(`${REGISTRY_PATH} exists but could not be read`);
  if (facts.registryDoc.kind === "absent") return problem(`${REGISTRY_PATH} does not exist`);
  const result = lookupKeys(parseRegistry(facts.registryDoc.text), parsed.keys, parsed.project);
  return parsed.json ? JSON.stringify(result, null, 2) : renderLookup(result).join("\n");
}

/** Whether the registry lines a commit held are all still in the working tree: the check after a run writes it. */
function lockedOutput(parsed: ParsedArgs, env: Environment): string {
  const [stampArg = "", entry = null] = parsed.keys;
  // The stamp as a verdict prints it, `<commit> <time>`, or the commit alone.
  const since = STAMP_TIME.test(stampArg) ? stampArg.split(" ")[0] ?? "" : stampArg;
  const shown = safe(since, (v) => SHORT_SHA.test(v));
  const problem = (message: string): string => (parsed.json ? JSON.stringify({ schema: SCHEMA, error: message }, null, 2) : `orc locked error: ${message}`);
  if (!SHORT_SHA.test(since)) return problem("the commit is not a commit id (7 to 40 hex digits)");
  if (entry !== null && !ENTRY_NAME.test(entry)) return problem("the entry is not a kebab-case name");
  const checkout = findCheckout(env);
  if (checkout.kind !== "checkout") return problem(checkoutProblem(checkout));
  const root = checkout.root;
  const git = (args: readonly string[]): CommandResult => env.run("git", gitArgs(root, args), root);
  if (git(["rev-parse", "--verify", "--quiet", `${since}^{commit}`]).status !== 0) return problem(`${shown} is not a commit in this repository`);
  const before = refReader(git, since).read(REGISTRY_PATH);
  const after = workingTreeReader(root).read(REGISTRY_PATH);
  if (before.kind === "unreadable" || after.kind === "unreadable") return problem(`${REGISTRY_PATH} could not be read`);
  const changed = before.kind === "absent" ? [] : lockedChanges(before.text, textOf(after) ?? "", entry);
  if (parsed.json) return JSON.stringify({ schema: SCHEMA, since: shown, changed }, null, 2);
  return `orc locked ${shown}: ${changed.length === 0 ? "unchanged" : `changed: ${changed.map((n) => `line ${n}`).join(", ")}`}`;
}

function verdictFor(parsed: ParsedArgs, env: Environment): Verdict {
  const command = parsed.command;
  if (parsed.usage !== null || command === null) return errorVerdict(command, "usage", `Usage error: ${parsed.usage ?? "no command given"}. ${USAGE_LINE}`, env);
  const checkout = findCheckout(env);
  if (checkout.kind === "error") return errorVerdict(command, "error", checkout.message, env, checkout.detail);
  if (checkout.kind === "not-a-repo") return errorVerdict(command, "not-a-repo", "Not inside a git repository, and orc needs one.", env);
  if (checkout.kind === "other-repo") {
    return errorVerdict(command, "other-repo", "This directory is in another repository than the one orc is installed in, and the script reads only that one, since git runs commands a repository's own config names.", env);
  }
  const facts = new Gatherer(checkout.root, env.cwd, env.run);
  return buildVerdict({ command, argument: parsed.argument, newEntry: parsed.newEntry, facts, now: env.now }, env.nodeVersion);
}

// ---------------------------------------------------------------------------
// The permission hook (spec 9.4)
// ---------------------------------------------------------------------------

/** One argument as the skills type it: a flag, a bare word with no shell-special character, or a single-quoted value. */
const HOOK_ARGUMENT = "(?:--[a-z]+|[A-Za-z0-9][A-Za-z0-9._/-]*|'[\\p{L}\\p{M}\\p{N}_./#: -]+')";
const HOOK_CALL = new RegExp(`^node "(/[^"$\`\\\\\\n]+)"(?: ${HOOK_ARGUMENT})*$`, "u");

/**
 * The answer to a PreToolUse call: allow when the Bash command is `node "<absolute path>" <arguments>`, the path
 * resolving to this very script and every argument one the skills type; otherwise nothing, so the normal permission
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

/** The whole program: every outcome, every failure included, is printed as data and exits 0. */
export function runStatus(args: readonly string[], env: Environment): Output {
  const parsed = parseArgs(args);
  // The hook's output is read as a decision, so it prints the decision alone or nothing at all.
  if (parsed.kind === "hook") {
    if (parsed.usage !== null) return { code: 0, stdout: "" };
    try {
      return { code: 0, stdout: hookDecision(env.readInput(), env.scriptPath) };
    } catch {
      return { code: 0, stdout: "" };
    }
  }
  let text: string;
  try {
    text =
      parsed.usage === null && parsed.kind === "lookup" ? lookupOutput(parsed, env)
      : parsed.usage === null && parsed.kind === "locked" ? lockedOutput(parsed, env)
      : render(verdictFor(parsed, env), parsed, env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    text = render(errorVerdict(parsed.command, "error", "The status script failed; the error is in --json.", env, detail), { ...parsed, core: false }, env);
  }
  return { code: 0, stdout: `${printable(text)}\n` };
}

export function defaultEnvironment(): Environment {
  return {
    cwd: process.cwd(),
    scriptPath: import.meta.filename,
    scriptDir: import.meta.dirname,
    readInput: () => readFileSync(0, "utf8"),
    run: systemRunner,
    now: new Date(),
    nodeVersion: process.version,
    readCore: () => {
      try {
        return readFileSync(join(import.meta.dirname, "conventions.md"), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** `import.meta.main` arrived in Node 24.2.0; on an older Node the script compares its own path, so the node stop still prints. */
function isMain(): boolean {
  const main: boolean | undefined = import.meta.main;
  if (main !== undefined) return main;
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(realpathOr(script)).href === import.meta.url;
}

if (isMain()) {
  let output: string;
  try {
    output = runStatus(process.argv.slice(2), defaultEnvironment()).stdout;
  } catch {
    output = "orc verdict 1 none stop\nStop:\n  Reason: error\n  Message:\n    The status script failed before it could judge anything.\n";
  }
  process.stdout.write(output);
  process.exitCode = 0;
}
