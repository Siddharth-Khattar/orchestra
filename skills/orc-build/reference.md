# /orc-build: rare branches

Follow only the headings the verdict names under `Reference:`, and `notes` when the skill sends you there.

## agent-branches

A rerun found `worktree-agent-*` branches holding commits neither the default branch nor the spec branch has: an earlier run stopped before merging them. Take their names from `orc-build '<name>' --json` (`agentBranches`, data); a name that fails the core's safe-name rule is never typed, so stop naming it. For each branch with `unmerged` above 0, in order, ask one AskUserQuestion. Its question holds the resolution lines, the branch, its commits `git log --oneline <branch> --not <default> <spec>` (`<spec>` is `spec/<name>`, `origin/spec/<name>` with `Branch: restore`, and left out with `Branch: create`), and, when `git worktree list` shows a worktree on that branch, the files only that worktree holds, `git -C <path> status --porcelain --untracked-files=all` (or that it holds none), and its `locked` line from `git worktree list --porcelain`, if any: everything "Discard it" would lose. Options: "Merge it (Recommended)", "Discard it" or "Stop".

- **Merge it.** Get onto `spec/<name>` as step 2 of the skill says, then `git merge --no-ff --no-commit <branch>` and run the test command. Commit with `git commit --no-edit` only when it passes. With `Test: none`, ask "Merge untested" or "Stop" first. A conflict or a failed test: `git merge --abort`, then stop with `Done. Next: /orc   (after merging <branch> into spec/<name> by hand, or deleting it)`.
- **Discard it.** The user has seen what is lost, so this question stands in for the core's leftover-worktree question: a worktree on the branch is removed as that rule says. Then `git branch -D <branch>`.
- **Stop.** End with `Done. Next: /orc   (after sorting out <branch> by hand)`.

After the last branch, take a fresh verdict and act on it from the skill's step 1: a stop ends the run, and a go goes on to the start (step 2), or where its `Phase:` sends it. Its `AgentBranches:` lines then read `unmerged=0` for the branches merged here, which need nothing more.

## review-only

Every ticket is built, and git does not record whether the review ran. Ask one AskUserQuestion, its question holding the resolution lines: "Review now (Recommended)" or "Skip to cleanup". That answer is the start: no start picker follows.

- **Review now.** Get onto `spec/<name>` as step 2 says. Fetch every `Ids:` line with one `registry` call, then run `code-review` as its `Upstream:` line says, with `<default>` as the fixed point, under the fix cap and the subagent rules of the skill's brief. Each fix round is one fresh implementer subagent in its own worktree, merged into `spec/<name>`. Then step 4.
- **Skip to cleanup.** Step 4.

## notes

Exploration notes go in `.scratch/<name>/notes/`, and a rerun that finds notes there reuses them. Implementer worktrees see only committed files, so once the branch is set (step 2) and before any implementer starts, run `git check-ignore -q :/.scratch/<name>/notes/x`. When it fails, commit the notes on `spec/<name>` as `docs: add <name> exploration notes`, a record commit with no trailer. When it succeeds, `.scratch/` is ignored here: commit nothing, and give each implementer the notes' absolute path.

## null-role

A `skill=none` line for the build role means setup could not resolve that upstream skill after an upstream change. The run reaches this heading before any write, so the branch and the tree are as they were. Fetching the registry lines for the brief is a read and may be done. Say so in one line, then print the command to type (`/implement-spec`, or `/implement <ticket>`) with step 3's brief, filled in, to paste after it, and end with `Done. Next: /orc-setup   (resolves the upstream skills the build needs)`.
