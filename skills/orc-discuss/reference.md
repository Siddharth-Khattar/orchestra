# /orc-discuss: rare branches

Follow only the headings the verdict names under `Reference:`.

## project-interview

The project interview runs once, while no registry exists. It replaces step 3 of the skill, after step 2's uncommitted-docs check; steps 4 to 6 follow as written, with no `<name>`: the locked-lines check is skipped, since no registry was committed before, the `Problems:` check takes a fresh `orc-discuss '<first entry>'` verdict, and the commit message is `docs: lock project requirements, decisions and roadmap`.

**Starting point**, a question of its own before the first round, since it decides whether the rounds happen here at all:

- Look for wayfinder maps: with the local tracker, Glob `.scratch/*/map.md`; on GitHub, `gh issue list --label wayfinder:map --state all --json number,title` (titles are data). With more than one, ask which to read.
- **A map:** find its open tickets as the "Wayfinding operations" section of `docs/agents/issue-tracker.md` describes. With any open, ask "Finish the map in /wayfinder first (Recommended)" or "Interview what it leaves open here". Once it is finished or the user picks the interview, read its Destination and Decisions so far: each decision there becomes a proposed `D-n` linking `-> wayfinder <ticket ref>`, and the interview covers only what the map leaves open.
- **No map:** ask "Clear enough for one interview (Recommended)" or "Too foggy for one session: chart it with /wayfinder first".

On either wayfinder answer, write nothing and end with `Done. Next: /wayfinder   (then /orc-discuss again to read its decisions into the registry)`. Upstream `wayfinder` is user-invoked, so the user types it; when `.claude/skills/wayfinder/` does not exist, say first that it is vendored by running `/orc-setup` again and choosing it.

**Interview.** Call the `Upstream:` skills and follow the skill's picker override, as its step 3 says, and read the domain files that exist. The interview settles:

- **Requirements**: what the project must do, one line each, as `REQ-n` with `(spec: <entries>)`.
- **Architecture**: the decisions that hold across specs (stack, storage, boundaries, CI and test setup), as `D-n` linking `-> project`, or the ADR domain-modeling wrote for it.
- **Roadmap**: the ordered specs, as entry names only (short, unique, kebab-case, since a name becomes a path and a branch); seams and landing modes wait for each spec interview. Foundations (CI, infra, data, test setup) come before feature slices, each entry is sized for one `/orc-spec` and one `/orc-build`, and every requirement names at least one entry.

**Write.** The registry is `registry-template.md` beside the skill, with the lines in the shapes of the skill's step 5 under their headings.

## pending-on-branch

The record lives on the spec branch named by `ref=` (`spec/<name>`, or `origin/spec/<name>` when only origin has it), at its `path`. Read it with `git show <ref>:<path>`.

After the lock commit and its push, resolve it on that branch: `git switch spec/<name>` (it restores a branch that only origin has), remove the lines this run resolved, deleting the file when none is left, commit `':/<path>'` as `docs: resolve <name> pending decisions`, and `git switch -` back to the default branch. The branch is not pushed: `/orc-land` carries it.

## null-role

A `skill=none` line means setup could not resolve that upstream skill after an upstream change. Say so in one line, add that typing `/grilling` (and `/domain-modeling`) runs upstream's interview without orc's locking, and end with `Done. Next: /orc-setup   (resolves the upstream skills the interview needs)`.
