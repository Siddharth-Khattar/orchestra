---
name: orc-tickets
description: "(GSD: plan-phase) Split a spec into tickets with blocking edges through upstream to-tickets, foundations first, each citing the registry ids it satisfies. Nothing is published before you approve the breakdown."
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

# /orc-tickets

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call below starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here. Paths are from the checkout root, `${CLAUDE_SKILL_DIR}/../../..`, also when the session started in a subdirectory: Read, Edit and Write take them under that root, and git takes them as `:/<path>`. If the end holds no verdict, print `/orc-tickets  (GSD: plan-phase)` and `Target:  <argument, or none>`, then call the script with `orc-tickets '<argument>' --core` (no argument: `orc-tickets --core`).

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time. The `Core:` block after the verdict is `orc/conventions.md`, the file beside the script.

## 1. Existing tickets

From the go's `Set:`. When `Ignored:` names issues, every question below names them with their authors (`orc-tickets '<name>' --json`, `ignored`, data) as issues that are not tickets.

- `none`: go on.
- `ignored-only`: ask "Stop so a maintainer can adopt them with the orc-ticket label (Recommended)" or "File new tickets beside them". Stopping ends with `Done. Next: /orc   (after a maintainer adopts them with the orc-ticket label)`.
- `complete`, `partial` or `uncommitted`: ask, the question naming the set and listing each ticket of `Tickets:` (reference, `Satisfies:` ids, title from `--json` as data) and the `Uncovered:` ids. `complete`: "Keep the set (Recommended)" ends with the go's `Pointer:`, and "Draft more tickets" (left out with `skill=none`, which `/orc-setup` resolves first) goes on as `partial` does, with no question of its own: what to add is proposed in step 2's breakdown picker, where the user changes it. `partial`: "Draft the missing ones (Recommended)" goes on, the brief adding that the existing tickets stay as they are and new ones are numbered after them and may be blocked by them. `uncommitted`: "Commit them (Recommended)" goes to step 3, or, with `Uncovered:` ids, "Commit them and draft the rest (Recommended)", which commits as step 3 says, the push left to the end, then goes on as `partial`. Each also offers "Stop".

## 2. Brief, then follow to-tickets

Fetch the lines of every `Cited:` id with one `registry` call. Then follow the `role=tickets` skill as its `Upstream:` line says, with the spec reference as its argument and this brief taking precedence:

- **The feature is `<name>`.** Local tracker: one file per ticket in `.scratch/<name>/issues/`. GitHub: each ticket a sub-issue of the spec issue (`--parent <n>`) with native blocking edges (`--blocked-by`), created in dependency order, each body written to a file in a `mktemp -d` folder and passed with `--body-file`.
- **Foundations first.** Prefactoring and foundations (CI, infra, data, test setup) come before feature slices, and the ticket numbers follow that order.
- **Cite the ids.** Each ticket has a line `Satisfies: <ids>` right after its "What to build" text, and together they cover every `Cited:` id.
- **Approve in a picker.** For to-tickets' quiz step, make one AskUserQuestion call whose question holds the whole numbered breakdown (each ticket's title, blockers, what it delivers and `Satisfies:` ids), then "Publish these as <k> GitHub issues under #<n>?" or "Write these to .scratch/<name>/issues/?". Options: "Approve (Recommended)", "Too coarse", "Too fine", "Change something"; on anything but approve, ask what to change, revise, and ask again. On GitHub the approval also creates the issues, as the core's issue rule says; under `Push: never` the commands it prints come in dependency order, each blocker named by the command whose printed number goes there.
- **No commit or push**: this skill makes them.

## 3. Commit and push

With the local tracker, commit `:/.scratch/<name>/issues` as `docs: add <name> tickets`, and with `Origin: yes` push as the core's push rule says.

## 4. Finish

Report the tickets in dependency order with their blockers and `Satisfies:` ids. End with the `Pointer:` of a fresh `orc-tickets '<name>'` verdict.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-tickets --core`
