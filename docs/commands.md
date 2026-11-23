# Command reference

Eight commands, all typed by you: none of them can be started by the model on its own. The `Runs`, `Reads`, `Writes` and `Outward` rows below are the lines each command prints in its banner, taken from the status script.

| Command | Use it to |
|---|---|
| [`/orc-setup`](#orc-setup) | set a repo up, and later update it |
| [`/orc-discuss [spec]`](#orc-discuss) | interview, then lock ids into the registry |
| [`/orc-spec [spec]`](#orc-spec) | write the spec |
| [`/orc-tickets [spec]`](#orc-tickets) | split the spec into tickets |
| [`/orc-build [spec or ticket]`](#orc-build) | build on the spec branch |
| [`/orc-land [spec]`](#orc-land) | land the spec branch |
| [`/orc [spec]`](#orc) | see where everything stands |
| [`/orc-next`](#orc-next) | have the next step proposed and run |

## What every command shares

**Banner first, pointer last.** The banner is printed before any tool call. The last line of every run is `Done. Next: <command>   (<why>)`, judged after the run's own writes. When a command cannot go on it prints why and the same kind of pointer, so a stop always names the way out.

**Targets.** A step command with no argument acts on the active spec: the first roadmap entry that is neither dropped nor finished. An argument can be:

| Form | Example | Matches |
|---|---|---|
| An entry name | `/orc-build memo-cli` | that roadmap entry |
| A spec reference | `/orc-land #37`, `/orc .scratch/memo-cli` | the entry whose `Spec:` line holds it, as a whole (`#12` never matches `#120`) |
| A ticket, for `/orc-build` only | `/orc-build #40`, `/orc-build memo-cli/02` | that one ticket of its entry |

An argument that matches nothing, more than one entry, or only a dropped entry gets a picker of candidates instead of a guess. Two commands choose differently when you give them nothing: `/orc-discuss` picks from the entries still open to discussion, and `/orc-land` looks for leftovers of a landed entry first.

**Pickers.** Any question with two to four clear answers arrives in Claude Code's picker with the recommended answer first. Whatever you have to judge (a draft, a breakdown, the commits about to be pushed) is inside the question itself.

**Outward steps follow `push`.** Pushing, opening a PR and creating issues are approved as the [`push` setting](configuration.md#the-push-setting) says. With the default, `ask`, each one waits for a picker.

**Commits.** Orc commits only the paths it names, with fixed messages and no attribution lines. The docs commands (`/orc-discuss`, `/orc-spec`, `/orc-tickets`) commit on the default branch and stop on any other.

## /orc-setup

| | |
|---|---|
| Runs | `npx -y skills@1 add mattpocock/skills` at one pinned commit; first run: upstream `setup-matt-pocock-skills` |
| Reads | orc's verdict, `mattpocock/skills` (a shallow clone) |
| Writes | `.claude/skills/`, `skills-lock.json`, `.claude/rules/`, `.claude/settings.json`, `.gitignore`, `docs/agents/`, `docs/orc/config.json`; one commit after you confirm |
| Outward | GitHub tracker: creates upstream's labels and orc's `built` and `orc-ticket` |
| Points next | `/orc-discuss` after a first run, `/orc` after an update |

A first run asks for the tracker, the profile, extras and the test command in one picker. It then asks before overwriting any upstream skill that is already in `.claude/skills/`, shows the complete draft of upstream's setup files (and the labels to create) inside a confirmation picker, and offers the commit `chore: set up orc and upstream skills` with every path listed.

The config is written last. A first run that stops part way therefore starts over as a first run.

<details>
<summary>Running it again: the update</summary>

Once `docs/orc/config.json` exists, `/orc-setup` is the update command.

1. "Keep settings (Recommended)" or "Go through the setup questions again", with the current settings in the question. Missing or invalid config keys are filled in from the template either way. The tracker cannot change once any roadmap entry has a spec.
2. It clones upstream again and compares each vendored skill with the new commit. The question lists the skills that changed and holds the full diff of every skill an orc command depends on: "Update to `<sha>` (Recommended)" or "Keep the current versions".
3. A skill that is gone upstream is offered for removal. A role whose skill was renamed gets a successor proposed from upstream's own `ask-matt` map.
4. `.claude/rules/orc.md` is rewritten from the template, missing labels are created on GitHub, and the commit is `chore: update upstream skills to <sha>` or `chore: refresh orc setup files`.

</details>

It stops when the session was not started at the checkout root, when the config, registry or lock file exists but cannot be read, and, with the GitHub tracker, when `gh` is not usable or `origin` is not a GitHub remote.

## /orc-discuss

| | |
|---|---|
| Runs | upstream `grilling` and `domain-modeling`, at their locked commits |
| Reads | orc's verdict, `docs/orc/registry.md`, `GLOSSARY.md` and `docs/adr/`, the pending decisions |
| Writes | the glossary and ADRs during the interview; registry lines only after you confirm, one commit |
| Outward | pushes the default branch (per `push`); GitHub, whatever `push` says: edits or deletes the pending-decisions comment |
| Points next | `/orc-spec <name>` after a first visit, otherwise the entry's next step |

It has two modes, and the registry decides which:

| Mode | When | Settles | Commit |
|---|---|---|---|
| Project interview | no `docs/orc/registry.md` yet | requirements, cross-cutting decisions, the ordered roadmap (names only) | `docs: lock project requirements, decisions and roadmap` |
| Spec interview | a registry exists | one entry's decisions, its test seams, its landing mode | `docs: lock <name> decisions` |

With no argument in spec mode it uses the one entry that is open to discussion (not dropped and not landed, even with tracker items still open), or asks which when there are several, undiscussed ones first. A name the roadmap does not hold yet gets "Add `<name>` at the end of the roadmap (Recommended)" as the first option. Any entry that is not dropped can be revisited by name, a landed one included.

What it asks, in order: whether to include uncommitted registry or glossary changes; each pending decision ("Lock it as a new id" or "Reject it"); the interview rounds; then the proposal with "Lock and commit (Recommended)" or "Change something first". Nothing reaches the registry before that last answer. On a revisit, an answer that contradicts a locked id becomes a new id that supersedes it, and taking an entry out of the plan gives it a `Dropped:` line.

It stops when HEAD is not on the default branch, and, when the pending record lives on the spec branch, while unrelated files are uncommitted or another worktree holds that branch.

## /orc-spec

| | |
|---|---|
| Runs | upstream `to-spec` (config role `spec`), at its locked commit |
| Reads | orc's verdict, the registry lines it cites, `GLOSSARY.md` and `docs/adr/`, this conversation |
| Writes | the spec, then its `Spec:` and `Branch:` lines in `docs/orc/registry.md`, one commit |
| Outward | GitHub: creates the spec issue; both: pushes the default branch (per `push`) |
| Points next | `/orc-tickets <name>`, in the same session |

It acts on a discussed entry that has no spec yet. The brief it gives upstream carries the entry's registry lines, answers the seam question from the `Seams:` line, and asks for the ids to be cited: a `Registry:` line at the top, then the ids after each user story and decision. A choice the lines do not settle goes under Further Notes as an open question. The commit is `docs: add <name> spec`.

A rerun resumes instead of writing a second spec: it offers to commit lines an earlier run left uncommitted, or to record a spec it finds published but not recorded. On GitHub that question shows each found issue's title and author and recommends nothing, since anyone can file an issue with a matching title.

It stops when HEAD is not on the default branch, when the registry holds other uncommitted changes, and when the entry is in any state but `discussed`.

## /orc-tickets

| | |
|---|---|
| Runs | upstream `to-tickets` (config role `tickets`), at its locked commit |
| Reads | orc's verdict, the spec, the registry lines it cites, `GLOSSARY.md` and `docs/adr/` |
| Writes | tickets with blocking edges, only after you approve the breakdown |
| Outward | GitHub: creates the ticket issues; local: pushes the default branch (both per `push`) |
| Points next | `/orc-build <name>`, after `/clear` |

It acts on any entry with a spec. Foundations (CI, infra, data, test setup) come first, the ticket numbers follow that order, and every ticket has a `Satisfies:` line; together they have to cover every id the spec cites. The whole breakdown sits in one picker: "Approve (Recommended)", "Too coarse", "Too fine" or "Change something". With the local tracker the commit is `docs: add <name> tickets`.

When tickets already exist it says what it found and asks:

| Found | Offers |
|---|---|
| A complete set | "Keep the set (Recommended)" or "Draft more tickets" |
| A set that leaves cited ids uncovered | "Draft the missing ones (Recommended)" |
| Uncommitted ticket files | "Commit them (Recommended)", and drafting the rest when ids are uncovered |
| Only ignored issues (GitHub) | "Stop so a maintainer can adopt them with the orc-ticket label (Recommended)" or "File new tickets beside them" |

A ticket added to a landed entry is built and landed like the first set.

## /orc-build

| | |
|---|---|
| Runs | upstream `implement-spec` or `implement`, with `tdd` and `code-review`, at their locked commits |
| Reads | orc's verdict, the spec, its tickets, the registry lines they cite |
| Writes | code and tests on `spec/<name>`, every commit with its ticket's `Refs:` trailer |
| Outward | none (no push, no PR; `/orc-land` lands the branch); GitHub, whatever `push` says: `built` labels and the pending-decisions comment |
| Points next | `/orc-land <name>`, or `/orc-discuss <name>` when it recorded pending decisions |

With a spec (or nothing) it builds every ticket that is not built yet, the way the config's `build` key says. With a ticket it builds that one through upstream `implement`, once its blockers are built.

Before any write it asks "Build it (Recommended)" or "Stop", the question holding the branch (existing, restored from `origin`, or created from the default branch) and the tickets to build with their blockers. `buildStart: always` prints that instead of asking. Then, for each ticket:

1. An implementer subagent works in its own worktree under `.claude/worktrees/`, with the ticket, the spec and only the registry lines the ticket's `Satisfies:` cites.
2. Its commits are merged into `spec/<name>`, the worktree and its branch are removed, and the ticket is marked built.
3. A conflict it reports goes into the [pending record](concepts.md#pending-decisions-and-assumptions) straight away.

Review runs through upstream `code-review`, with at most `reviewFixRounds` rounds of fixes. The final report lists the tickets with their commits, the fix rounds used, the findings left, the pending lines, every assumption, and any commit without a trailer.

A rerun builds only what is left, and first merges the default branch into the spec branch when it has moved on. It is the way to continue after a crash.

<details>
<summary>Less common starts</summary>

| Situation | What it asks |
|---|---|
| Other files are uncommitted | "Stop so I can commit or stash them (Recommended)" or "Build anyway and leave them out of every commit" |
| A leftover `worktree-agent-*` branch holds commits nothing else has | "Merge it (Recommended)", "Discard it" or "Stop", the question showing its commits and files |
| Every ticket is already built | "Review now (Recommended)" or "Skip to cleanup", since git does not record whether the review ran |
| git refuses to remove a worktree | "Remove it" or "Leave it", the question showing its branch, files and lock |

</details>

It stops when the entry has no tickets yet or has landed with nothing new to build, when a ticket target has an unbuilt blocker (the pointer names `/orc-build <blocker>`), when another worktree holds the spec branch, when orc's own paths are uncommitted, and when merging the default branch into the spec branch would conflict.

## /orc-land

| | |
|---|---|
| Runs | the landing mode; PR modes: upstream `pr` (config role `land`), at its locked commit |
| Reads | orc's verdict, git, the PR and its checks |
| Writes | on `spec/<name>`: the default branch merged in and local tickets resolved; then the merge, branches and worktrees removed |
| Outward | per `push`: pushes, opens and merges PRs as the mode says, deletes `origin/spec/<name>`; GitHub, whatever `push` says: closes the issues |
| Points next | the next entry's step |

It lands an entry whose tickets are all built, in the entry's [landing mode](concepts.md#landing-modes). In a repo with an `origin` its first action is always `git fetch origin --prune`, so a PR merged elsewhere is seen before anything is judged.

What it may ask before the confirmation, in this order:

| Gate | Options |
|---|---|
| Pending decisions are waiting | "Lock them now (Recommended)", "Land anyway", "Stop" |
| No test command is configured | "Stop and set one (Recommended)", "Land untested" |
| The local default branch and `origin`'s have diverged | "`Merge origin/<default> into <default>` (Recommended)", "Stop" |

It then merges the default branch into the spec branch, commits the local tickets as resolved, and runs the test command on exactly the commit that will land. The confirmation question holds the test result, the commits to land, the tickets they resolve and every outward step by name. After the landing it closes the GitHub issues that are still open, pushes, and deletes `spec/<name>` locally and on `origin`, each branch only once git shows it merged.

A plain `/orc-land` also finishes what an earlier landing left: when a landed entry still has open tracker items or a merged branch lying around and another entry is waiting, it asks "`Finish <first>` (Recommended)" or "`Go on to <second>`". That is what you meet after merging a `pr-human` PR by hand.

It stops in a linked worktree, when another worktree holds the spec or the default branch, when a ticket is not built (they are listed), on a dirty tree, when the spec branch has diverged from `origin`'s, when a merge it has to make first would conflict, on a failed test run or check, and in a PR mode when `origin` is not on GitHub, `push` is `never` or the repo forbids merge commits.

## /orc

| | |
|---|---|
| Runs | orc's status script (no upstream skill) |
| Reads | orc's verdict |
| Writes | nothing |
| Outward | none |
| Points next | whatever the roadmap needs next |

Read-only, and with no argument it makes no tool call at all: the report was computed when you typed the command. It shows the roadmap with a [state](concepts.md#entry-states) per entry, and for the target its tickets, landing mode, the commits on its spec branch without a trailer, the number of decisions to lock, and notes. Further lines appear only when they apply: `Gh:` when `gh` is needed and not usable, `Unpushed:` or `Diverged:` for the default branch against `origin`'s as last fetched, `Worktrees left behind:`, and `Registry problems:`.

This is a build that was interrupted after its first ticket, seen from the spec branch:

```text
Docs: the default branch tip, since HEAD is off the default branch
Roadmap:
  1. memo-cli  building, 1 of 2 tickets built
Target: memo-cli, branch spec/memo-cli
State: building, 1 of 2 tickets built
Landing: local-merge (the entry's Landing: line)
Delivers: REQ-01 REQ-02 REQ-03 REQ-04 REQ-05 REQ-06 REQ-07 REQ-08 REQ-09 REQ-10
Tickets: 0 landed, 1 built, 0 in progress, 1 open, of 2
  memo-cli/01 built
  memo-cli/02 ready
Untrailed commits on spec/memo-cli: none
Off the main flow, ask upstream's /ask-matt.
```
```
Done. Next: /orc-build memo-cli   (1 of 2 tickets to build on spec/memo-cli; start it after /clear)
```

`/orc <name>` reports on another entry.

## /orc-next

| | |
|---|---|
| Runs | the orc command you confirm, by following its skill file |
| Reads | orc's verdict, then the confirmed command's skill file |
| Writes | nothing until you confirm; then what that command's banner says |
| Outward | none until you confirm; then what that command's banner says |
| Points next | the confirmed command's own pointer |

It asks one question that holds the next step, its reason and that command's banner: "Run it (Recommended)", "Choose another step" or "Cancel". When the next step is to wait (a `pr-human` PR in review), "Cancel" comes first. When the next step is something only you can do, it says so and proposes nothing.

It only ever runs orc's own commands. Typing an upstream command such as `/implement` into the picker's free text is declined, since it would run without orc's brief. A command that asks before it starts, such as `/orc-build`, still asks when it is run this way.
