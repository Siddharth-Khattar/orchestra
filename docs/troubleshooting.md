# Troubleshooting

Orc is built to stop early and say why. A command that cannot go on prints its banner, a short message and a pointer, and changes nothing. This page lists those stops, what to do about each, and the limits of v1.

## Reading a stop

```
/orc-land  (GSD: ship)
...
Target:  memo-cli (roadmap entry 1), spec .scratch/memo-cli/spec.md
Mode:    local-merge (the entry's Landing: line)
State:   ticketed, 0 of 2 tickets built
memo-cli is ticketed, 0 of 2 tickets built, and only a built entry lands; not built: memo-cli/01 memo-cli/02.
Done. Next: /orc-build memo-cli   (2 of 2 tickets to build; start it after /clear)
```

The pointer has two shapes. When another command fixes the situation, it names that command. When the fix is yours to make by hand, it names `/orc` with the fix in brackets, as in `Done. Next: /orc   (after committing or stashing them)`: do what the brackets say, then run `/orc` to see the step again.

When in doubt, run `/orc`. It is read-only, it judges everything afresh, and its report carries notes that a step command's stop leaves out.

## Stops before anything is judged

Every command checks these first, in this order.

| Message | What to do |
|---|---|
| Not inside a git repository, and orc needs one. | `git init`, then `/orc-setup` |
| This directory is in another repository than the one orc is installed in... | Start the session in the repo that holds `.claude/skills/orc/`. A nested clone, a submodule and a user-level install all end here ([why](how-it-works.md#what-the-script-reads)) |
| orc needs Node 24.3.0 or newer... | Install a newer Node. A Node that does not strip TypeScript types by default (one older than 22.18, or a 23.x older than 23.6) cannot load the script at all, and you get Claude Code's own error instead |
| This repo has no commits yet, so it has no default branch. | Run `/orc-setup` and take the commit it offers |
| orc cannot tell the default branch... | `git remote set-head origin --auto`, or name the branch `main` |
| This repo is not set up for orc: docs/orc/config.json does not exist. | `/orc-setup` |
| docs/orc/config.json is incomplete: push (missing), landing (unknown value)... | `/orc-setup` fills in missing keys and replaces invalid values from the template. A file that is not valid JSON gets the same pointer: setup then treats the whole file as missing and writes it again, so check the values it shows afterwards |
| No registry yet: docs/orc/registry.md does not exist. | `/orc-discuss`, which runs the project interview |
| docs/orc/registry.md has no ## Roadmap heading, so it is broken, not an empty roadmap. | Restore the `## Roadmap` heading in the registry, then `/orc` |
| docs/orc/registry.md has roadmap lines that are not entries: line 41 not-kebab-case... | Give each such line a kebab-case name no other entry has, or delete a line that repeats an entry |
| gh is not installed / not logged in, and this step needs it. | Install `gh`, then `gh auth login` |
| This session did not start at the checkout root... (`/orc-setup` only) | Start Claude Code at the repo root for setup. Every other command works from a subdirectory |

## Stops by situation

| You see | Why | What to do |
|---|---|---|
| HEAD is on another branch, and this command commits on the default branch only. | `/orc-discuss`, `/orc-spec` and `/orc-tickets` write the registry and docs, which live on the default branch | `git switch` to the default branch. After a build that needs no lock, you are left on the spec branch |
| `<name>` is `<state>`, and /orc-spec acts on a discussed entry with no spec (and its siblings for the other commands) | The step does not fit the entry's state | Follow the pointer: it names the step that does |
| `<ticket>` waits on `<blocker>`, not built yet. | You asked `/orc-build` for one ticket whose blocker is unbuilt | The pointer names `/orc-build <blocker>` |
| Uncommitted changes under the orc paths (...), which a worktree would not see. | Implementers work in worktrees, which only hold committed files | Commit the listed paths: `.claude/skills`, `skills-lock.json`, `.claude/rules`, `.claude/settings.json`, `docs/orc`, `docs/agents`, and `.scratch` with the local tracker |
| The working tree has uncommitted changes, and landing switches branches. | `/orc-land` needs a clean tree | Commit or stash |
| Another worktree holds `spec/<name>` (or the default branch). | git allows a branch in one worktree only | Free the branch in that worktree |
| This is a linked worktree, and landing switches to the default branch. | Landing has to run where the default branch can be checked out | Run `/orc-land` from the main checkout |
| `spec/<name>` and the default branch conflict | The build and the landing merge the default branch into the spec branch first, and that merge would conflict | Merge the default branch into `spec/<name>` by hand and resolve it |
| `spec/<name>` and `origin/spec/<name>` have diverged | Someone else pushed to the branch | Reconcile the two by hand |
| `<mode>` cannot land here: origin is not a github.com remote / push is never / the repo forbids merge commits. | A PR mode needs all three | `/orc-discuss <name>` to choose `local-merge`, or change what blocks it |
| PR #n is open and `spec/<name>` holds nothing new to push. | `pr-human`: the PR is waiting for its review | Merge it with "Create a merge commit", then `/orc-land` |
| A lookup failed: ... | The tracker, a PR or a file could not be read in full, and orc never shows fewer items than there are | `node .claude/skills/orc/status.mts orc --json` holds the error text. For "PR #n is merged and its merge commit is not fetched yet", just run `/orc-land <name>` |
| The next step is manual: ... (`/orc-next`) | Nothing orc can run would help | Do what the reason says |

## Things that go wrong mid-run

**A build was interrupted** (a crash, a closed terminal, a rate limit). Run `/orc-build` again. Tickets are marked built as soon as their commits are merged, so the rerun builds only what is left. If a subagent's branch still holds commits nothing else has, it asks whether to merge it, discard it or stop, showing the commits and files first.

**Worktrees are left behind.** `/orc` shows `Worktrees left behind: n`. The cleanup at the end of `/orc-build` or `/orc-land` removes them, and asks first for any that still holds files or a lock, showing what is in it.

**A push was rejected.** The run shows git's output and stops that push; the commit stays on your local default branch and `/orc` counts it under `Unpushed:`. A non-fast-forward rejection means `origin` moved on, which `/orc-land` reconciles by offering a merge of `origin`'s default branch into yours. A rejection by a rule on `origin` (a protected branch, a required pull request) is a [limit](#limits-of-v1).

**The tests fail at landing.** Nothing has been pushed or merged into the default branch at that point. Fix them on `spec/<name>`, each commit with its ticket's `Refs:` trailer, and run `/orc-land` again.

**A check fails in `pr-agent`**, or CI was expected and never reported. The PR is left open and unmerged. Fix the branch and rerun `/orc-land`, which reuses the PR.

**A PR was squashed or rebased.** The entry reads `squashed`, and no orc command will treat it as landed, since the per-ticket commits are gone. Orc's only advice here is to check the landing by hand: what remains (open issues, the branch) is yours to tidy.

**Someone merged the PR on GitHub.** That is the normal end of `pr-human`. `/orc` may show the entry as `unknown` until the merge commit is fetched; `/orc-land` fetches first, then closes the issues and cleans up.

**A command prints nothing but an error from Claude Code.** The status script could not run at all. The usual causes are a Node too old to load `.mts` files, a deny or ask rule in your settings that matches the script call, managed settings that ignore a skill's own permissions or hooks, or a missing `.claude/skills/orc/` folder.

**You are asked to approve `node .../status.mts` over and over.** The permission hook is not answering. In a linked worktree it needs the orc skills to be committed on that branch, since a worktree only holds committed files; in the main checkout uncommitted skills are enough. It also gives way to any deny or ask rule of your own.

## Limits of v1

- **Branch protection is not detected.** If your default branch only accepts changes through pull requests, a push after a docs commit or a `local-merge` landing is rejected by the server. Orc shows git's output and stops that push. The commit then stays on your local default branch until it lands through a PR landing mode.
- **Merge commits only.** A repo that forbids merge commits cannot use the PR modes, and a squash-merged PR is not recognised as landed.
- **Claude Code only**, with GitHub Issues or local markdown as the tracker.
- **One simple test command.** No `&&`, pipes or substitutions in `test`; wrap them in a script.
- **GitHub author association stands in for write access.** In an organisation whose members have less than write access to the repo, their `Part of #<n>` issues and pending-decision comments still count.
- **Checkout paths holding `"`, `$` or a backtick are unsupported.** Spaces, `[` and `*` are fine.
- **The status script reads `origin` as last fetched.** It never fetches. `/orc-land` is the one command that fetches before it judges.
- **No partial landing and no automatic conflict resolution.** A conflict always stops the run for you to resolve.
