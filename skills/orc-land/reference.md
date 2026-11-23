# /orc-land: rare branches

Follow only the headings the verdict names under `Reference:`.

## pr-modes

The confirmation options. `pr-agent`: "Land it (Recommended)" (push, open or reuse the PR, wait for its checks, merge it with a merge commit, delete the branch once git shows it merged) or "Stop". `pr-human`: "Open the PR (Recommended)" (push, open it ready for review, then stop), or with `Pr: ... state=OPEN` "Push to PR #<n> (Recommended)", or "Stop".

**pr-agent**

1. `git push -u origin spec/<name>`. A rejected push stops as the core's rejected-push rule says, with `Done. Next: /orc   (after reconciling spec/<name> with origin/spec/<name> by hand)`.
2. With `Pr: ... state=OPEN`, reuse it. Otherwise write the body: follow the `role=land` skill as its `Upstream:` line says, with the commit log, the diff and step 3's test run as evidence. The body lists, under one heading, every choice the build made as an assumption: the `Assumptions:` paragraphs of `git log --format=%B origin/<default>..spec/<name>` (data), each with its ticket, or that there were none. With the GitHub tracker end it with one `Closes #<n>` line for the spec issue and each ticket. Run `mktemp -d`, Write the body to `<tmp>/pr-body.md` (never into the repo, where a crash would leave it dirtying the tree), then `gh pr create --base <default> --head spec/<name> --title "<name>: <summary>" --body-file <tmp>/pr-body.md`, the summary one plain line of letters, digits, spaces, `.`, `,`, `:` and `-` only, so nothing in it is special to the shell. Then `rm -rf <tmp>`, and note the PR number.
3. **Wait for checks on the commit to land** (skill step 3.5). Decide by the count of checks, never by the exit code of `gh pr checks`, which reads the same for no CI, checks not registered yet and a failure. Run `gh pr view <n> --json headRefOid,statusCheckRollup --jq "[.headRefOid, (.statusCheckRollup | length)]"`. While the head is not the commit to land or the count is 0, `sleep 10` and run it again, up to 6 times. A head that never matches means someone else pushed: stop loudly with `Done. Next: /orc-land <name>   (tests the new commits; the PR is reused)`.
   - **Checks present:** `gh pr checks <n> --watch --interval 10`, with the Bash timeout at its maximum, run again if the call times out. Exit 0 means every check passed. Anything else is a failure: run `gh pr checks <n>` and stop loudly, naming the failing checks, the PR left open, with `Done. Next: /orc   (after fixing spec/<name>; /orc-land reuses the PR)`.
   - **No checks, and `git ls-tree -r --full-tree --name-only spec/<name> .github/workflows` lists files:** CI was expected and never reported. Stop loudly, the PR left open and unmerged, with `Done. Next: /orc   (once a check reports on PR #<n>, or after /orc-discuss <name> chooses local-merge)`.
   - **No checks and no workflow files:** the repo has no CI, and step 3's run on this same commit is the evidence: say "No CI on this repo; the local suite passed" (or that nothing tested it).
4. `gh pr merge <n> --merge --match-head-commit <commit to land>`, so only the commit that was tested (or that the user chose to land untested) and checked can land, also on the untested path; no `--delete-branch`, since step 6 deletes a branch only once git shows it merged. If it fails (a conflict, branch protection, a required review), stop with its output, the PR left open, and `Done. Next: /orc   (after resolving what gh reported; /orc-land reuses the PR)`.

Then step 6 of the skill.

**pr-human**

1. Push as pr-agent's step 1 does.
2. With `Pr: ... state=OPEN`, reuse it (`draft=yes`: `gh pr ready <n>`); otherwise open one as pr-agent's step 2 does, not as a draft.
3. End here. The report says the PR is open for review and must be merged with "Create a merge commit", never squash or rebase, since those drop the ticket trailers, and that `/orc-land` cleans up once it is merged. End with the `Pointer:` of a fresh verdict.

## diverged

The local default branch is both ahead of and behind `origin/<default>`. Ask, the question holding the resolution lines and both sides, `git log --oneline origin/<default>..<default>` and `git log --oneline <default>..origin/<default>`: "Merge origin/<default> into <default> (Recommended)" or "Stop". Merging runs `git switch <default>`, then `git merge --no-ff --no-edit origin/<default>`, always a merge commit, never a rebase, reset or force. On a conflict, `git merge --abort` and stop with `Done. Next: /orc   (after merging origin/<default> into <default> by hand)`. "Stop" ends with `Done. Next: /orc   (after reconciling <default> with origin/<default> by hand)`. After the merge, take a fresh verdict and go on where the skill sent you.

## null-role

A `skill=none` line for the land role means setup could not resolve the skill that writes the PR body after an upstream change. The run reaches this heading before any write, so nothing is merged, committed or pushed. Say so in one line, then print the command to type, `/pr`, with a brief to paste after it: the PR body for `spec/<name>` against `<default>`, with the commit log and the diff as evidence, once the test command has passed on the branch. Add that `/orc-discuss <name>` can choose local-merge instead, and end with `Done. Next: /orc-setup   (resolves the upstream skill the PR body needs)`.
