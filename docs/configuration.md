# Configuration

Everything orc can be told lives in one committed file, `docs/orc/config.json`, which `/orc-setup` writes. You can edit any value by hand whenever you like, and it applies from the next command. The status script reads it from the default branch: the working copy while you are on that branch, the committed tip from anywhere else. Since the file is also one of orc's own paths, commit the edit before the next `/orc-build`, which will not start while those paths are dirty.

This is the file from the run in the [guide](guide.md):

```json
{
  "tracker": "local",
  "profile": "hackathon",
  "research": "off",
  "build": "implement-spec",
  "reviewFixRounds": 1,
  "landing": "local-merge",
  "push": "ask",
  "buildStart": "always",
  "test": "npm test",
  "uat": "off",
  "upstream": {
    "discuss": ".claude/skills/grilling/SKILL.md",
    "domain": ".claude/skills/domain-modeling/SKILL.md",
    "spec": ".claude/skills/to-spec/SKILL.md",
    "tickets": ".claude/skills/to-tickets/SKILL.md",
    "buildSpec": ".claude/skills/implement-spec/SKILL.md",
    "buildTicket": ".claude/skills/implement/SKILL.md",
    "land": ".claude/skills/pr/SKILL.md",
    "map": ".claude/skills/ask-matt/SKILL.md",
    "setup": ".claude/skills/setup-matt-pocock-skills/SKILL.md"
  }
}
```

## Keys

| Key | Values | What it steers |
|---|---|---|
| `tracker` | `github`, `local` | where specs and tickets live. Fixed once any roadmap entry has a spec |
| `profile` | `hackathon`, `mvp`, `production` | nothing by itself: it records which set of starting values setup wrote |
| `research` | `off`, `on-demand`, `always` | whether an `implement-spec` build runs upstream's exploration step first |
| `build` | `implement-spec`, `implement` | tickets in parallel worktrees with one review on the spec branch, or ticket by ticket with a review each |
| `reviewFixRounds` | an integer, 0 or more | the cap on review-and-fix rounds. At 0 the findings are listed and none is fixed |
| `landing` | `local-merge`, `pr-agent`, `pr-human` | the mode the spec interview offers first. The entry's own `Landing:` line is what counts for that entry |
| `push` | `ask`, `always`, `never` | how outward steps are approved, [below](#the-push-setting) |
| `buildStart` | `ask`, `always` | whether `/orc-build` asks before it starts. Through `/orc-next` it asks either way |
| `test` | one simple command, or `null` | what the build and the landing run as the test suite |
| `uat` | `off` | reserved; `off` is the only value |
| `upstream` | nine roles, each a vendored `SKILL.md` path or `null` | which upstream skill each orc command follows |

A missing key or a value outside these stops every command except `/orc-setup`, with a message that names the keys and a pointer to `/orc-setup`, which fills them in from the template.

## Profiles

A profile is a set of starting values and nothing more. Setup writes them into the config, and from then on only the individual keys are read.

| Profile | research | build | reviewFixRounds | landing | buildStart |
|---|---|---|---|---|---|
| hackathon | off | implement-spec | 1 | local-merge | always |
| mvp | on-demand | implement-spec | 1 | pr-agent | ask |
| production | always | implement | 2 | pr-human | ask |

`push` starts at `ask` in all three. Choosing another profile in a later `/orc-setup` run rewrites these five keys, hand edits included, as its question says. Both PR modes need a GitHub remote and `gh`; without them setup offers to fall back to `local-merge`.

## The push setting

`push` decides how every outward step is approved, in every command.

| Action | `ask` (default) | `always` | `never` |
|---|---|---|---|
| Push the default branch after a docs commit (`/orc-discuss`, `/orc-spec`, `/orc-tickets`) | a picker showing the unpushed commits | pushes | no push |
| Create the spec and ticket issues (GitHub) | a picker showing the titles | creates them | prints ready-to-run `gh issue create` commands and ends there |
| Land: push, open or merge a PR, merge into the default branch, delete `origin/spec/<name>` | the landing confirmation | goes ahead, printing the confirmation as a message | `local-merge` lands without pushing; the PR modes cannot run |
| Bookkeeping on existing GitHub issues: `built` labels, the pending-decisions comment, closing issues at landing | part of its step | part of its step | part of its step |

Two things are worth knowing about this table:

- **`never` does not mean nothing touches GitHub.** It stops pushes, PRs and new issues. The bookkeeping on issues that already exist still happens, approved together with the step it belongs to, since leaving it undone would leave the status wrong. The banners of `/orc-build`, `/orc-discuss` and `/orc-land` say so.
- **`always` does not skip judgement.** The ticket breakdown is still approved in its picker, and three questions are asked whatever `push` says: merging a diverged `origin` default branch, landing with pending decisions, and landing with no test command.

## The test command

`test` holds one simple command: no `&&`, `||`, `;`, pipes, backticks or `$(...)`. Anything else is rejected as an invalid value. If your suite needs several steps, wrap them in a script or a `package.json` or Makefile target and name that.

Setup proposes `npm test` when `package.json` has a `test` script and `make test` when the Makefile has a `test` target. With `null`, the build falls back to the project's own way of running tests and `/orc-land` asks whether to stop and set one or to land untested.

## Upstream roles

Each orc command follows one or two upstream skills, found through the role paths in `upstream`:

| Role | Default skill | Used by |
|---|---|---|
| `discuss`, `domain` | `grilling`, `domain-modeling` | `/orc-discuss` |
| `spec` | `to-spec` | `/orc-spec` |
| `tickets` | `to-tickets` | `/orc-tickets` |
| `buildSpec`, `buildTicket` | `implement-spec`, `implement` | `/orc-build` (which also calls `tdd` and `code-review` by name) |
| `land` | `pr` | `/orc-land`, in the PR modes, for the PR body |
| `map` | `ask-matt` | no command directly: it records upstream's own map of its flow, which setup reads from its fresh clone to find a renamed skill's successor |
| `setup` | `setup-matt-pocock-skills` | `/orc-setup` |

You should rarely need to edit these. A role is `null` when an upstream update removed its skill and no successor was chosen. The command that needs it then tells you which upstream command to type instead and points at `/orc-setup`.

## Updating

**Upstream's skills.** Run `/orc-setup` again. It shows which vendored skills changed since the locked commit, with the full diff of every skill an orc command depends on, before it overwrites anything. All skills are added at one commit, so the lock never mixes versions. What it cannot judge for you is a change in what an upstream skill does: that diff is yours to read.

**Orc itself.** On the default branch, rerun the install command and commit what changed:

```
npx skills@1 add Siddharth-Khattar/orchestra -a claude-code --copy -y
```

A spec branch cut before the update carries the older copies until the default branch is merged into it, which `/orc-build` and `/orc-land` both do when they pick the branch up again.

**Settings.** Edit `docs/orc/config.json`, or run `/orc-setup` and choose "Go through the setup questions again".
