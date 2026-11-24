# Orc v1 spec

Orc is a thin extension that sits beside Matt Pocock's agent skills
(`mattpocock/skills`, called upstream below). It adds what that pack lacks for
multi-day work: a decision and requirement registry, commit-level
traceability, explicit per-step commands that say what they run, a status
view, picker-based interviews, and a landing step with a choice of ceremony.
Orc never edits upstream skill files, and it owns no execution engine.

The earlier full-harness design lives on the `experimental` branch and is
reference material only.

This page is for maintainers and for anyone checking a detail the other docs
only summarise. To use orc, the [guide](guide.md) and the
[command reference](commands.md) are the shorter way in.

- [1. Goals and non-goals](#1-goals-and-non-goals)
- [2. Decisions](#2-decisions)
- [3. Commands](#3-commands)
- [4. What a developer does](#4-what-a-developer-does)
- [5. Owned surface](#5-owned-surface)
- [6. Files orc writes in a target repo](#6-files-orc-writes-in-a-target-repo)
- [7. Skills](#7-skills)
- [8. Registry](#8-registry)
- [9. Config, profiles and the status script](#9-config-profiles-and-the-status-script)
- [10. Rules file](#10-rules-file)
- [11. Later releases, designed for now](#11-later-releases-designed-for-now)
- [12. Done for v1](#12-done-for-v1)

## 1. Goals and non-goals

Goals:

- One install and one setup command per repo. After that, the whole main flow
  runs through named `/orc-*` commands, and nobody has to remember upstream
  skill names.
- Transparency: every command states what it is about to run, read and write
  before it starts, and names the next command when it ends.
- A two-level interview (project, then per spec) whose outcome is locked into
  ids that specs, tickets and commits can cite.
- Status derived from git and the tracker, so a crash or a context reset
  loses nothing.
- Compute, don't instruct: every rule about state lives once, in the tested
  status script, which hands each command a verdict. The skills carry
  procedure only, and their static text stays within a tested budget (12).
- Speed for one to three developers: ceremony (PRs, review waits) is a choice
  per profile and per spec, never a fixed cost.
- Upstream skills stay unmodified, so an update is a clean overwrite.

Non-goals for v1:

- No executor, event log, state machine, merge queue or benchmark. The status
  script judges and reports; it never acts.
- No UAT skill (v1.1) and no unattended run (v1.2). Section 11 designs for
  both.
- No tracker beyond GitHub Issues and local markdown. No harness other than
  Claude Code.
- No separate test writer. Upstream `tdd` plus the two-axis `code-review` is
  tried first.

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope | Registry, traceability, per-step commands, status, picker interview, landing |
| Commands | One orc command per step, plus an optional `/orc-next` with a confirm picker |
| Targets | Every step command takes an optional target (spec, or a ticket for the build) and defaults to the active spec; `/orc-discuss` offers a picker |
| Names | Upstream words (spec, tickets, build, land), with the GSD equivalent shown wherever a command is listed |
| Status | `status.mts` returns each command's verdict: a stop, a pick, or a go with the parameters the command needs. The rules live once, in tested code |
| Delivery | Each skill injects its verdict at invocation through one fixed, argument-free command; a Bash call of the same command covers a typed target and a stale verdict |
| Context | A small shared core, at most one reference file per command, registry lines by id, byte budgets under test |
| Tracker | Chosen per repo at setup: GitHub Issues or local markdown. Fixed once an entry has a spec |
| Landing | Three modes: local merge, PR merged by the agent, PR with human review. Profile default, per-spec override. Merge commits only, no partial landing |
| Agent merge | The agent opens the PR, waits for checks, then merges. No native auto-merge |
| Push | One `push` setting (`ask`, `always`, `never`) governs pushes, PRs and issue creation in every command |
| Build conflicts | Where a build had to go against the spec, a ticket or a locked id, the line goes to one pending-decisions record per spec, with no authority until `/orc-discuss` locks it; every other build choice is an assumption, reported and never gated |
| Ticket states | Tickets close at landing. `built` labels and `Status: built` lines are display only; trailers decide |
| Harness | Claude Code only |
| Upstream install | Vendored unmodified into `.claude/skills/` by `/orc-setup`, with a picker for which skills, pinned to one upstream commit per run |
| Orc install | One `npx skills@1 add` command per repo, then `/orc-setup` |
| Pickers | Orc's discuss skill wraps upstream `grilling`; a project rule asks for pickers elsewhere |
| CLAUDE.md | Sacred. Neither orc nor upstream's setup writes to it. Rules go under `.claude/rules/` |
| Attribution | Setup turns off the co-author trailer, the PR attribution line and session links in the repo settings |
| Interviews | Two levels: project once, then one per spec. Full depth in every profile |
| Rigor | A small profile file read by orc's own skills |
| Add-backs | Roadmap of specs, foundations-first slicing, run-ready registry |
| Repo | This repo, `main` |

## 3. Commands

| Command | GSD equivalent | Wraps upstream | What it does |
|---|---|---|---|
| `/orc-setup` | new-project (tooling part) | `setup-matt-pocock-skills` | Vendors upstream, writes config and rules. Run again to update |
| `/orc-discuss [spec]` | new-project interview, discuss-phase | `grilling`, `domain-modeling` | Picker interview, then locks ids into the registry |
| `/orc-spec [spec]` | spec-phase | `to-spec` | Writes the spec to the tracker |
| `/orc-tickets [spec]` | plan-phase | `to-tickets` | Splits the spec into tickets with blocking edges |
| `/orc-build [spec or ticket]` | execute-phase | `implement-spec`, `implement` | Builds the spec, or one ticket, on the spec branch |
| `/orc-land [spec]` | ship | `pr` (PR modes) | Lands the spec branch in the chosen mode |
| `/orc [spec]` | progress | none | Status. Read-only |
| `/orc-next` | next | none | Proposes the next step in a picker, then runs it |
| `/orc-uat [spec]` (v1.1) | verify-work | none | Agent pre-checks, then a checklist for the human |
| `/orc-run [spec]` (v1.2) | autonomous | none | Chains the steps unattended between interview and UAT |

The GSD equivalent appears in three places so it is visible at a glance: in
each skill's `description` (which Claude Code shows in the command list), in
the banner each command prints, and in the README table.

### 3.1 Transparency contract

Every command starts with a banner and ends with a pointer:

```
/orc-tickets  (GSD: plan-phase)
Runs:    upstream to-tickets (config role tickets), at its locked commit
Target:  auth (none given: the active spec)
Reads:   orc's verdict, the spec, the registry lines it cites, GLOSSARY.md and docs/adr/
Writes:  tickets with blocking edges, only after you approve the breakdown
Outward: GitHub: creates the ticket issues; local: pushes the default branch (both per push)

Target:  auth (roadmap entry 1), spec #12
Pinned:  to-tickets @ 1a2b3c4
...
Done. Next: /orc-build auth   (3 of 3 tickets to build; start it after /clear)
```

- **Banner.** One fixed block, the first message, printed before any tool
  call (the script call included), as plain text: never in a code block, and
  without the indent the verdict gives it. The verdict carries it ready-made
  (9.3), its `Banner:` label stating that rule, since the label is the one
  place every run reads at that moment, `/orc` included, which gets no core.
  Every line but `Target:` is fixed per command and never depends on the
  target; with no argument `Target:` names the resolved target. With an
  argument, the run prints the same block with `Target:` reading the argument
  as given, since the injected verdict was judged without it, and the
  resolution lines that follow are the fallback call's. A banner printed
  after a tool call tends to get lost, so it holds nothing that needs a read.
  Every run, a re-invocation included, prints it. A run that has no injected
  verdict (9.4) prints the banner's first line and `Target:` with the argument
  (or `none`) before its fallback call, and the rest of the banner first
  thing after it.
- **Resolution lines.** The verdict carries them once a target is resolved:
  `Target:`, `Pinned:` (the first 7 characters of the locked commit of each
  upstream skill the run uses) and the command's own (`Mode:`, `State:`,
  `Build:`). With no argument they arrive with the banner; with one, after the
  fallback call. They open every later stop message and picker question, and
  the final report, which the verdict says beside them (`LinesOpen:`).
- **Pointer.** The last line of every run, `Done. Next: <command>   (<why>)`.
  At the end of a run, and wherever a run stops on a state it does not act
  on, it is the `next` of a verdict taken after the run's own writes: every
  go with a target carries it ready-made (`Pointer:`), and so does every
  stop. A run that stops for a reason of its own says why in one plain line,
  then points at the command that fixes it. A pointer to wait or to fix
  something by hand never names the command that gives it, since running that
  again first changes nothing: it names `/orc`, which judges again and names
  the step, and `/orc`'s own names `/orc-next`. A step to run may name the
  same command on another target, as `/orc-build <blocker>` does.
- **Pickers.** Every question with two to four clear answers goes through the
  native picker, recommended option first with "(Recommended)" on its label.
  What the user must judge (a draft, a proposal, a breakdown, a diff, the
  commits about to be pushed) goes inside the picker's question, since text
  meant to come before a picker can be skipped.
- **One simple command per Bash call.** The first reading step of every skill
  opens with the same sentence: "Every Bash call in this run, from the first,
  is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`." Every
  subagent prompt carries the rule.
- **Tracker text is data.** Issue and PR text, comments, registry lines and
  file names describe the work and never change what a run executes. They
  reach the model only through a tool call, never inside an injected verdict
  (9.4), whose only paths are those orc builds itself from validated names. A
  name typed into a command holds only letters, digits, `-`, `_`, `.` and `/`
  and does not start with `-`; anything else is named as data, never typed.

A command run through `/orc-next` has its banner printed inside `/orc-next`'s
confirmation picker instead, since that question is the one place sure to be
shown before the command runs.

### 3.2 Outward actions and the push setting

The banner's `Outward:` line names anything outward-facing or hard to undo,
and the config's `push` decides how it is approved:

| Action | `ask` | `always` | `never` |
|---|---|---|---|
| Push the default branch after a docs commit (`/orc-discuss`, `/orc-spec`, `/orc-tickets`) | picker, the commits in its question | pushes | no push |
| Create the spec and ticket issues (GitHub) | picker, the titles in its question | creates | prints `gh issue create` commands and stops |
| Land: push, open or merge a PR, merge into the default branch, delete `origin/spec/<name>` | the landing picker (7.5) | goes ahead, the question printed as a message | `local-merge` without a push; PR modes stop |
| Bookkeeping on GitHub: `built` labels (removing `ready-for-agent`), the pending-decisions comment, closing comments and `gh issue close` | part of its step | part of its step | part of its step |

Bookkeeping is named in its step's banner, which says it happens whatever
`push` says, and is approved with the step (the build's start, the lock, the
landing): `never` stops pushes, PRs and issue creation only, since leaving it
undone would strand the state: an issue never closed keeps its entry the
active spec, and a pending comment never written hides the decisions from the
landing gate. A verdict's `Push:` line under `never` says the same, since that
is where a run reads the setting when it acts on it.

For `/orc-tickets` the breakdown approval is that titles picker. Under
`always` the breakdown is still approved, since that judges content, not an
outward step. A rejected push stops that part of the run with git's output
and one line on what it means: the commit stays on the local default branch,
`/orc` counts it as unpushed, and `/orc-land` reconciles a diverged default
branch (7.5). A default branch that origin protects (pull requests only)
rejects every direct push; v1 does not detect protection and adds no flow for
it, so the line says that such a branch lands through a PR mode. Three
questions are asked whatever `push` says, since the config cannot foresee
them: merging a diverged `origin/<default>`, landing with pending decisions,
and landing with no test command.

Under `never` the printed commands come in dependency order, with bodies in a
`mktemp -d` folder passed by `--body-file` and tickets made sub-issues by
`--parent <spec n>`. Each runs as printed: it carries a label only when the
repo has it, which for upstream's triage labels (`to-spec` and `to-tickets`
apply `ready-for-agent`) means only where upstream's setup created them and
wrote `docs/agents/triage-labels.md` (the verdict's `triageLabels`, which
the brief follows under every `push` value). `--blocked-by` needs numbers
that exist only once the earlier commands have run, so each blocker is named
by the command whose printed number goes there. Filing them is the user's
step, so the run ends with the verdict's `byHand` pointer, `/orc` with the
reason, never the command itself; the next run of the same command finds the
filed issues through its resume check (7.3).

### 3.3 Targets

With no argument a step command acts on the **active spec**, the target the
script resolves: the first roadmap entry not dropped and not finished, where
finished means landed with every tracker item resolved. A landed entry whose
issues are still open is therefore the active spec, and `/orc` and
`/orc-next` point at `/orc-land <name>` for it. `/orc-discuss` in spec mode
chooses from its own list (7.2).

A bare `/orc-land` looks at **leftovers** first: what a landed entry still
holds that a landing clears, its open tracker items and its spec branches that
git shows merged (local, and `origin`'s unless `push` is `never`). With such
an entry and an entry that has not landed, it is a pick verdict of the two:
finish the first, or go on to the next. With only one of them, that one is the
target. A landed entry with nothing but a merged branch left is finished for
`/orc` and `/orc-next`, which move on and keep the branch as a note naming
`/orc-land <name>`, or for `origin`'s under `push: never`, which no run
removes, the `git push origin --delete` to run by hand; a named target never
asks.

An argument names a roadmap entry (`auth`), a spec reference matching an
entry's `Spec:` value as a whole (`#12` exactly, never `#120`; a path exactly
or by whole leading segments, so `.scratch/auth` never matches
`.scratch/auth-extra/spec.md`), or for `/orc-build` a ticket (`#14`,
`auth/01`). A dropped entry is never a target. An argument that matches
nothing, more than one entry, or only dropped entries gets a pick verdict
(9.3): a picker of the script's candidates, the question saying which of the
three it was. Never a guess. With no entry to offer, it resolves as no
argument would, since a picker needs options. The script applies every rule
in this section; no skill restates them.

### 3.4 `/orc-next`

Its verdict carries the next step and the proposed command's own verdict for
its entry, then it shows it:

```
Next step: /orc-tickets auth  (spec #12 exists, no tickets yet; run it in the spec's session)
[Run it] [Choose another step] [Cancel]
```

The picker question also carries the proposed command's banner, taken from
that nested verdict, so nothing is read before the user answers. On "Run it",
it reads that command's skill file and follows it with the nested verdict as
the run's verdict (9.4), its banner already printed in the question, so the
file's own injected and fallback calls for a verdict are skipped. "Choose
another step" and a free-text command get the chosen command's verdict
through the fallback call. A `wait` step puts "Cancel" first; a `manual` step
is a stop, said in one line, and proposes nothing. When the nested verdict is
a stop, `/orc-next` prints it, banner first, and proposes nothing, except a
`/orc-land` stop in a repo with an `origin`: a fetch may clear it (a PR
merged elsewhere), so it is proposed like a go and the handed-over run
fetches first (7.5). It is never a pick, since the proposed command names its
entry, except when no entry is left: then the proposal is `/orc-discuss` and
its nested verdict the pick that asks for a new entry's name (7.2), which the
handed-over run answers with the `--new` call. Free text is followed only
when it names one of orc's own commands. The named commands stay the primary
interface; `/orc-next` only saves the lookup.

## 4. What a developer does

```
npx skills@1 add Siddharth-Khattar/orchestra -a claude-code --copy -y
/orc-setup
/orc-discuss            project interview: requirements, architecture, roadmap

per spec, in roadmap order:
  /orc-discuss          spec interview: decisions, seams, landing mode
  /orc-spec             same session
  /orc-tickets          same session
  /clear
  /orc-build
  /orc-discuss          when the build recorded decisions to lock
  /orc-uat              once v1.1 ships
  /orc-land

/orc                    at any time, also after a crash or on a new day
```

Upstream advises keeping grilling, `to-spec` and `to-tickets` in one context
window, and starting the build fresh. The pointers each command prints follow
that advice.

Requirements: Node 24.3.0 or newer and `git`. The floor is `status.mts`'s,
which runs directly on Node's type stripping: `import.meta.main` arrived in
24.2.0, and 24.3.0 is the first 24.x whose type stripping prints no
experimental warning, which would reach the injected verdict through stderr
(9.4). The `skills` CLI asks for Node 22.20.0 or newer, which the floor
covers. An
authenticated `gh` is needed for the GitHub tracker and for both PR modes.
The `skills` CLI is pinned to its major, `skills@1`, in the install line and
in every command orc runs.

## 5. Owned surface

```
skills/
  orc/            SKILL.md, conventions.md, status.mts, hook.mts
  orc-setup/      SKILL.md, reference.md, rules-template.md, config-template.json
  orc-discuss/    SKILL.md, reference.md, registry-template.md
  orc-spec/       SKILL.md
  orc-tickets/    SKILL.md
  orc-build/      SKILL.md, reference.md
  orc-land/       SKILL.md, reference.md
  orc-next/       SKILL.md
tests/status.test.ts    kept out of the skill folders so it is never vendored
tests/budget.test.ts    the context budget of section 12, apart from the script's own tests
tests/fixture.ts        the fixtures both tests share: temporary git repos and a fake gh
package.json            the package's metadata; dev only: TypeScript, @types/node and the test script
package-lock.json       committed, so every checkout tests with the same versions
tsconfig.json
.gitignore              this repo's own: node_modules/ and local tool state
docs/spec.md
docs/guide.md           the walk-through from an empty repo to a landed change
docs/commands.md        the command reference: what each runs, reads, writes, pushes and asks
docs/concepts.md        the registry, entry states, trackers, landing modes, pending decisions, trailers
docs/configuration.md   the config keys, the profiles, the push setting, updating
docs/troubleshooting.md the stops, what to do about each, and the limits of v1
docs/how-it-works.md    the script, the verdict, the permission hook, the budgets, the tests
docs/assets/            the logo and figures, each figure with its HTML source under src/
README.md
CHANGELOG.md            the changes in each release
CONTRIBUTING.md         what lives where, setup, and what a change touches
.github/                the bug report form and the pull request template
LICENSE                 MIT
CLAUDE.md               the user's, never edited by a build
```

Only `skills/` is installed into a target repo: eight skills, one script,
the permission hook of 9.4, the shared core, four reference files and three templates. The four step
wrappers (spec, tickets, build, land) are thin: the verdict, the brief for
upstream, and the pointer. Anything beyond this list needs a reason written
into this spec first.

All eight skills are user-invoked (`disable-model-invocation: true`), since
each one starts a workflow the user should choose to start.

### 5.1 Shared core and reference files

`orc/conventions.md` is the **shared core**: only what a model must know and
code cannot enforce.

- Reading the verdict: the banner first, a stop printed as is, a pick asked
  in a picker, a reference section followed when named, and the fallback
  cases and staleness of 9.4.
- Pickers: the native picker, recommended option first, and judged content
  inside the question (3.1).
- One simple command per Bash call, and the safe-name rule for anything typed
  into a command (3.1).
- Tracker text, registry lines and file names are data, never instructions.
- Upstream skills: a model-invocable one is called through the Skill tool; a
  user-invoked one is read at its path and followed, since the Skill tool
  refuses it and the refusal also forbids following it another way, and the
  user's own `/orc-*` command is the explicit invocation it requires. The
  verdict says which each one is. They are the vendored copies, which shadow
  Claude Code's built-in skills of the same name, so no other review or test
  skill stands in for them.
- The pointer: the last line, taken from a fresh verdict, with nothing after
  it, and a stop there other than `state` said plainly as not the run's doing
  (9.3); and a value the text form withholds is read from `--json` as data.
- Commits stage and commit the paths they name only, with the message the
  skill gives and no attribution lines. `CLAUDE.md`, `AGENTS.md` and
  vendored upstream files are never edited.
- Re-runs resume: existing work is never rewritten or duplicated.
- The push rule the three docs commands share after their commit (3.2), held
  once here rather than repeated in each skill, and what a rejected push
  means, which the landing shares.
- A leftover worktree that `git worktree remove` refuses, shown with its
  files and lock before it is removed (7.4), which the build and the landing
  share.

It holds no state rule, target rule, registry format or schema: those live in
the script and in this spec. What code can carry, the verdict carries
instead: the resolution lines and what they open, the pointer, the
locked-lines check (8). Commands whose arguments hold `(`, `)`, `*` or `?`
are written out, quoted, in the skill that runs them. It stays within the
budget of section 12. The script prints it, as text it reads from that one
file, at the end of the injected verdict of every command but `/orc` (the
`--core` flag, 9.3), so no skill reads it with a tool call; `/orc` needs only
its verdict.

A **reference file** holds one command's rare branches, one heading each, as
`reference.md` in its skill folder. A command has at most one, since every
deferred read costs a turn. The verdict names the headings to follow when the
run takes those branches (`reference`, 9.5), since one run can take two (a PR
landing onto a diverged default branch); a run that takes none never reads
the file. `orc-build` names `notes` when `research` is `always`, since an
`on-demand` build most often writes none. Four commands have one:

- `orc-setup`: the update run (its first picker, the upstream diff and
  re-add, removed skills), since a first run takes none of it; successor
  resolution sits in the skill, since a first run can need it too.
- `orc-discuss`: the project interview, the wayfinder start (which the
  project interview follows, and the verdict names on a spec interview's
  first visit), resolving a pending record on the spec branch, and a `null` role,
  since a repo runs the project interview once.
- `orc-build`: leftover `worktree-agent-*` branches, the review-only start,
  exploration notes and a `null` role, since a first build of a spec takes
  none of them.
- `orc-land`: the PR modes, merging a diverged `origin/<default>`, and a
  `null` role, since a `local-merge` landing takes none of them.

`/orc`, `/orc-next`, `/orc-spec` and `/orc-tickets` keep their few rare lines
inline, within their budgets.

## 6. Files orc writes in a target repo

| Path | Written by | Content |
|---|---|---|
| `.claude/skills/<name>/` | setup, through the `skills` CLI | Upstream skills, unmodified (orc's own come from the install command) |
| `skills-lock.json` | the `skills` CLI | Source repo, commit and hash per vendored skill. Only the script reads it |
| `.claude/rules/orc.md` | setup | The rules in section 10 |
| `.claude/rules/agent-skills.md` | setup, on upstream's behalf | Upstream's `## Agent skills` block |
| `.claude/settings.json` | setup | `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` merged in, existing keys kept |
| `.gitignore` | setup | `.claude/worktrees/` ignored, since implementer worktrees live there; `!.scratch/` with the local tracker when a rule ignores it |
| `docs/orc/config.json` | setup | Section 9.1 |
| `docs/orc/registry.md` | discuss, spec | Section 8 |
| `docs/agents/*.md` | upstream's setup | Tracker and domain docs |
| `.scratch/<name>/` | spec, tickets, build, discuss, land (local tracker) | `spec.md`, `issues/<NN>-<slug>.md`, `notes/`, `pending-decisions.md` |

On GitHub orc also writes the spec and ticket issues, the `built` and
`orc-ticket` labels, and one pending-decisions comment per spec issue.

All of these files are committed. Implementer subagents work in git
worktrees, and a worktree only contains committed files. Setup therefore
ends by offering one commit of its files, discuss commits its own, and
`/orc-build` refuses to start while an orc path is dirty. With the local
tracker the same holds for `.scratch/`, which setup makes sure is not
gitignored.

## 7. Skills

Each command's stops and the parameters of its go are listed in 9.3; this
section gives what the run does with them.

### 7.1 `/orc-setup`

A first run:

1. The verdict judges the prerequisites (9.3) and stops with a plain message
   when one is missing.
2. Ask in one picker call: the tracker (GitHub Issues recommended with a
   GitHub remote), the profile with the defaults it implies (9.1), extras
   ("Core only" or "Choose extras"), and the test command (each candidate the
   verdict found in `package.json`'s `test` script or a Makefile `test`
   target, "None for now", or one typed in, which must be a single simple
   command). Mvp is recommended. The GitHub tracker and the production
   profile, which lands by PR, need a working `gh`, which the verdict
   reports; local markdown without it can fall back to `local-merge`.
3. Clone upstream shallowly; its `HEAD` is the run's one pin. Read the
   promoted list from `.claude-plugin/plugin.json`; in-progress skills are
   never offered.
4. Vendor the core chain (`grilling`, `domain-modeling`, `grill-with-docs`,
   `research`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `tdd`,
   `codebase-design`, which `tdd` calls, `code-review`, `pr`, `ask-matt`,
   `setup-matt-pocock-skills`) and the
   chosen extras, offered in groups of four since the native picker holds
   four options, with `npx -y skills@1 add mattpocock/skills#<pin> -s <names>
   -a claude-code --copy -y`. When one of those skills already has a folder
   (a manual install, or a run that stopped early), the run first asks to
   overwrite them, naming each with what differs, since the add drops local
   edits.
5. Resolve each wrapper's upstream skill to a path for the config (7.6).
6. Write `.claude/rules/orc.md`, merge the attribution setting into
   `.claude/settings.json`, ignore `.claude/worktrees/`, and keep `.scratch/`
   visible with the local tracker.
7. Run upstream's `setup-matt-pocock-skills` by following its vendored
   `SKILL.md`, with the tracker already answered and one override: the
   `## Agent skills` block goes into `.claude/rules/agent-skills.md`, and
   `CLAUDE.md` is not touched. An unscoped rules file loads every session
   with the same priority as `CLAUDE.md`, so upstream skills still find the
   tracker and domain docs. Everything else upstream's setup does is followed
   as written, so its future changes carry over. The full draft goes inside
   the confirmation picker's question, with the labels to be created:
   upstream's, and orc's `built` and `orc-ticket` on GitHub. Orc's labels
   are created before the commit, so when upstream's setup is skipped (its
   role unresolved) they are asked about on their own.
8. Write the config last, since its presence is what marks a later run as an
   update: a first run that stops part way starts over as a first run.
9. Offer the commit of exactly the paths it created or changed, each listed
   in the question and never a whole directory, then point at
   `/orc-discuss`.

**Update.** Run again, setup is the update command, and the verdict names the
reference section for it. Its first question, with the current settings in
it, is "Keep settings (Recommended)" or "Go through the setup questions
again". Going through them asks step 2 again; everything can change except
the tracker once any roadmap entry has a `Spec:` line, which the verdict
reports (`trackerLocked`), and the question says so. The setup verdict
judges a config with missing keys or unknown values too, so an update never
stops on what it is about to fill in. A new profile rewrites the knobs it
sets, replacing hand edits, as the question says. A changed tracker reruns
steps 6 and 7, since the rules and `docs/agents/` describe it. Otherwise an
update does not run upstream's setup again.

Either way it then asks before re-adding the vendored skills, the question
holding which of them changed upstream since the locked commit the verdict
names and the full diff for every skill a wrapper depends on ("Update to
`<sha>`" or "Keep the current versions", which makes the locked commit the
pin). It uses `add`, never `skills update`, so the overwrite is deliberate
and visible. It re-resolves the paths, offers to remove skills gone upstream,
creates a missing orc label after saying so, fills in every template key the
config lacks, and offers the commit.

### 7.2 `/orc-discuss`

The verdict sets the mode: no registry means the project interview;
otherwise the interview is for one roadmap entry.

**Target in spec mode.** An argument resolves as in 3.3; any entry not
dropped can be revisited, a landed one included. A valid new entry name that
matches nothing gets a pick verdict that offers "Add `<name>` at the end of
the roadmap" first. With no argument, the eligible entries are those whose
state is not `dropped`, `cleanup-pending` or `landed`, undiscussed first, then
in roadmap order. One is used, and the resolution lines say so; two to four
are a pick verdict; more than four show the first three, with the picker's
free text for another name; none asks for a new entry's name. Adding an entry is judged too: the run
makes the fallback call with `--new` (9.3), and its go carries what a first
visit's does. Pointers and `/orc-next` pass the name, so this picker is never
hit twice.

**Interview.** Both modes call upstream `grilling` and `domain-modeling`
through the Skill tool (both are model-invocable). `/orc-discuss` is the one
command that reads the registry whole: it writes it, and the interview treats
the locked ids as settled. Orc adds four things:

- Presentation. A question with a small set of clear answers goes through the
  native picker with the recommended answer first. Open questions stay prose.
- Coverage. The project interview settles requirements, architecture and the
  ordered roadmap of specs, foundations (CI, infra, data, test setup) before
  feature slices. The spec interview settles that spec's decisions, its test
  seams and its landing mode, a picker with the config default first.
- Pending decisions. In spec mode the entry's pending lines (8.1), read from
  where the verdict's `pending` names, come first, each a picker: lock it as
  a new id, superseding the id it went against when it names one, or reject
  it, which keeps what was written; any rework that needs is a new ticket.
- Locking. The proposal (every line this run would write, and the pending
  lines it resolves) sits inside one picker's question: "Lock and commit
  (Recommended)" or "Change something first". Nothing is written before that
  answer, since grilling acts only once the user confirms.

**Write, commit, push.** It locks on the default branch only (8), commits the
registry and the domain files it wrote (`docs: lock project requirements,
decisions and roadmap`, or `docs: lock <name> decisions`), and pushes as
`push` says. Before the commit it takes a fresh verdict in either mode, whose
registry problems, or `ignored-lines` stop, name any line the run wrote in a
shape the script does not take; the run corrects those and reports any other.
The line shapes are in `/orc-discuss`'s own skill file, the one place a run
learns them. Uncommitted registry or domain files are asked about before
either interview. A rejected or declined push leaves the rest of the run, the
pending cleanup and the pointer, as it is. Resolved pending lines leave the
record where it lives (8.1): in the lock commit when it is on the default
branch; in a commit `docs: resolve <name> pending decisions` on
`spec/<name>`, then back to the default branch, when it is on the spec branch
(`git switch` restores an `origin`-only one); by editing or deleting the
comment on GitHub. The pointer is `/orc-discuss <first entry>` after the
project interview, else the `next` of a verdict taken after the commit.

A project whose fog cannot be cleared in one session is a case for upstream's
`wayfinder`. Orc does not build on it by default, since it spreads decisions
over many sessions, which works against the speed goal. The project interview
offers it as an escape hatch, and so does a spec interview's first visit
(the verdict names the `wayfinder` heading), which asks which existing map,
if any, charts the entry, or offers charting when the entry looks too big
for one interview. Either reads the finished map's decisions into the
registry, a spec interview's as `-> spec <name>` decisions with
`(wayfinder <ref>)` after the gist. A
finished map comes back through `/orc-discuss`, never straight to `to-spec`
as upstream's `ask-matt` suggests, since its decisions would get no ids. The
effort is never named after a roadmap entry: its local tickets would sit in
`.scratch/<entry>/issues/`, where the script reads that entry's build
tickets.

### 7.3 `/orc-spec` and `/orc-tickets`

Both commit on the default branch only; their verdicts stop on any other
branch.

`/orc-spec` acts on a discussed entry with no `Spec:` line and follows
upstream `to-spec`. The verdict lists the ids that apply (the entry's
requirements and every decision linked to `spec <name>`, never a superseded
one) and counts the live project decisions (`-> project` and `-> wayfinder
<ticket>`), and the run fetches their lines, the project decisions' and the
entry's own lines through the lookup
(9.3). The brief carries those lines, never the registry file: it answers the
seam check from the `Seams:` line, asks for the ids to be cited (a
`Registry:` line first, then per story and decision), reads the ADRs the
lines link, and sends any choice the lines do not settle to Further Notes as
an open question. On GitHub the issue title starts with `<name>: `. It then
adds the `Spec:` and `Branch: spec/<name>` lines, commits `docs: add <name>
spec`, and pushes.

`/orc-tickets` acts on any entry with a `Spec:` line and follows upstream
`to-tickets`. The verdict lists the ids the spec cites, read from its
`Registry:` line, and the brief carries their lines from the lookup. It asks
for foundations first, numbers in that order, and a `Satisfies: <ids>` line
per ticket, together covering every id the spec cites. The breakdown is
approved in a picker holding all of it: "Approve", "Too coarse", "Too fine",
"Change something". On GitHub the tickets are sub-issues of the spec issue
with native blocking edges; locally they are
`.scratch/<name>/issues/<NN>-<slug>.md`, committed as `docs: add <name>
tickets` and pushed. A ticket added after landing is built and landed like
the first set (7.6).

Creating issues and pushing follow `push` (3.2). An existing spec or ticket
set is never rewritten or duplicated. A rerun's verdict reports what an
earlier run left (`resume` and `set`, 9.3: an open spec issue titled
`<name>: ` with no parent, or a spec file, and no `Spec:` line, since a
closed issue with that title ended an earlier use of the name; uncommitted lines or
files; tickets whose `Satisfies:` lines miss some of the spec's ids). The run
says whether it found a partial or a complete run and offers to finish a
partial one or to draft more tickets beside a complete one; uncommitted
tickets that leave cited ids uncovered are committed, and the missing ones
drafted, in the same run. On GitHub that question names each found issue's
number, title and author, taken from the verdict's `--json` form as data, and
recommends nothing, since anyone can file an issue with such a title. Ignored
issues (9.2) are named in every question, and when an entry has nothing else
the user chooses: a maintainer adopts them with the `orc-ticket` label, or
new tickets are filed beside them.

### 7.4 `/orc-build`

- No target, or a spec: builds the whole spec the way the config says.
  `implement-spec` runs tickets in parallel worktrees and reviews once on the
  spec branch; `implement` runs ticket by ticket with a review each.
- A ticket: follows upstream `implement` for that one ticket on the spec
  branch, once its blockers are built.

**Before it starts.** The verdict judges the stops of 9.3 in their order. The
run then asks, from the go's parameters: other dirty paths ask ("Stop so I can
commit or stash them" or "Build anyway and leave them out of every commit");
each leftover `worktree-agent-*` branch with commits the spec branch lacks
asks "Merge it", "Discard it" or "Stop". Merging runs `git merge --no-ff
--no-commit` on the spec branch and the test command, and commits only when
the tests pass (with `test` at `null` it asks "Merge untested" or "Stop"); a
conflict or a failure aborts the merge and stops. Discarding shows first what
it would lose (the branch's commits, and the modified or untracked files and
the lock of its worktree), then removes the worktree, unlocking it and forcing
only past the files it showed, and deletes the branch. An agent branch not
merged is never deleted by the cleanup, only named. A worktree that `git
worktree remove` refuses, because it holds files or because an implementer
that died left it locked, is never forced unseen, in the build's cleanup or
the landing's: the run asks "Remove it" or "Leave it", the question holding
its branch, its files and its lock line, and removing unlocks it and forces
only past the files shown. When every ticket is built, git does not record
whether the review ran, so the run asks "Review now" or "Skip to cleanup", and
that question is the start; a default branch that would conflict stops before
it, like a build (9.3). After any of these writes, the run takes a fresh
verdict.

**Start picker.** Last before any write, its question holds the resolution
lines: the target, the pins, the branch (existing, restored from `origin`, or
created from the default branch, and whether the default branch is merged in
first) and the tickets to build, built and landed. "Build it (Recommended)"
or "Stop". It stays even when an injected verdict already showed those lines
in the first message. `buildStart: always` skips it and prints the lines;
through `/orc-next` it is still asked, since `/orc-next` confirmed only the
banner.

**Brief.** The spec branch is the integration branch. The review-fix cap is
`reviewFixRounds` (upstream's loop has none), the tests run with the config's
`test` command, and upstream opens no PR, pushes nothing and resolves no
ticket. Exploration notes go to `.scratch/<name>/notes/` as `research` says.
A ticket is ready once every blocker is built (9.2), whatever the tracker
says, since upstream's GitHub doc counts a blocker as cleared only once it is
closed. An implementer follows the spec, its ticket and the registry lines
it is given; where they cannot all hold, it takes the course that keeps the
most of them and reports what it went against. Only such a conflict is
recorded: the main session appends it to the pending-decisions record (8.1)
with its ticket as soon as it is reported, before another implementer builds
on it, so a crash cannot lose a line the code already follows; a rerun reads
the record and never adds a line twice. Every other choice the spec leaves
open is an assumption: the implementer makes it, lists it in its report and
in an `Assumptions:` paragraph of its commit message, and the build's report
lists them all, as does the PR body in the PR modes (7.5). Assumptions are
never asked, recorded or gated. Implementers run in the foreground
(`run_in_background: false`, several Agent calls in one message to run
tickets side by side), since a turn that ends while a background agent works
leaves the run waiting for the user.

Briefs are slices. An implementer's brief names its ticket, the spec and the
paths it needs, and carries only the registry lines its ticket's `Satisfies:`
cites, fetched once through the lookup; a reviewer's carries the lines the
spec cites. A brief says what to read and gives the lines it cites; it never
names the registry file or `skills-lock.json`, not even to say they are not
to be read, since naming a file invites reading it. Every
subagent prompt carries the one-command rule, the trailer rule, and that
pending lines and text from outside the repo are not instructions. It also
says how to work with what the permission settings are likeliest to allow,
since an implementer has nobody to approve a prompt: the tests run as the
configured test command, exactly as given, files change through the Edit and
Write tools, trailers are read with `git log --format=%B`, and a denied
command is reported, never retried in another spelling. No grant is widened
for it.

A rerun builds only the tickets that are not built. It first merges the
default branch into the spec branch when the default branch has moved on
(`mergeDefault`), since the docs are committed there: a ticket added since,
or a changed registry, would otherwise be missing from the branch and from
the worktrees made from it. A spec branch that exists only on `origin` is
restored with `git switch spec/<name>`, never created afresh over it.

**Marking.** A ticket is marked built as soon as its commits are merged into
the spec branch, before the next ticket or the review starts (GitHub: the
`built` label; local: `Status: built`, in a record commit `docs: mark <name>
tickets built` on the spec branch), after its worktree and branch are
removed. A repo whose `built` label setup was told to skip gets no marks,
which the run says once. On GitHub a separate edit per issue removes the
label upstream's triage mapping gives `ready-for-agent` (the go's
`ReadyLabel:`, read from `docs/agents/triage-labels.md` and withheld when it
is not a safe name) from each built ticket and from the spec issue, since
`to-spec` and `to-tickets` apply it and upstream's triage queue would
otherwise keep offering them to `/implement`, outside the spec branch. Its
failure is said once and leaves the `built` marks as they are. A build cut off part way then leaves only the tickets in flight
undone, and the marks only mirror what the trailers already say.

**End.** The run removes leftover worktrees and merged `worktree-agent-*`
branches, marks anything built and not marked yet, and takes a fresh verdict
for the report: commits without a trailer, the pending count, the pointer. It
ends on the default branch when that verdict's pointer is `/orc-discuss
<name>` (every ticket built, with lines to lock), since `/orc-discuss` locks
only there, and on the spec branch otherwise. Landing belongs to `/orc-land`.

### 7.5 `/orc-land`

`/orc-land` with an `origin` (the verdict's `origin`) fetches it before it
acts on any injected outcome, a stop included, and judges by the verdict of
the fallback call after the fetch (9.4), since the injected verdict predates
the fetch. That call holds what the user typed and nothing else: a bare run's
stays bare although the injected verdict names an entry, since only a bare
call can return the leftovers pick (3.3), and every later call names the
entry its go is for. A PR merged elsewhere reads as unknown until its merge commit is
fetched (9.2), so finishing a `pr-human` landing, or rerunning `pr-agent`
after a crash at the merge, takes nothing but `/orc-land` again.

Before anything is pushed or merged, the verdict stops:

- on a linked worktree, since landing switches to the default branch, and on
  another worktree holding the spec branch or the default branch;
- on a state other than `built`, `in-review`, `cleanup-pending` or `landed`,
  with its `next`: a ticket that is not built is listed, since a partial
  landing would leave the entry neither built nor landed, and a squashed or
  rebased landing (9.2) stops loudly rather than pass as landed;
- on a dirty tree;
- in PR modes, without a `github.com` remote, under `push: never`, or when
  the repo forbids merge commits;
- on a spec branch diverged from `origin/spec/<name>`;
- when a merge the landing makes first would conflict: the default branch
  into the spec branch, or `origin/<default>` into a diverged default
  branch (9.2);
- in `pr-human` with an open PR and nothing new to push, saying the PR is
  waiting for review.

`cleanup-pending` and `landed` go straight to the cleanup below, which deletes
a merged branch left behind or reports the entry as already landed. With no
argument, a landed entry with leftovers (3.3) comes as a pick while another
entry has not landed: the question names both entries and what is left, and
offers "Finish <name>" (the cleanup, whose pointer then names the next entry)
or "Go on to <next>" (the leftovers stay a note in `/orc`). So after a human
merged the PR, `/orc-land` alone finishes the entry. Otherwise the run asks,
in this order:

1. Pending decisions (8.1), with the count in the question: "Lock them now
   (Recommended)" (switches to the default branch, where `/orc-discuss`
   locks, and stops with `/orc-discuss <name>`), "Land anyway" (the
   lines travel with the merge) or "Stop".
2. No test command configured: it says so plainly and asks "Stop and set
   one (Recommended)" or "Land untested". Stopping switches to the default
   branch, where the script reads the config, and the pointer says to set
   `test` in `docs/orc/config.json` there, commit it and rerun
   `/orc-land <name>`. Untested in `pr-agent` on a repo with no CI means no
   test evidence at all, and the landing picker says so.
3. A default branch both ahead of and behind `origin/<default>`, with the
   commits on each side in the question: "Merge origin/<default> into
   <default> (Recommended)" or "Stop". The merge is a merge commit, a
   conflict aborts it and stops, and nothing is ever rebased or forced.

It then prepares the branch: restores a spec branch that exists only on
`origin` with `git switch spec/<name>`, fast-forwards what is behind its
remote, merges the default branch in when it has moved on, so the branch
tested is the tree that lands, and with the local tracker commits
`Status: resolved` on the spec and every ticket (`docs: resolve <name>
tickets`) on the spec branch, so the commit tested is the one that lands.
A rerun skips that commit when the spec branch already reads every file
resolved (`toResolve`). It notes the spec branch's head as the commit to
land, runs the `test` command on it, and a failure stops. Only that commit
is merged, tested or landed untested: `pr-agent` waits for checks on it and
merges with `--match-head-commit` on it.

The landing picker's question holds the resolution lines, the test result,
whether the default branch was merged in, the commits to land and anything
else the push carries, and every outward step by name.

| Mode | Steps | Human waits for |
|---|---|---|
| `local-merge` | Merge into the default branch with a merge commit, push it as `push` says, resolve the tickets, remove the branch and worktrees | nothing |
| `pr-agent` | Push, open a PR with the body from upstream `pr` and the build's assumptions (the commits' `Assumptions:` paragraphs), wait for the checks on the tested commit (or rely on the local run when the repo has no CI), merge with a merge commit pinned to that commit, clean up. Stop loudly on a failed check, or one that was expected and never reported | nothing |
| `pr-human` | Push, open the PR ready for review, stop. A later `/orc-land` on the merged PR does the cleanup | the review |

Merge commits are used throughout, since a squash drops the per-commit
trailers and with them the ticket-level traceability. Never `--auto`, never a
force push, never a merge on a failed test run or check or on a check that
was expected and never reported, and never an untested merge unless the user
chose "Land untested".

**Cleanup.** The run fetches, brings the local default branch up to
`origin/<default>` (asking as in the third question when they diverged), and
takes a fresh verdict: an entry that has not landed stops loudly. Tickets are
resolved the way the tracker closes work: a comment and `gh issue close` for
each GitHub issue still open, the `Status:` line for local markdown. Then the
default branch is pushed and `origin/spec/<name>` deleted as `push` and the
landing answer say, and the local branch and worktrees are removed, a
worktree git refuses as 7.4 says (asked, never forced unseen). A spec branch
is deleted only once git shows it merged; one holding commits the default
branch lacks is left and named.

UAT (v1.1) sits between build and land in every mode.

### 7.6 `/orc` and upstream resolution

`/orc` prints the report its verdict carries, unchanged: the roadmap with a
state per entry; for the target its tickets by reference (landed, built, in
progress, ready, blocked), the commits on its spec branch without a ticket
trailer by short SHA, a `Gh:` line when the tracker or a PR landing needs
`gh` and it is missing, logged out or failing (its pointer then names the
fix), "N decisions to lock", its landing mode and notes;
leftover worktrees; the commits the local default branch holds that
`origin/<default>` (as last fetched) lacks; every registry problem by line
number and kind; the next command with the reason. With no argument it makes
no tool call at all: banner, report and pointer come from the injected
verdict. It changes nothing. It stops only where every verdict does first
(9.3), on no config among them, pointing at `/orc-setup`; the registry,
roadmap, `gh` and lookup problems the step commands stop on after those are
lines of its report. Off the main flow, it points at upstream's `/ask-matt`.

| State | Meaning | Next |
|---|---|---|
| `not-started` | no `Landing:` line | `/orc-discuss <name>` |
| `discussed` | `Landing:`, no `Spec:` | `/orc-spec <name>`, in the interview's session |
| `specced` | `Spec:`, no tickets | `/orc-tickets <name>`; with ignored issues, manual: adopt them with `orc-ticket` or file tickets beside them |
| `ticketed`, `building` | tickets, none or some built | `/orc-build <name>` after `/clear` (the reason names the spec branch only when it exists) |
| `built` | every ticket built, no open PR | `/orc-land <name>`, or `/orc-discuss <name>` first with pending decisions |
| `in-review` | every ticket built, an open PR | `/orc-land <name>`; a `wait` in `pr-human` |
| `cleanup-pending` | landed, tracker items still open | `/orc-land <name>` |
| `landed` | landed and resolved: finished | the next entry's step |
| `squashed` | squashed or rebased (9.2) | manual: check the landing by hand |
| `unknown` | a lookup failed | manual: fix what the note names |
| `dropped` | a `Dropped:` line | skipped |

A landed ticket counts as built, so an entry given a new ticket after landing
reads `building` and its next step is `/orc-build`. A roadmap line the
registry cannot take as an entry (9.2) holds the next step, a manual one,
wherever it sits, and every verdict but `/orc`'s and `/orc-setup`'s stops on
it, listing every such line. A spec branch left behind after landing, and
pending lines left on a landed entry, are notes on that entry, never its next
step.

**Upstream resolution.** Each wrapper names one or two upstream skills, and
the resolved paths live in the config. When a name is missing after an update,
setup reads upstream's `ask-matt` skill in the run's clone (upstream's own map
of the flow) to find the successor, proposes it in a picker, and stores the
answer. A rename therefore costs one confirmation in the target repo and a
one-line change here. Until then the role is `null`. `/orc-spec` and
`/orc-tickets`, which have no reference file, then stop once the run would
need the skill (a record to commit, or a complete ticket set, needs none),
naming the upstream command to type and pointing at `/orc-setup`. `/orc-setup`
skips upstream's setup with a line saying what to type once it resolves. The
other wrappers' verdicts name their `null-role` section only while the run
needs the role (`/orc-build` while tickets are left to build, `/orc-land` in a
PR mode while the PR body is still to write, never for the cleanup), and the
skill follows it before any write, saying the same in its own words.

What this cannot absorb is a change in what an upstream skill does. The
update step shows that diff; a human has to judge it.

## 8. Registry

`docs/orc/registry.md` is an index of ids. It gists and links; the detail
lives in the ADR or the spec and is never copied.

```markdown
## Requirements
- REQ-01: <one-line gist> (spec: auth)

## Decisions
- D-01: <one-line gist> -> docs/adr/0003-<slug>.md
- D-02: <one-line gist> -> spec auth
- D-03: <one-line gist> (supersedes D-02) -> spec auth

## Roadmap
1. auth
   - Spec: #12            (or .scratch/auth/spec.md)
   - Branch: spec/auth
   - Seams: <where the tests attach>
   - Landing: pr-agent
2. billing
   - Dropped: <one-line reason>
3. search
   - Delivers: REQ-01
```

Ids are `REQ-` or `D-` with at least two digits, append-only, never
renumbered or reused. No status is stored: the script derives it from the
tracker and git. These rules keep the file append-only and parseable:

- A decision links to its ADR (`-> docs/adr/...`), to `-> project` when it
  holds for every spec, to `-> spec <name>` when one entry applies it, or to
  `-> wayfinder <ticket>` when the project interview read it from a wayfinder
  map, which counts as a project decision. A map charted for one entry gives
  `-> spec <name>` decisions, the ticket named at the end of the gist. A
  requirement names its entries in `(spec: ...)`.
- A correction is a new id with `(supersedes <id>)` after its gist; the old
  line stays as it is and does not apply from then on. A requirement that
  only gains a delivering entry is not a correction: that entry adds a
  `Delivers: REQ-n` line, so citations of the id stay valid.
- Roadmap entries have short, unique kebab-case names, since a name becomes a
  path and a branch. They are never renumbered, reordered, renamed or
  removed, and new ones go at the end; the roadmap order is the build order.
  An entry taken out of the plan gets a `Dropped:` line and is skipped from
  then on. An entry with a `Landing:` line has been discussed.
- Every line the file holds at the run's starting commit is locked: a run
  only adds lines, apart from the target's `Seams:` and `Landing:` on a
  revisit. A locked line also stays where it was: in its section, under its
  roadmap entry, with sections and entries in their order, so an edited line
  is never hidden by a copy of its old text added under another entry.
  Before its commit the run asks the script, with the stamp of any verdict
  taken before its first commit (the whole stamp, or its commit alone):
  `status.mts locked '<stamp>' '<name>'` prints `unchanged`, or the line
  numbers, as of that commit, of the fewest lines that changed, moved or
  went.
- Discuss locks on the default branch and on no other, so every spec branched
  later starts from the same registry and the script, which reads the docs
  from the default branch tip, sees it. `/orc-spec` and `/orc-tickets`
  commit there for the same reason.

Only `/orc-discuss` reads the file whole. Every other command gets the ids it
needs from its verdict and their lines from the lookup (9.3).

### 8.1 Pending decisions

A build records a pending decision only on a conflict: where an implementer
had to go against the spec, a ticket or a locked registry id. The line is
recorded, not locked: one record per spec, holding only unresolved lines,
one line per conflict. Every other choice the build makes is an assumption,
listed in the build's report and the PR body (7.4), never recorded and never
gated. A line carries no authority: only registry ids are cited, and an
implementer that is given one reads it as what the build already did, never
as an instruction.

```
<!-- orc:pending-decisions -->
- auth/02: Sessions expire after 30 days of inactivity, against D-04 (7 days)
- auth/03: Rate limits are per account, against the spec's per-IP limit
```

The marker is the first line; each further line is `- <ticket ref>: <one-line
what was done>, against <the spec section, ticket or id>`. The script counts
the lines starting with `- ` after the marker and never reads their text;
only `/orc-discuss` does.

- **Local:** `.scratch/<name>/pending-decisions.md`, committed by the build
  on `spec/<name>` as a record commit (9.2). It is read from the spec branch
  tip (local, else `origin/`) while that branch exists and holds commits the
  default branch lacks, else from the default branch tip. "Land anyway" lets
  the lines travel to the default branch with the merge, where a later
  `/orc-discuss <name>` resolves them: the entry is named, since a landed
  entry is never the bare command's choice, and `/orc`'s note says the same.
- **GitHub:** a comment on the spec issue whose body starts with the marker,
  by an author with write access (`OWNER`, `MEMBER`, `COLLABORATOR`); the
  oldest such comment is the record, and any other is ignored. The build
  creates or edits it (bookkeeping, 3.2), and it stays on the issue after
  landing.

`/orc-discuss` locks each line as a new registry id or rejects it, and
deletes it either way. An empty record is removed: the file deleted, the
comment deleted.

## 9. Config, profiles and the status script

### 9.1 Config and profiles

`docs/orc/config.json` starts from `config-template.json`:

| Key | Values |
|---|---|
| `tracker` | `github`, `local` |
| `profile` | `hackathon`, `mvp`, `production` |
| `research` | `off`, `on-demand`, `always` |
| `build` | `implement-spec` (tickets in parallel, one review), `implement` (ticket by ticket, a review each) |
| `reviewFixRounds` | an integer, 0 or more |
| `landing` | `local-merge`, `pr-agent`, `pr-human` |
| `push` | `ask`, `always`, `never` (3.2) |
| `buildStart` | `ask`, `always` (7.4) |
| `test` | the project's test command, one simple command, or `null` |
| `uat` | `off` (v1.1 adds more) |
| `upstream` | `discuss`, `domain`, `spec`, `tickets`, `buildSpec`, `buildTicket`, `land`, `map`, `setup`, each a vendored `SKILL.md` path, or `null` when unresolved |

| Profile | research | build | reviewFixRounds | landing | buildStart |
|---|---|---|---|---|---|
| hackathon | off | implement-spec | 1 | local-merge | always |
| mvp | always | implement-spec | 2 | local-merge | ask |
| production | always | implement | 2 | pr-human | ask |

`push` starts as `ask` and `uat` as `off` in every profile, and `test` comes
from setup's question. Upstream skills take no config, so these knobs steer
only orc's briefs and defaults. Every knob can be changed in the file at any
time and applies from the next command. `landing` is the default the spec
interview offers first; the roadmap entry holds the choice for that spec. A
missing key or a value outside these is a config every verdict but
`/orc-setup`'s stops on, with `/orc-setup` as the next step.

### 9.2 Facts and rules

`status.mts` is a single typed script, run with Node's native type stripping,
with no dependencies. The `.mts` extension keeps it an ES module in every
target repo, since Node loads a `.ts` file as CommonJS under a root
`package.json` with `"type": "commonjs"`, and its first `import` then fails.
It never fetches or writes. It finds the checkout root with `git rev-parse
--show-toplevel` from whatever directory it runs in, and reads that checkout
only when it shares its repository with the checkout the script itself lives
in (`git rev-parse --git-common-dir`, compared by device and inode, which
hold through a symlink and on a filesystem that folds letter case), so a linked
worktree of it counts and nothing else does: git runs the commands a
repository's own config names (a merge driver in `merge-tree`, a clean
filter in `status`), so another repository, such as a nested clone, a
submodule or an extracted archive that ships its `.git/`, is a stop
(`other-repo`) before any other git call there. The working directory
alone names that repository: no `git` or `gh` the script starts inherits
the variables that select a repository, its index or its config (`GIT_DIR`,
`GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE` and the rest of `git
rev-parse --local-env-vars`), since `GIT_DIR` set in the session would make
both sides of the comparison answer the same foreign repository. Every `git`
command runs with `--no-optional-locks`, so `git status` never refreshes the index or
takes `index.lock` while the session's own git needs it, with
`core.fsmonitor=false`, so it starts no fsmonitor command, and with
`safe.bareRepository=explicit`, so a bare repository found from the current
directory is never read: a checkout can hold one as plain files, whose config
git would follow. From inside one the script reports that it is not in a
repository. Read-only therefore means: no ref, index, file or tracker state
changes, and the only commands git runs on the script's behalf are those the
checkout's own files and local git config name, which the session's own `git`
runs anyway. Tickets come from one
small reader interface with two implementations, `gh` and `.scratch/` files,
and `node:test` covers it against fixture repos for both trackers. It
implements these rules and those of 3.3, which no skill restates:

- **Default branch:** what `origin/HEAD` names, else `main`, else `master`.
- **Docs** (config, registry, local tickets) come from the working tree on
  the default branch, else from the default branch tip (local, else
  `origin/`), so a spec branch never shows stale docs. The pending record is
  the one exception (8.1). Only a path that does not exist is missing: a
  file that cannot be read, or that is a folder or anything but a regular
  file, is unreadable. An unreadable config, registry or `skills-lock.json`
  is a stop of kind `error`, never the first run or the project interview
  that would write over it, and an unreadable ticket, spec or pending file
  is a failed lookup.
- **Tickets.** Local: the files in `.scratch/<name>/issues/`. GitHub: the spec
  issue's sub-issues, else upstream's fallback, the issues whose body says
  `Part of #<n>`. In the fallback an issue counts when its author has write
  access or a maintainer added the `orc-ticket` label. GitHub's author
  association stands in for write access (`OWNER`, `MEMBER`, `COLLABORATOR`),
  so in an organization that gives its members or outside collaborators less
  than write on the repo, their issues count too. The others are **ignored
  issues**, named by number with their authors as data, never built, commented
  on or closed. A lookup that may have been cut short fails, never shows
  fewer.
- **Trailers.** A ticket's commits carry `Refs: <ticket ref>`, compared as a
  whole value (`#12` never counts as `#1`). An entry's **range** is the
  commits on `spec/<name>` (else `origin/spec/<name>`) that neither the
  default branch nor `origin/<default>` holds.
- **Built:** the ticket's reference is on the range, or the ticket has
  landed. **Ready:** every blocker built. **In progress:** not built, with its
  reference on a `worktree-agent-*` branch the default branch lacks.
- **Landed:** the ticket's reference is on a commit reachable from the
  default branch (local, or `origin/<default>` as last fetched) and not on
  the range, so the spec branch's own ticket commits are ancestors of the
  default branch. Once the branch is gone the range is empty and
  reachability decides, with the PR check below on GitHub. An entry has
  landed when it has a `Spec:` line, at least one ticket, and every ticket
  has landed, after a merge commit or a fast-forward, whatever its subject.
- **Squashed or rebased**, checked before landed, since a squash message can
  still carry every trailer: a merged spec-branch PR whose merge commit does
  not have two parents, or a ticket on the range whose reference reached the
  default branch on a commit the spec branch does not hold. A merged PR whose
  merge commit is not fetched is unknown, with `/orc-land <name>` as its
  next, since that run fetches before it judges. A PR merged with a merge commit
  brings every commit it carried, so a ticket not landed after it is either
  built since (land again) or open (build it).
- **Resolved:** a closed issue, or a `Status:` of `resolved`, `closed` or
  `done`. `built` and `Status: built` never read as resolved or as built.
- **Record commits** change only files under `.scratch/<name>/` (notes,
  pending decisions, ticket statuses, the resolution). They carry no trailer
  and are never reported as missing one.
- **GitHub reads** go through `gh api graphql`, batched: one query for every
  entry's spec issue (state and sub-issues), every spec branch's open and
  merged PRs (by head branch) and the repo's `mergeCommitAllowed` and default
  branch; one for the
  `Part of` searches of specs with no sub-issues; one for the target in detail
  (the spec body's `Registry:` line, its tickets' bodies and blockers, its
  comments). `{owner}` and `{repo}` reach the query as `-F` variables, which
  gh fills in; page cursors go as `-f`. Every list is read to its end: each
  connection (sub-issues, blockers, labels, comments, PRs, searches) is paged
  100 at a time, at most 20 pages after the first, and one that still lists
  fewer than its count (a search past GitHub's 1,000 results, a failed page)
  is a failed lookup, never fewer. Comments come oldest first, so a marked
  comment among those read is the pending record even when more follow. A
  failed lookup of the tickets, their blockers, the pending record or the PRs
  makes the entry `unknown`, which every step command stops on and `/orc`
  reports. gh's state comes from those calls (exit 127: not installed, exit 4:
  not logged in), else from `gh auth status`.
- **A spec branch's PRs** are those from this repository's `spec/<name>`
  into GitHub's default branch, open or merged: a fork's PR that shares the
  name, a PR into any other branch and a closed one land nothing. An open PR's
  head is whatever `origin/spec/<name>` holds now, so it is always the
  branch's. A merged PR that either spec branch (local or `origin`'s) finds
  to have landed an earlier use of the name is left out. When git has the PR's head commit, the PR is the branch's own while the
  branch holds that head on its first-parent history, as it holds every
  commit made on it, merges of the default branch into it included, or is
  still behind it: an earlier use's head is only a side parent of its merge,
  or not in the branch at all. When git lacks the head, a branch that holds
  the PR's merge commit was cut or updated from a default branch that held
  it. Once both branches are gone every merged PR counts, so a squash is
  still caught. GitHub's default branch must be the one the local default branch
  rule names: after a rename a clone keeps its old `origin/HEAD`, so an entry
  whose PRs are read is `unknown` until `git remote set-head origin -a`.
- **Ticket targets.** `<name>/<NN>` and `#<n>` name the entry whose tickets
  hold them, from the same reads; nothing else is looked up.
- **Roadmap lines.** A line whose name is not kebab-case, or repeats an
  earlier entry's name, is not an entry: a registry problem that ignores it,
  never a target, a path or a branch. A registry without a `## Roadmap`
  heading is broken, never an empty roadmap. Lines may end in `\r\n`.
- **Clean tree.** The orc paths are `.claude/skills`, `skills-lock.json`,
  `.claude/rules`, `.claude/settings.json`, `docs/orc` and `docs/agents`, and
  `.scratch` with the local tracker; a worktree would not see them
  uncommitted.
- **Upstream skills.** A role's skill is the folder of its config path; its
  pin is that skill's commit in `skills-lock.json`; it is user-invoked when
  its frontmatter has `disable-model-invocation: true`.
- A spec branch left behind after landing is a note: when merged, naming
  `/orc-land <name>`, whose cleanup deletes it (for `origin`'s under `push:
  never`, the `git push origin --delete` to run by hand instead); otherwise,
  how many commits it holds that never landed.
- **Conflicts ahead.** For the target only, when the default branch holds
  commits its spec branch lacks, `git merge-tree --write-tree --quiet` judges
  whether merging the default branch in would conflict; when the local default
  branch has diverged from `origin/<default>`, the same check judges that
  merge. The check moves no ref, index or file and keeps the objects it makes
  in a temporary store, and a timeout or an error reads as unknown; after one
  timeout the other check is skipped as unknown. A conflict is a note and a
  `/orc` pointer to merge by hand, the stop of `/orc-build` (the build and the
  review both merge the default branch in first) and of `/orc-land` (phase
  `land`), and the `Diverged:` line of the report, so `/orc` after a merge
  stopped by a conflict says what is in the way.
- **Small facts.** The remote is `github` when `origin`'s URL holds
  `github.com`, `other` for any other `origin`, `none` without one. The test
  command candidates are `npm test` when `package.json` has a `test` script and
  `make test` when the Makefile has a `test` target. The domain files a lock
  commits are every `GLOSSARY.md`, `GLOSSARY-MAP.md` and path under
  `docs/adr/`. `pr-human` has nothing new to push when `spec/<name>` is not
  ahead of `origin/spec/<name>`, or exists only there. The session directory
  of `orc-setup` is the script's working directory, compared with the
  checkout root by real path.

### 9.3 The verdict contract

Every command takes its facts from one call of the script, in one of these
forms (the directory is the calling skill's, 9.4):

```
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" <command> --core              the injected form (orc: without --core)
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" <command> '<target>'          the fallback with a typed target
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-discuss '<name>' --new    the fallback for a new roadmap entry
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" registry '<key>' ['<key>']    registry lines by id or entry name
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" registry --project           every live project decision
node "${CLAUDE_SKILL_DIR}/../orc/status.mts" locked '<stamp>' ['<entry>']  the locked-lines check of section 8
```

The skills' permission hook (9.4) is a separate file beside the script,
`hook.mts`, which reads a `PreToolUse` call on stdin and prints an allow
decision or nothing; no run calls it, and the script has no hook form.

`<command>` is `orc`, `orc-next`, `orc-setup`, `orc-discuss`, `orc-spec`,
`orc-tickets`, `orc-build` or `orc-land`, always first, so an entry may share
a command's name. `--json` after any form prints the same verdict as JSON
with its data fields filled in (9.5); without it the script prints the text
form, which leaves every data field out. `--core` appends the shared core
(5.1) to the text form, after every verdict field; a fallback call passes it
only when the run has no verdict yet (9.4 case 4) or after a compaction, so
a session does not pay for the core twice. `/orc`'s report and `/orc-next`'s
proposal are the go parameters of their own verdicts.

A **verdict** has one of three outcomes:

- **Stop:** the kind, the message and the pointer. The run prints the
  message and the pointer as they are and ends. A message after the target
  is resolved opens with the resolution lines.
- **Pick:** the target needs the user: why (`none`, `ambiguous`, `dropped`,
  `choose`, `new-entry`, `leftovers`), the candidates (all of two to four,
  else the first three with free text), and whether free text may name
  another. `leftovers` is a bare `/orc-land`'s choice (3.3): the landed entry
  first, then the next one, with what is left (`leftover`). The run asks the
  picker, the question saying why, then makes the fallback call with the
  chosen name. Choosing to add a new entry (`offerAdd`, or a name typed when
  no entry is eligible) is the call with `--new`, whose go is the new entry's
  first visit (`visit: new`), numbered after the roadmap's last entry and
  carrying every field a first visit does. A name the roadmap already holds
  resolves as usual, and one that cannot be an entry name is the `new-entry`
  pick again.
- **Go:** the parameters the command acts on.

Every verdict also carries the banner, the resolution lines once a target is
resolved, the registry ids relevant to the target, the upstream skills the
command uses (role, skill, path, pin, and whether it is called through the
Skill tool or read), the reference sections to follow, and the stamp
(HEAD's first 7 characters and the time), and whether the repo has an
`origin` remote.

**Stops every verdict judges first,** in this order: not a git repository;
another repository than the one the script lives in (9.2); a Node below the floor of section 4 that still loads the script; then, for
every command but `orc-setup`, no commits yet, no default branch, a config or
`skills-lock.json` that exists but cannot be read (9.2), no config, and a
config with a missing key or an unknown value. The step commands and
`orc-next` then stop on: a registry that cannot be read; no registry
(`orc-discuss` takes it as project mode instead); a registry without `##
Roadmap`; roadmap lines that are not entries, every one listed by line number
and kind; `gh` missing or logged out where the tracker or the landing mode
needs it. Then the target resolves (3.3), as a pick when it needs the user,
and a target whose state is `unknown` because a lookup failed is a stop.
`orc` reports all of these as part of its report (7.6).

| Command | Stops after those, in order | A go carries |
|---|---|---|
| `orc-setup` | the session directory is not the checkout root, where setup writes; a config, registry or `skills-lock.json` that exists but cannot be read | `run` (first or update), the current config values, the keys it lacks and those with unknown values, `trackerLocked` (a `Spec:` line exists), the remote (`github`, `other`, `none`), `gh`, the test command candidates (data), the skills vendored from upstream (`skills-lock.json` entries whose source is `mattpocock/skills`; any other pack's are left alone) with their whole commits, since `skills add` takes no short one. Its `upstream` is the config's `setup` role, or on a first run the template's skill once it is vendored. Reference: `update` |
| `orc-discuss` | HEAD is not on the default branch, detached included; the pending record is on the spec branch and the tree is dirty beyond the files a lock commits, or another worktree holds that branch | `mode` (project or spec), the entry, `visit` (first, revisit, or new after `--new`), tracker, `push`, the config's `landing` (the spec interview's first option), `pending` (count and where: ref and path, or comment id), the remote, whether the registry or the domain files hold uncommitted changes (the paths are data), the registry problems by line and kind. Reference: `project-interview`, `wayfinder` (a spec interview's first visit), `pending-on-branch`, `null-role` |
| `orc-spec` | HEAD is not on the default branch; an uncommitted registry change other than `Spec:` and `Branch:` lines under the target, which are a resume; a state other than `discussed`, with its `next`; an unresolved `spec` role (`null-role`, naming the upstream command) | the entry, tracker, `push`, `resume` (`none`, `commit-record`, or `found` with the spec references an earlier run may have left; their titles and authors are data), the ids that apply, the count of live project decisions (`-> project` and `-> wayfinder`), `triageLabels` and `byHand` (3.2) |
| `orc-tickets` | HEAD is not on the default branch; the entry has no `Spec:` line, with its `next`; an unresolved `tickets` role, unless the set is complete or uncommitted with every cited id covered (`null-role`, naming the upstream command) | the entry and spec reference, tracker, `push`, the ids the spec cites, `set` (`none`, `complete`, `partial`, `uncommitted`, `ignored-only`) with each existing ticket's reference and `Satisfies:` ids, the cited ids no ticket covers, the ignored issues by reference (authors are data), `triageLabels` and `byHand` (3.2) |
| `orc-build` | a state other than `ticketed`, `building`, `built` or `in-review`, with its `next`; a ticket target with a blocker that is not built, pointing at `/orc-build <blocker>`; another worktree holding the spec branch; dirty orc paths, named by the fixed list of 9.2; a spec branch the default branch would merge into with a conflict (`conflict`, naming both branches and pointing at the hand merge), judged for every phase but `cleanup`, so with every ticket built it stops before the review is offered | the entry and ticket, `phase` (`build`, `review-ask`, or `cleanup` for a ticket already built or landed), the build mode, the tickets to build (reference, `Satisfies:` ids, blockers; the local file path is data), the built and landed references, the branch (`local`, `restore` from `origin`, `create`), `mergeDefault`, leftover `worktree-agent-*` branches with their unmerged counts (the names are data), other dirty paths (data), `reviewFixRounds`, `research`, `test`, `buildStart`, the default branch's name, `pending` (count and where, as for `orc-discuss`), and with the local tracker `toMark`: the built tickets whose files on the spec branch do not read `built` yet, so a rerun never repeats the mark commit, and on GitHub `readyLabel`: the label `docs/agents/triage-labels.md` gives `ready-for-agent`, removed with each `built` mark. Reference: `agent-branches`, `review-only`, `notes`, `null-role` (phase `build` only) |
| `orc-land` | with no argument, the `leftovers` pick (3.3) comes first; a linked worktree; another worktree holding the spec or the default branch; a state other than `built`, `in-review`, `cleanup-pending` or `landed`, with its `next` and the unbuilt tickets listed; a dirty tree; in a PR mode, no `github.com` remote, `push: never`, or a repo that forbids merge commits (`mergeCommitAllowed`); a spec branch both ahead of and behind `origin/spec/<name>`; in phase `land`, a merge it makes first that would conflict (the default branch into the spec branch, or `origin/<default>` into a diverged default branch: `conflict`); `pr-human` with an open PR and nothing new to push (a `wait`) | the entry, mode and its source, `push`, `phase` (`land`, or `cleanup` for `cleanup-pending` and `landed`), the ticket references, the unresolved tracker items, with the local tracker in phase `land` `toResolve` (the spec and tickets whose files on the spec branch, as the run lands it, do not read resolved yet, so a rerun never repeats the resolve commit), the spec branch (local, remote, ahead, behind, commits of the default branch it lacks), the default branch's ahead and behind against `origin/<default>`, the PR (number, state, draft), the pending count, `test`, the remote. Reference: `pr-modes`, `diverged`, `null-role` (phase `land` in a PR mode only) |
| `orc` | none: it stops only on those every verdict judges first, a missing config among them, and reports the registry, roadmap, `gh` and lookup ones (7.6) | the report of 7.6, title-free; with `--json`, the `Status` of 9.5 |
| `orc-next` | the next step is `manual`, its reason as the message | the proposed step (command, reason, kind) and the proposed command's own verdict for its entry |

The **ids** a verdict names: for `orc-spec` the entry's live requirements and
every live decision linked to `spec <name>`, with the live project
decisions (`-> project` and `-> wayfinder <ticket>`) as a count
(`projectDecisions`), since they grow with the project and a verdict does
not; for `orc-tickets` and `orc-build` the ids the spec's
`Registry:` line cites, and per ticket its `Satisfies:` ids; none for the
others. `orc-discuss` reads the whole registry and needs none.

The **lookup** prints, for each key, the registry line of that id exactly as
the file holds it, with `(superseded by <id>)` appended when a later id
supersedes it, or the roadmap block of that entry; a key the registry lacks
prints `<key>: not in the registry`. `--project` adds the line of every live
project decision. Its output is data, so it is only ever a tool call.

A check that belongs to the moment of an action stays in the skill: a push's
result, a PR's checks and whether a workflow is expected on the tested
commit, a merge conflict, a test run. A run that has changed anything takes a
fresh verdict instead of reasoning about the result. The verdict a run takes
for its pointer, after its last write, can be a stop. A `state` stop names
the step the run's work leads to; any other kind concerns something the run
did not do, so the run says in one plain line that its own work is done and
what the stop is about, then ends with the pointer, never cut short before
its own bookkeeping.

### 9.4 Delivery

Each skill gets its verdict in one of two ways with the same command line,
so the script is the one loader for both.

**Injection.** Every `SKILL.md` holds one fixed, argument-free injected
command, which Claude Code runs at invocation and splices into the skill in
its place:

```
---
name: orc-build
description: "(GSD: execute-phase) ..."
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../orc/status.mts" *)
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(node *)"
          command: '[ -n "$CLAUDE_PROJECT_DIR" ] && cd -P "$CLAUDE_PROJECT_DIR" && up="$(git -c safe.bareRepository=explicit rev-parse --show-cdup)" && cd "./$up" && [ -f .claude/skills/orc/hook.mts ] && node ./.claude/skills/orc/hook.mts'
---
...
!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-build --core`
```

These rules are normative, each for the reason given:

- No `$ARGUMENTS`, `$N` or named argument ever appears inside an injected
  command, since substitution is textual and every quoting form broke in the
  spike. Arguments appear in prose only.
- The command addresses the script through `${CLAUDE_SKILL_DIR}`, never a
  relative path or `${CLAUDE_PROJECT_DIR}`, since the session may start in a
  subdirectory, where a relative path fails and the project directory is the
  start directory.
- The script path stands in double quotes, in the command, in the grant and in
  every fallback call, since `${CLAUDE_SKILL_DIR}` is substituted as text: a
  checkout path holding a space would split the word, and one holding `[`,
  `*` or `?` is a glob that zsh, a common session shell, aborts on when it
  matches nothing. The grant matches quotes literally, so all three use the
  same form. Nothing else in the command is a glob character.
- The `allowed-tools` grant is exactly that command form and nothing wider,
  since a grant such as `Bash(node *)` would let a spliced `node -e` run, and
  an unmatched injected command aborts the skill. Claude Code clears the
  grant when the user sends the next message, so it covers the fallback
  calls and lookups of the invoking turn only.
- The same frontmatter registers a `PreToolUse` hook, which Claude Code keeps
  for the rest of the session: `hook.mts`, a short file beside the script that
  imports nothing from it, so it can be read whole, reads each Bash call that
  runs `node` on stdin and answers allow only when the whole command is `node
  "<absolute path>"` and arguments of the forms the skills type (`--` flags,
  bare words of letters, digits, `.`, `_`, `/` and `-`, and single-quoted
  names, references and stamps), the path resolving to `status.mts` beside
  it. For anything else it prints nothing and the normal permission flow
  decides, so no operator, substitution, glob, redirect or other program gets
  through it. Like the script, it exits 0 and writes nothing to stderr, and
  an error of its own prints nothing. Each skill's body says in one paragraph
  what the hook does and why, so no reader of a skill meets it unexplained.
  This covers every script call in later turns (after a prose reply, a
  background notification or a long interview) without a settings file: before
  the first `/orc-setup`, for every teammate and checkout, from a subdirectory
  and a linked worktree, and in a `-p` run. A permission rule could not:
  project allow rules wait for workspace trust, the shared
  `.claude/settings.json` is read only from the directory the session started
  in, and a rule matching the absolute path would hold one machine's checkout.
  The hook command finds `hook.mts` through git, since Claude Code substitutes
  `${CLAUDE_SKILL_DIR}` in the skill text and the grant but not in hook
  commands. It changes to the directory the session started in
  (`CLAUDE_PROJECT_DIR`), never asking from the current one, since a `cd` into
  another checkout, a nested clone or a submodule, would otherwise make the
  hook run whatever file that checkout holds at the hook's path, and climbs
  to that checkout's root by the relative path `git rev-parse --show-cdup`
  prints: a path git prints in full would lose a trailing newline to `$(...)`
  and name a sibling directory. That first `cd` is physical (`-P`), since
  git counts the levels of the real directory, while a shell's logical `..`
  under a project directory that is a symlink into the checkout would climb
  the symlink's own parents, out of the checkout. Its git call refuses a bare repository
  (`safe.bareRepository=explicit`), as the script's own calls do (9.2), since
  a bare repository committed as plain files can name a worktree that holds a
  planted hook. Each step of the hook command guards the next, so without
  that variable, outside a repository, in a bare one, or with no file at
  `.claude/skills/orc/hook.mts`, no `node` runs at all, and it prints
  nothing: a hook that fails, times out or prints anything but the allow
  decision leaves the call to the normal permission flow. A deny or ask rule
  in the user's settings still wins over the hook's allow.
- The hook approves by path, never by content, so it trusts what the skills
  already trust: the files under `.claude/skills/` in the checkout the session
  started in. Whoever can change `orc/hook.mts` or `orc/status.mts` there
  (a merged commit, or an edit in the session, which Claude Code treats as a
  write to a protected path: it asks in the default and accept-edits modes, and other modes decide
  by their own rules) decides what the allowed call runs, exactly as they
  decide what the skill text says. The call it allows is read-only as 9.2
  puts it: it changes no ref, index, file or tracker state, and git runs on
  its behalf only what that checkout's own files and local git config name.
  The hook does not check the call's working directory, since the script
  does: run from another repository, it stops before its first git call
  there, and it never reads a bare one (9.2).
- The script exits 0 for every outcome, errors included, and writes nothing
  to stderr (the `git` and `gh` it runs write to pipes it reads), since any
  non-zero exit aborts the whole skill before the model runs and stderr is
  merged into the splice. An error is a stop of kind `error` with a
  script-authored message; its text is data, in `--json` only.
- Every `git` and `gh` call has a timeout (45 s and 20 s), since a hung call
  would run into the Bash tool's two-minute limit, which aborts the skill. A
  `gh` timeout is a failed lookup like any other, and no further `gh` call is
  made in that run; a `git` timeout is a stop of kind `error`.
- The text form carries only ids, numbers, enumerated states, references
  (`#<n>`, `<name>/<NN>`), short SHAs, the stamp, kebab-case entry names,
  paths orc builds itself and text the script itself authored. A value that
  comes from outside the script reaches it only through a channel this list
  names, and only when it passes that channel's check; otherwise it reads
  `withheld`, or a script-authored stand-in, and the run takes it from
  `--json` as data:
  - a `Spec:` value: only `#<n>` or exactly `.scratch/<name>/spec.md`;
  - an upstream skill name (`skill=`, `Pinned:`, `Vendored:`): kebab-case
    only; an upstream path: only `.claude/skills/<skill>/SKILL.md`;
  - the default branch name: only in `orc-build`'s and `orc-land`'s
    `DefaultBranch:`, when it passes the safe-name rule of 3.1. Everywhere
    else the text says "the default branch", and a pending record on it reads
    `ref=default-branch`;
  - the label upstream's triage mapping gives `ready-for-agent`: only in
    `orc-build`'s `ReadyLabel:`, when it passes the safe-name rule of 3.1;
  - the config's `test` value: never; `Test:` reads `set` or `none`.

  A data field (titles, registry and tracker text, authors, comment bodies,
  file names the repo holds such as a ticket file's slug, working-tree and
  worktree paths, `worktree-agent-*` branch names, `git` and `gh` error text)
  is left out, an array of them shown as its count; `--json` holds them all.
  The splice carries the skill's authority, so nothing anyone else wrote may
  reach it.
- The injected block stays within its size budget (12), since a re-attached
  skill keeps only its first 5,000 tokens after a compaction.

**Fallback.** The same command as one Bash call, with the target in single
quotes when there is one. A run makes it in exactly these cases:

1. **A typed argument.** The injected verdict was judged without it: the run
   prints its banner with the argument in `Target:`, discards its outcome and
   lines, and makes the call with the argument.
2. **A skill file read rather than invoked.** `/orc-next` reads the target's
   `SKILL.md`, where the injected command is a raw placeholder and
   `${CLAUDE_SKILL_DIR}` is unexpanded. The handed-over run uses the verdict
   `/orc-next`'s own carried, and makes every fallback call and lookup with
   `/orc-next`'s form, `node "<orc-next skill dir>/../orc/status.mts" ...`,
   which `/orc-next`'s grant and hook cover, and takes the checkout root from
   that folder the same way.
3. **A stale verdict.** A verdict holds until the run's first write of any
   kind (a file, a commit, a branch switch, a merge, a fetch, a push, a
   tracker write), and never after a compaction, which re-attaches the skill
   with its old output. After either, the run takes a fresh one. Of several
   copies in a session only the newest counts; the stamp tells them apart and
   does not by itself detect a change, since a tracker write or a working-tree
   edit leaves HEAD where it was.
4. **No verdict.** The block reads `[shell command execution disabled by
   policy]`, holds the raw placeholder, or does not open with the verdict
   header (9.5). Each `SKILL.md` holds its banner's first line for this case
   (3.1).

Known limits: an injected command that cannot run at all (a deny or ask rule
on it, managed-only permission rules that ignore `allowed-tools`, managed
settings that keep hooks to plugins, which drop a skill's frontmatter hooks
and its `allowed-tools` with them, a missing `orc` folder, a Node too old to
load `.mts`) aborts the skill before the model runs, and the user sees Claude
Code's own error. A Node below the floor that strips types by default
(22.18.0 or newer on the 22 line, 23.6.0 or newer after it) loads the script
and gets the `node` stop. The injected form was verified from a checkout root, a
subdirectory and a linked worktree, and the quoted form from checkout paths
holding a space, `[` and `*`, the model's own fallback call allowed by the
same grant. A checkout path holding `"`, `$` or a backtick breaks the double
quotes and is unsupported. A linked worktree whose own tree lacks orc's
skills (left uncommitted on the branch it was made from) loads the main
checkout's, so `${CLAUDE_SKILL_DIR}/../../..` names the main checkout while
git and the script act on the worktree, and the hook finds no `hook.mts` there,
so later turns ask; setup offers to commit the skills for this reason. An
install outside the repository, such as a user-level one, reads no repository
at all: every verdict is the `other-repo` stop, since the script reads only
the checkout it lives in.

### 9.5 The schema

```ts
// Config: the keys of 9.1. Role: its upstream keys. LandingMode: "local-merge" | "pr-agent" | "pr-human".
// Fields marked data are left out of the text form (9.4).
type Command = "orc" | "orc-next" | "orc-setup" | "orc-discuss" | "orc-spec" | "orc-tickets" | "orc-build" | "orc-land";
type Verdict = {
  schema: 1;
  command: Command | null;                            // null: a usage error that named no command
  stamp: { head: string | null; at: string };         // HEAD's first 7, null before the first commit; ISO time
  origin: boolean;                                    // the repo has an origin remote
  banner: string[];                                   // ready to print; only Target: depends on the target
  lines: string[];                                    // resolution lines; [] until a target is resolved
  ids: string[];                                      // live registry ids relevant to the target (9.3)
  upstream: { role: Role | null; skill: string | null; path: string | null; pin: string | null;
              invoke: "skill-tool" | "read" | null }[];  // the skills this command uses; role null: called by
                                                      // name (tdd, code-review); skill null: role unresolved
  reference: string[];                                // headings of the command's reference.md to follow
  outcome: Stop | Pick | Go;
};
type Stop = { kind: "stop"; reason: StopReason; message: string[]; next: Next; error?: string /* data */ };
type Pick = { kind: "pick"; why: "none" | "ambiguous" | "dropped" | "choose" | "new-entry" | "leftovers";
              candidates: { number: number; name: string; spec: string | null }[];
              other: boolean; offerAdd: boolean;     // offerAdd: the argument is a valid new entry name (7.2)
              leftover?: { branches: string[]; unresolved: string[] } };  // leftovers: what the first candidate holds
type Next = { command: string; reason: string; kind: "run" | "wait" | "manual" };
type StopReason = "not-a-repo" | "no-commits" | "no-default-branch" | "not-root" | "no-config" | "bad-config"
  | "no-registry" | "broken-registry" | "ignored-lines" | "gh" | "lookup-failed" | "usage" | "error"
  | "off-default" | "state" | "blocker" | "dirty-orc" | "dirty" | "registry-dirty" | "pending-blocked"
  | "linked-worktree" | "branch-held" | "pr-blocked" | "spec-diverged" | "conflict" | "waiting" | "manual" | "node" | "null-role"
  | "other-repo";
type EntryRef = { number: number; name: string; spec: string | null; branch: string };
type Remote = "github" | "other" | "none";
type Pending = { count: number; ref: string; path: string } | { count: number; commentId: number };
type Go = { kind: "go" } & (
  | { for: "orc"; report: string[]; status?: Status }  // status: --json only
  | { for: "orc-next"; proposed: Next; verdict: Verdict }
  | { for: "orc-setup"; run: "first" | "update"; config: Partial<Config> | null; missingKeys: string[];
      badKeys: string[]; trackerLocked: boolean; remote: Remote; gh: GhState;
      testCandidates: string[] /* data */; vendored: { skill: string; pin: string }[] }  // pin: the whole commit
  | { for: "orc-discuss"; mode: "project" | "spec"; entry: EntryRef | null; visit: "first" | "revisit" | "new" | null; next: Next;
      tracker: Tracker; push: Push; landing: LandingMode; pending: Pending | null; remote: Remote;
      uncommitted: { registry: boolean; domain: string[] /* data */ };
      problems: { line: number | null; kind: ProblemKind }[] }
  | { for: "orc-spec"; entry: EntryRef; next: Next; tracker: Tracker; push: Push;
      resume: "none" | "commit-record" | "found"; found: string[];
      foundDetail?: { ref: string; title: string; author: string }[] /* data */; ids: string[];
      projectDecisions: number;                      // the live -> project and -> wayfinder decisions: registry --project
      triageLabels: boolean; byHand: Next | null }   // byHand: the pointer under push never on GitHub (3.2)
  | { for: "orc-tickets"; entry: EntryRef; next: Next; tracker: Tracker; push: Push; cited: string[];
      set: "none" | "complete" | "partial" | "uncommitted" | "ignored-only";
      tickets: { ref: string; satisfies: string[]; title?: string /* data */ }[];
      uncovered: string[]; ignored: { ref: string; author?: string /* data */ }[];
      triageLabels: boolean; byHand: Next | null }
  | { for: "orc-build"; entry: EntryRef; next: Next; ticket: string | null; phase: "build" | "review-ask" | "cleanup";
      mode: "implement-spec" | "implement"; toBuild: { ref: string; path: string | null /* data */; satisfies: string[]; blockers: string[] }[];
      built: string[]; landed: string[]; branch: "local" | "restore" | "create"; mergeDefault: boolean;
      agentBranches: { name: string /* data */; unmerged: number }[]; dirtyOther: string[] /* data */;
      reviewFixRounds: number; research: Research; test: string | null; buildStart: "ask" | "always";
      defaultBranch: string; pending: Pending | null; toMark: string[] | null /* null on GitHub */;
      readyLabel: string | null /* GitHub with a triage mapping only */ }
  | { for: "orc-land"; entry: EntryRef; next: Next; mode: LandingMode; modeSource: "entry" | "config"; push: Push;
      phase: "land" | "cleanup"; tickets: string[]; unresolved: string[]; toResolve: string[] | null /* local, phase land */;
      branch: { local: boolean; remote: boolean; ahead: number | null; behind: number | null; behindDefault: number };
      defaultBranch: { name: string; ahead: number | null; behind: number | null };
      pr: { number: number; state: "OPEN" | "MERGED"; draft: boolean } | null;
      pending: number; test: string | null; remote: Remote }
);
type GhState = "ok" | "not-installed" | "not-authenticated" | "failed" | "not-used";
type Tracker = "github" | "local"; type Push = "ask" | "always" | "never"; type Research = "off" | "on-demand" | "always";

// The /orc report as data: the go of `orc --json`.
type Status = {
  next: Next;
  config: Config;                                     // 9.1, validated
  upstream: Record<Role, { path: string; skill: string } | null>;
  pins: Record<string, string>;                       // every vendored skill to its commit in skills-lock.json
  repo: {
    defaultBranch: string; head: string | null;       // head: null when detached
    docsFrom: string | null;                          // null: the working tree, else the ref read
    linkedWorktree: boolean; origin: boolean;
    ahead: number | null; behind: number | null;      // default branch vs origin/<default>, as last fetched
    gh: GhState;
    dirty: { orc: string[]; other: string[] };        // paths (data); orc: the clean-tree paths
    worktrees: { path: string; branch: string | null; agent: boolean; locked: boolean }[]; // linked ones (data)
    agentBranches: { name: string; unmerged: number; tickets: string[] }[];    // worktree-agent-*; unmerged:
                                                      // commits neither the default branch nor the target's spec branch holds
  };
  registry: { requirements: number; decisions: number; superseded: number;
              problems: { line: number | null; kind: ProblemKind; ignoresEntry: boolean }[] } | null;  // null: no registry
  entries: Entry[];                                   // roadmap order
  discussable: string[];                              // 7.2's picker order
  target: Target | null;                              // the argument's entry, else the active spec
};
type Entry = {
  number: number; name: string; state: State; discussed: boolean; spec: string | null;
  landing: { mode: LandingMode; source: "entry" | "config" };
  ticketCounts: { total: number; landed: number; built: number; inProgress: number; open: number } | null;
  pendingDecisions: number | null;                    // null: not read
  notes: Note[];
};
type Target = Entry & {
  ticket: string | null;                              // a ticket argument (/orc-build)
  branch: { name: string; local: boolean; remote: boolean;
            ahead: number | null; behind: number | null; behindDefault: number };  // vs origin/spec/<name>; default's commits it lacks
  tickets: { ref: string; title: string | null /* data */; progress: "landed" | "built" | "in-progress" | "ready" | "blocked" | "open";
             blockers: string[] | null; waitingOn: string[] }[];                    // open: blockers unknown
  ignoredIssues: { ref: string; author: string /* data */ }[];
  unresolved: string[];                               // spec and tickets the tracker shows open
  prs: { number: number; state: "OPEN" | "MERGED"; draft: boolean; mergeParents: number | null }[] | null;
  untrailedCommits: string[];                         // short SHAs; merges and record commits left out
  pending: Pending | null;
  requirements: string[];                             // live REQ ids it delivers
};
type State = "not-started" | "discussed" | "specced" | "ticketed" | "building" | "built"
  | "in-review" | "cleanup-pending" | "landed" | "squashed" | "unknown" | "dropped";
type Note = { kind: "leftover-branch"; ref: string; unmerged: number }
  | { kind: "ignored-issues"; count: number } | { kind: "pending-decisions"; count: number }
  | { kind: "conflicts-default"; ref: string }
  | { kind: "lookup-failed"; what: "tickets" | "prs" | "blockers" | "pending"; error: string /* data */ };
type ProblemKind = "not-an-id-line" | "wrong-section" | "duplicate-id" | "bad-tail" | "bad-link"
  | "unknown-supersedes" | "unknown-delivers" | "unknown-field" | "repeated-field" | "bad-landing"
  | "not-an-entry-line" | "no-roadmap" | "not-kebab-case" | "duplicate-entry";  // the last two ignore an entry
```

The text form opens with the header line `orc verdict 1 <command> <outcome>`
(`none` for a usage error that named no command), so a run can tell a verdict
from a placeholder, then prints the fields in schema order, one `Key: value`
line each: lists of values space-separated (`none` when empty), lists of
objects one indented line per element with its fields as `name=value`, an
array of data as its count, multi-line values (banner, lines, message, report)
indented two spaces under their key, and a nested verdict indented under
`Verdict:`. A stop prints its reason, its message, the next step's kind and
the pointer ready-made (`Pointer: Done. Next: ...`). A go with a target prints
its `next` the same way, as its last line; the go's `next` is the entry's next
step as judged now, so the one to print at the end of a run comes from a
verdict taken after its writes. Resolution lines are followed by `LinesOpen:`,
which says what they open. A `leftovers` pick ends with `Leftover:
branches=<refs> unresolved=<references>`. A go for a spec build reads:

```
orc verdict 1 orc-build go
Stamp: 1a2b3c4 2026-11-22T09:14:03Z
Origin: yes
Banner: print first, before any tool call, as plain text without this indent, never in a code block
  /orc-build  (GSD: execute-phase)
  Runs:    upstream implement-spec or implement, with tdd and code-review, at their locked commits
  Target:  auth (none given: the active spec)
  Reads:   orc's verdict, the spec, its tickets, the registry lines they cite
  Writes:  code and tests on spec/<name>, every commit with its ticket's Refs: trailer
  Outward: none (no push, no PR; /orc-land lands the branch); GitHub, whatever push says: built labels (ready-for-agent removed) and the pending-decisions comment
Lines:
  Target:  auth (roadmap entry 1), spec #12
  Pinned:  implement-spec @ 1a2b3c4, tdd @ 1a2b3c4, code-review @ 1a2b3c4
  Build:   implement-spec, 2 of 3 tickets to build (built: #14; landed: none), research: on-demand
LinesOpen: every picker question, stop message and the final report
Ids: REQ-01 REQ-03 D-02 D-05
Upstream:
  role=buildSpec skill=implement-spec path=.claude/skills/implement-spec/SKILL.md pin=1a2b3c4 invoke=read
  role=none skill=tdd path=.claude/skills/tdd/SKILL.md pin=1a2b3c4 invoke=skill-tool
  role=none skill=code-review path=.claude/skills/code-review/SKILL.md pin=1a2b3c4 invoke=skill-tool
Reference: none
Go:
  Entry: number=1 name=auth spec=#12 branch=spec/auth
  Ticket: none
  Phase: build
  Mode: implement-spec
  ToBuild:
    ref=#15 satisfies=REQ-03,D-05 blockers=#14
    ref=#16 satisfies=REQ-01 blockers=none
  Built: #14
  Landed: none
  Branch: local
  MergeDefault: no
  AgentBranches: 0
  DirtyOther: 0
  ReviewFixRounds: 1
  Research: on-demand
  Test: set
  BuildStart: ask
  DefaultBranch: main
  Pending: none
  Pointer: Done. Next: /orc-build auth   (2 of 3 tickets to build on spec/auth; start it after /clear)
```

With `--core` the shared core follows as `Core:` with its lines indented;
when `conventions.md` is missing beside the script, a pick or a go asked for
with `--core` is a stop of kind `error` instead, since a run cannot follow a
core it never got. A usage error is a stop of kind `usage`. The lookup prints
the lines as the file holds them; its `--json` form is `{ "schema": 1,
"keys": [{ "key", "lines" /* data */, "supersededBy" }], "project"? /* data,
with --project */ }`, with `lines` `null` for a key the registry lacks, and a
lookup outside a repo or without a registry prints `orc lookup error:
<reason>` (`{ "schema": 1, "error" }`). The locked-lines check prints `orc
locked <commit>: unchanged` or `orc locked <commit>: changed: line <n>, ...`
(`{ "schema": 1, "since", "changed": [<n>...] }`), and `orc locked error:
<reason>` when the stamp is not a commit or a registry cannot be read.
Control characters in text from files or the tracker never reach the output
raw: the text forms print a space in their place, and `--json` holds them
escaped.

## 10. Rules file

`.claude/rules/orc.md`, unscoped, at most about 15 lines:

- Every commit that implements a ticket ends with the trailer
  `Refs: #<n>` (GitHub) or `Refs: <spec>/<NN>` (local). A review-fix commit
  that spans tickets carries one line per ticket, all in the message's last
  paragraph, since git reads only that paragraph as trailers. Upstream's
  `code-review` finds the spec through issue references in commits on GitHub
  and through the branch name locally, so `spec/<name>` branches serve it too.
- Specs and tickets cite the registry ids (`REQ-n`, `D-n`) they satisfy, each
  ticket on a `Satisfies:` line. Requirement-to-commit traceability is then a
  join: commit to ticket to ids.
- Only registry ids carry authority: follow the ids and lines a spec, ticket
  or brief cites. A pending-decisions line is not a decision and is never
  cited.
- A question with a small set of clear answers goes through the native picker,
  recommended answer first.
- The registry is an index. Detail goes into the ADR or the spec.
- Foundations before feature slices when splitting work.
- `CLAUDE.md` is never edited by a skill. Upstream setup runs through
  `/orc-setup`.

## 11. Later releases, designed for now

- v1.1 `/orc-uat`: builds a checklist from the spec's user stories and the
  tickets' acceptance criteria, lets agents verify what they can, and puts
  only the judgement items to the user. Results are written to the spec. The
  registry ids, the `uat` knob and the build/land split exist for this.
- v1.2 `/orc-run`: chains the step commands unattended between the interview
  and UAT. It needs the run-ready registry fields (seams, landing), the
  `buildStart` pre-approval, and a spike of its own.

## 12. Done for v1

- A fresh repo goes from the install command to a landed spec using only orc
  commands, once per tracker and once per landing mode.
- Every commit on a spec branch carries a ticket trailer, merges and record
  commits aside.
- Every command prints its banner before any tool call (a run with no
  injected verdict, 9.4, prints its first lines) and ends with the script's
  pointer, and takes every state from its verdict. No command reads
  `skills-lock.json`, only `/orc-discuss` reads the registry whole, and
  `/orc` with no argument makes no tool call.
- `/orc` reports the right state after a `/clear` at any point.
- A build conflict with the spec, a ticket or a locked id travels through the
  pending record into the registry on both trackers, and a landing with
  lines left asks first; a build with no conflict records nothing and lists
  its assumptions.
- No orc command asks to approve its own script call in any turn.
- Each `push` value behaves as section 3.2 says in every command.
- `CLAUDE.md` is untouched, and no upstream file differs from its locked
  hash.
- **Context budget**, as a test (`tests/budget.test.ts`) that fails when a
  file or a command exceeds its number, when a skill's frontmatter or
  injected command is not exactly the one 9.4 gives, or when a skill's body
  lacks the paragraph that says what its hook does. The static front-load
  is the bytes of the command's `SKILL.md`, the shared core (not for `/orc`)
  and its reference file. The budgets, in bytes:

  | Command | `SKILL.md` | Static front-load |
  |---|---|---|
  | `/orc` | 3,000 | 3,000 |
  | `/orc-next` | 5,200 | 13,000 |
  | `/orc-spec`, `/orc-tickets` | 6,000 | 13,000 |
  | `/orc-discuss`, `/orc-land` | 12,000 | 25,500 |
  | `/orc-build` | 12,500 | 25,500 |
  | `/orc-setup` | 13,000 | 27,000 |

  The shared core is at most 8,000 bytes and each reference file at most
  8,000. These numbers are guard rails against bloat creeping back, not
  targets to squeeze to: a justified raise is acceptable, and a rule is never
  dropped or blurred to fit one. Size independence, below, is a design
  property and stays strict. The text form of a verdict, the core left out,
  is at most 3,000 bytes plus 120 per ticket of the target for a step
  command, that plus 1,000 for `/orc-next`, and 2,000 plus 100 per roadmap
  entry plus 120 per ticket of the target for `/orc`.
- **Size independence**, in the same test: a fixture grows from 20 ids and
  two entries (the first building, the second discussed) to 300 ids and 30
  entries, every added id a requirement or decision of an added entry or a
  `-> project` decision, every other added entry with a spec and a ticket,
  and the first two entries unchanged. The text verdict of every step command
  for the first entry, and `/orc-spec`'s for the second, stays byte for byte
  the same apart from its stamp and the count of project decisions, and
  `/orc`'s grows by one roadmap line per added entry and nothing else.
- `npm test` and `npm run typecheck` pass on the lowest supported Node 24.
