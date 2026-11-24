---
name: orc-setup
description: "(GSD: new-project, tooling part) Vendor Matt Pocock's skills into this repo at one pinned commit, then write orc's config, rules and settings and run upstream's setup. Run it again to update."
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

# /orc-setup

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call below starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here, and the templates named below sit beside this file in `${CLAUDE_SKILL_DIR}`. If the end holds no verdict, print `/orc-setup  (GSD: new-project, tooling part)` and `Target:  this repo`, then call the script with `orc-setup --core`.

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time. The `Core:` block after the verdict is `orc/conventions.md`, the file beside the script.

A go with `Run: update` follows the reference's `update` heading, which says which of these steps it reuses. `Run: first` follows every step.

- **One pin per run.** `<sha>` is the full upstream commit of step 2, and every `skills add` in the run uses `mattpocock/skills#<sha>`, so the lock never mixes commits. On an update that keeps the current versions, the locked commit takes its place wherever a step says `<sha>`. `skills-lock.json` records the commit per skill, and the verdict's `Vendored:` lines show each upstream skill's `pin=`, which step 3 checks against `<sha>`, so a mixed or moved pin shows up.
- **The clone is temporary.** A run that ends after step 2, for any reason, first removes it with `rm -rf <tmp>`.

## 1. Questions

Ask these in one AskUserQuestion call. When `TestCandidates:` is above 0, take them first from `orc-setup --json` (`testCandidates`, data).

1. **Tracker**: "GitHub Issues" (uses gh) or "Local markdown" (files under `.scratch/`). Recommend GitHub Issues with `Remote: github`, else local markdown.
2. **Profile**, each option's description naming the defaults it sets, with `implement` read as "ticket by ticket, a review each" and `implement-spec` as "tickets in parallel, one review". Recommend mvp. Unless `Remote: github`, say that production's `pr-human` landing needs a GitHub remote and gh.

   | Profile | research | build | reviewFixRounds | landing | buildStart |
   |---|---|---|---|---|---|
   | hackathon | off | implement-spec | 1 | local-merge | always |
   | mvp | always | implement-spec | 2 | local-merge | ask |
   | production | always | implement | 2 | pr-human | ask |

3. **Extras**: "Core only (Recommended)" or "Choose extras", the question naming the core chain of step 3.
4. **Test command**: each candidate, the first recommended, then "None for now" and "Type one", saying it must be one simple command (no `&&`, `||`, `;`, `|`, backtick or `$(...)`), since the config takes nothing else.

The GitHub tracker and the production profile, which lands by PR, need `Gh: ok` and `Remote: github`. When one is missing: with the GitHub tracker, stop, naming it, with `Done. Next: /orc   (after gh auth login, or after adding a GitHub remote)`; with local markdown and production, ask "Land with local-merge (Recommended)" or "Stop and set up gh first", and local-merge replaces the profile's landing in step 6.

## 2. Fetch upstream

1. `mktemp -d`, called `<tmp>` below.
2. `git clone --depth 1 --quiet https://github.com/mattpocock/skills <tmp>/skills`
3. `git -C <tmp>/skills rev-parse HEAD` gives `<sha>`.
4. Read `<tmp>/skills/.claude-plugin/plugin.json`: its `skills` array is the **promoted list**, and each entry's last path segment is a skill name. A skill outside it, such as one under `skills/in-progress/`, is never offered or vendored, and neither is a name holding anything but lowercase letters, digits and hyphens, since names go into a command: name it in the summary.

## 3. Vendor

The **core chain** is always vendored: `grilling`, `domain-modeling`, `grill-with-docs`, `research`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `tdd`, `codebase-design` (which `tdd` calls), `code-review`, `pr`, `ask-matt`, `setup-matt-pocock-skills`. A core name missing from the promoted list is left out and named in the summary. When a role in `config-template.json`'s `upstream` needs it, find its **successor**: read `ask-matt`'s `SKILL.md` in the clone (upstream's own map of the flow), find the skill that does that job now and ask "Use `<successor>` (Recommended)" or "Leave unresolved". Using it adds it with the other names, and step 6 stores its path; leaving it stores `null`.

With "Choose extras", offer the other promoted skills in one AskUserQuestion call: `multiSelect`, grouped by category folder into questions of at most four options each (a second call when that needs more than four questions), the name as label and the first sentence of its `description` as the option description (one Grep for `^description:` across `<tmp>/skills/skills`). Nothing is recommended among extras.

On a first run, when `Vendored:` lists any of the names or Glob `.claude/skills/*/SKILL.md` shows a folder for one, ask before the add, the question naming each with the output of `diff -rq .claude/skills/<name> <tmp>/skills/<its promoted entry>` (none: identical): "Overwrite them with `<first 7 of sha>` (Recommended)" or "Stop", since the add drops any local edit. "Stop" removes the clone and ends with `Done. Next: /orc-setup   (after moving local edits out of those skills)`. Then add every name in one command:

`npx -y skills@1 add mattpocock/skills#<sha> -s <names> -a claude-code --copy -y`

If it fails, stop and show its last lines. Then a fresh `orc-setup` verdict's `Vendored:` must list every name with `pin=<sha>`.

## 4. Rules, settings and ignores

1. Write `.claude/rules/orc.md` from `rules-template.md`, with `{{TICKET_REF}}` as `#<n>` for GitHub or `<spec>/<NN>` for local markdown.
2. Merge `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` into `.claude/settings.json`, creating it if needed and keeping every other key. An `attribution` of `false` already hides everything and stays. A file that is not valid JSON stops the run, never rewritten.
3. Unless `git check-ignore -q .claude/worktrees/x` succeeds, append `.claude/worktrees/` to `.gitignore`, since implementer worktrees live there.
4. With local markdown `.scratch/` is committed: if `git check-ignore -q .scratch/x` succeeds, append `!.scratch/` to `.gitignore` and check again. Still ignored means a rule elsewhere wins: stop, showing `git check-ignore -v .scratch/x`, and say that rule has to change.

## 5. Upstream's setup

Follow the `role=setup` skill as the `Upstream:` line of step 3's fresh verdict says, or the successor step 3 chose for it, read at its path. With `skill=none`, or neither, skip this step with one line saying so: once a successor is vendored, the user types `/setup-matt-pocock-skills` (or that successor) to run it. Name it again in the summary. Otherwise follow it with these overrides only:

- **Section A is answered** with the tracker from step 1; no other tracker is offered.
- **The `## Agent skills` block is the whole of `.claude/rules/agent-skills.md`.** Where upstream picks, creates or edits `CLAUDE.md` or `AGENTS.md`, edit this file instead, without asking which. An unscoped rules file loads in every session like `CLAUDE.md`, so upstream skills still find the tracker and domain docs. A block already in `CLAUDE.md` or `AGENTS.md` would load as well and could disagree: say so in the draft and the summary, and ask the user to remove it by hand.
- **The full draft goes inside the confirmation picker's question**: every drafted file as its path and complete content in a fenced block (an unchanged copy of an upstream template as its path and that template's name), then, on GitHub, a line naming the labels to create: upstream's, if any, and orc's `built` and `orc-ticket`. Options: "Write as drafted (Recommended)", or "Write as drafted and create the labels (Recommended)" when labels are named, and "Edit first". Never print the draft separately: a message before a picker can be skipped.

Everything else upstream asks or writes is followed as written.

## 6. Config

Written last, since its presence marks the next run as an update. Write `docs/orc/config.json` as `config-template.json` with `tracker`, `profile` and its five knobs from the step 1 table (with the local-merge fallback, if taken), `test` as chosen (`null` for none), and `upstream` as the template has it, a role whose skill was left out holding its successor's path or `null`. Show the written values in a short table and say every knob can be edited in the file at any time.

## 7. Commit and finish

Remove the clone with `rm -rf <tmp>`. On a first run on GitHub, create orc's labels as step 5's question approved them, or, when step 5 was skipped, after asking "Create the `built` and `orc-ticket` labels (Recommended)" or "Skip them": `gh label create built --description "Built on its spec branch, not landed yet"` and `gh label create orc-ticket --description "Adopted as a ticket by a maintainer"`; one that exists stays as it is.

The **setup paths** are the ones this run created or changed, listed one by one, never a whole directory: `.claude/skills/<name>` for each name it added, `skills-lock.json`, `docs/orc/config.json`, `.claude/rules/orc.md`, `.claude/rules/agent-skills.md`, `.claude/settings.json`, `.gitignore`, each file upstream's setup wrote under `docs/agents/`, and orc's own folders from the install command (`.claude/skills/orc`, and `.claude/skills/orc-<command>` for setup, discuss, spec, tickets, build, land and next), since implementer worktrees see only committed files. When `git status --porcelain -- <the setup paths>` prints anything, ask, its output in the question: "Commit the setup files (Recommended)" or "Leave them uncommitted", noting that `/orc-build` refuses to start while these paths are dirty. On commit, commit exactly the paths it printed as `chore: set up orc and upstream skills`.

Summarise the tracker, profile, vendored skills with the first 7 characters of `<sha>`, files written and anything left unresolved, then end with `Done. Next: /orc-discuss   (project interview: requirements, architecture, roadmap)`.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-setup --core`
