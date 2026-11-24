---
name: orc-land
description: "(GSD: ship) Land a built spec branch in its landing mode: local-merge, pr-agent (the agent opens the PR, waits for checks and merges) or pr-human (opens the PR for review). Merge commits only; resolves the tickets and cleans up. Pushing, opening and merging wait for your confirmation."
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

# /orc-land

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call below starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here. Paths are from the checkout root, `${CLAUDE_SKILL_DIR}/../../..`, also when the session started in a subdirectory: Read, Edit and Write take them under that root, and git takes them as `:/<path>`. If the end holds no verdict, print `/orc-land  (GSD: ship)` and `Target:  <argument, or none>`, then call the script with `orc-land '<argument>' --core` (no argument: `orc-land --core`).

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time. The `Core:` block after the verdict is `orc/conventions.md`, the file beside the script.

**Fetch first.** With `Origin: yes`, whatever the outcome of the verdict this run was given (injected, or carried by `/orc-next`), a stop included, the first tool call after the banner is `git fetch origin --prune`, and the verdict that decides is the one taken right after it. That call holds what the user typed and nothing else: `orc-land` alone when no argument was typed, even though the given verdict names an entry, since only the bare call can ask about leftovers; `orc-land '<argument>'` when one was typed or `/orc-next` handed one over. The given one predates the fetch: a PR merged elsewhere, or commits pushed since, read as unknown or stopped until fetched.

`<name>` is the entry of the go the run acts on, `<default>` its `DefaultBranch:` name; a `withheld` name is never typed, so stop where one is needed. From that go on, every fresh verdict of this run is `orc-land '<name>'`, the entry named, since a bare call may ask about leftovers instead of judging this entry. Never squash, rebase, reset or force-push, never `gh pr merge --auto`. Never push or merge on a failed test run, a failed check, or a check that was expected and never reported, and never without a test run unless the user chose "Land untested" at gate 2: stop loudly, saying what failed. Nothing outward or hard to undo (a push, opening or merging a PR, a merge into `<default>`, deleting a remote branch) happens before a confirmation picker that names it, unless `Push: always` pre-approves it; closing the tracker's issues belongs to the landing and gets no picker of its own.

## 1. Judge

Act on the newest verdict only: a stop ends the run as the core says. A pick with `Why: leftovers` means the first candidate has landed and still holds what `Leftover:` names (its merged spec branches, its open tracker items), while the second is the next entry: ask, the question holding both names and the `Leftover:` line, "Finish <first> (Recommended)", which clears them and then points at the next entry, or "Go on to <second>", which leaves them as a note in `/orc`. Then call `orc-land '<chosen name>'` and act on that verdict. With `Reference: null-role`, follow that heading now, before any write: no gate, merge or commit comes first. `Phase: cleanup` goes to step 6. Each `Reference:` heading is followed where this file names it.

## 2. Gates

1. **Pending decisions.** With `Pending:` above 0, ask, the count in the question: "Lock them now (Recommended)", "Land anyway" (the lines travel with the merge, and a later `/orc-discuss <name>`, the entry named, resolves them) or "Stop". To lock, `git switch <default>`, where `/orc-discuss` locks them. Locking and stopping end with the `Pointer:` of a fresh verdict.
2. **No test command.** With `Test: none`, say plainly that no test command is configured, and ask "Stop and set one (Recommended)" or "Land untested". Stopping runs `git switch <default>` (the tree is clean), since the script reads the config from there, and ends with `Done. Next: /orc-land <name>   (after setting test in docs/orc/config.json on <default> and committing it)`.
3. **Diverged default branch.** With `Reference: diverged`, follow that heading now.

## 3. Prepare and test

1. When `DefaultBranch:` reads `behind=` above 0: `git switch <default>`, then `git merge --ff-only origin/<default>`.
2. `git switch spec/<name>`, which restores a branch only origin has. When `Branch:` reads `behind=` above 0, `git merge --ff-only origin/spec/<name>`, so the run tests and lands what was pushed.
3. `git merge --no-edit <default>`, so the branch tested is the tree that lands ("Already up to date" means it was not merged in). On a conflict, `git merge --abort` and stop with `Done. Next: /orc   (after merging <default> into spec/<name> by hand)`.
4. **Local tracker.** For the spec (`.scratch/<name>/spec.md`) and each ticket file (`.scratch/<name>/issues/<NN>-*.md`) that `ToResolve:` names (what `spec/<name>` does not read resolved yet), set its `Status:` line to `resolved` in its own formatting (`**Status:** resolved`) and commit those files as `docs: resolve <name> tickets`, a record commit with no trailer. It comes before the tests, so the commit tested is the one that lands. With `ToResolve: none`, an earlier run made that commit: skip it, and never commit an unchanged file.
5. **Tests.** Note `git rev-parse spec/<name>` as the commit to land, tested or not: only that commit is merged. With `Test: set`, run the `test` command of `orc-land '<name>' --json` (data) as one Bash call. A failure stops: nothing was pushed or merged into `<default>`, and `Done. Next: /orc   (after fixing the failing tests on spec/<name>, each commit with its ticket's Refs: trailer)`. With `Test: none`, gate 2's "Land untested" stands in for the run.

## 4. Confirm

The question opens with the resolution lines, then holds: `Tested:  <command> passed on <commit to land>`, or `Untested:  <commit to land> (no test command; you chose Land untested)` (in `pr-agent` on a repo with no `.github/workflows`, no test evidence at all); whether `<default>` was merged into `spec/<name>` first; the commits to land, `git log --oneline <default>..spec/<name>` (PR modes: `origin/<default>..spec/<name>`), as a count beyond ten, and the `Tickets:` they resolve; with a local-merge push, `git log --oneline origin/<default>..<default>` as "Also pushed, already on local <default>"; and every outward step by name, deleting `origin/spec/<name>` included.

With `Push: always`, print the question as a message, say the config pre-approves it, and go on. Otherwise ask it. `local-merge` with `Origin: yes` and `Push: ask`: "Merge and push (Recommended)", "Merge locally only" or "Stop"; otherwise "Merge (Recommended)" or "Stop". PR modes: the `pr-modes` heading's options. "Stop" says nothing was pushed or merged into `<default>`, names the commits step 3 left on `spec/<name>` for the next run, and ends with the `Pointer:` of a fresh verdict.

## 5. Land

`local-merge`: `git switch <default>`, then `git merge --no-ff --no-edit spec/<name>`, and note `git rev-parse HEAD` as the merge commit. When the answer includes the push, `git push origin <default>`; a rejected push stops as the core's rejected-push rule says, with `Done. Next: /orc-land <name>   (reconciles <default> with origin/<default>; the merge is on local <default>)`.

PR modes: the `pr-modes` heading, which comes back here for the cleanup or ends the run.

## 6. Clean up

With `Origin: yes`, `git fetch origin --prune`. Take a fresh verdict: anything but `Phase: cleanup` means the merge did not reach the default branch, so stop loudly with `Done. Next: /orc   (check the landing by hand)`. Then, on `<default>` (`git switch <default>`; with `behind=` above 0, `git merge --ff-only origin/<default>`; with `Reference: diverged`, that heading first):

1. **GitHub tracker.** For each `#<n>` in `Unresolved:`, `gh issue view <n> --json state --jq .state`, since a closing reference may have closed it just now. For each `OPEN` one, `gh issue comment <n> --body "Landed on <default> with spec/<name>."` (with `, PR #<n>` before the period when there is a PR), then `gh issue close <n>`. If a `gh` call fails, stop before the rest with `Done. Next: /orc-land <name>   (closes the issues still open)`.
2. **Local tracker.** A file `Unresolved:` still names (the entry landed some other way) is set as in step 3.4 and committed on `<default>` as `docs: resolve <name> tickets`.
3. **Remote**, with `Origin: yes` and `Push:` not `never`: a `<default>` ahead of origin needs a push, and a merged `origin/spec/<name>` can go. This run's step 4 answer decides ("Merge locally only" does neither); `Push: always` does both; otherwise ask "Push and delete (Recommended)" or "Leave them", naming each. Push with `git push origin <default>`; a rejected push stops as the core's rejected-push rule says, with `Done. Next: /orc-land <name>   (reconciles <default> with origin/<default>)`, and nothing is deleted. Delete with `git push origin --delete spec/<name>`, only after `git merge-base --is-ancestor origin/spec/<name> origin/<default>` succeeds, so origin keeps those commits until its own default branch holds them.
4. **Local.** `git branch -d spec/<name>`, only after `git merge-base --is-ancestor spec/<name> <default>` succeeds; if git still refuses, name it and leave it. A spec branch holding commits `<default>` lacks is never deleted: name it with `git log --oneline <default>..spec/<name>`, and say the user may delete it by hand once sure. `git worktree list`: remove each worktree under `.claude/worktrees/` with `git worktree remove <path>`; one git refuses to remove follows the core's leftover-worktree rule. `git branch --list "worktree-agent-*" --merged <default>`: delete those with `git branch -d <names>`, never `-D`.

## 7. Finish

The report opens with the resolution lines, then: the merge commit with its two parents, `git log -1 --format="%H %P" <merge commit>`, the one step 5 noted or, with a PR, `gh pr view <n> --json mergeCommit --jq .mergeCommit.oid` (never the tip of `<default>`, which a resolve commit may have moved past it), the PR if there is one, what decided the merge (the checks, or the local suite), the tickets resolved, what was pushed and anything left behind; with nothing to do, that the entry had already landed. End with the last line of a fresh `orc` verdict's report; when that verdict is a stop, print it as the core's last-line rule says.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-land --core`
