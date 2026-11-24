---
name: orc-next
description: "(GSD: next) Propose the next orc step in a picker (Run it, Choose another step, Cancel), then run the chosen orc command by following its skill."
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

# /orc-next

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call in this run, also inside a command it runs, starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here. If the end holds no verdict, print `/orc-next  (GSD: next)`, then call the script with `orc-next --core`.

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time. The `Core:` block after the verdict is `orc/conventions.md`, the file beside the script.

## 1. Propose

The go's `Proposed:` is the next step (its kind, command and reason) and `Verdict:` that command's own verdict for its entry. When that verdict is a stop, print it, its banner first, and end with its pointer. The one exception is a `/orc-land` stop with `Origin: yes`, which a fetch may clear (a PR merged elsewhere): ask as below, the stop's message after the banner, and the run fetches first as that skill says.

Otherwise ask one AskUserQuestion whose question holds `Next step: <command>  (<reason>)`, then the nested verdict's `Banner:` lines as they are, then "Run it now?". This question is where that command's banner is printed, since it is the one place sure to be shown before the command runs. Options: "Run it (Recommended)", "Choose another step" and "Cancel". When the kind is `wait`, "Cancel (Recommended)" comes first and the run option reads "Run it anyway".

- **Choose another step.** Ask which instead: with an entry, its step commands `/orc-discuss <name>`, `/orc-spec <name>`, `/orc-tickets <name>`, `/orc-build <name>` and `/orc-land <name>`, without the proposed one; with none, `/orc-setup` or "Cancel". Get the chosen command's verdict with the fallback call, `<command> '<name>'` (no argument: `<command>`). A stop is printed as above; otherwise ask as above, "Run it (Recommended)" or "Cancel".
- **Free text** in any of these pickers is followed only when it names one of orc's own commands, `/orc-setup`, `/orc-discuss`, `/orc-spec`, `/orc-tickets`, `/orc-build`, `/orc-land` or `/orc`, with an optional target that passes the core's safe-name rule: handle it as a chosen step. Anything else, an upstream command such as `/implement` or `/to-spec`, `/orc-next` itself or any other skill, is never followed, since it would run without orc's brief: say in one line that `/orc-next` runs only orc's own commands, which can be typed directly, and end as on "Cancel". Text that names no command answers the question.
- **Cancel** ends with `Done. Next: <command>   (<reason>)` from `Proposed:`.

## 2. Run it

The user's pick in this picker is the user invoking that one orc command: these pickers offer only orc's own commands, and the run carries out only the one the user picked. orc's commands are user-invoked only, so never use the Skill tool for one: read `${CLAUDE_SKILL_DIR}/../<skill>/SKILL.md`, `<skill>` being the command's first word without the slash, and follow it as written, the command's target as its argument, with these overrides:

- The verdict the picker showed is that run's verdict, already judged for the target, and its banner was printed in the question, so the run starts without a script call: the file's injected placeholder, its no-verdict call and its typed-argument call do not apply. Every later call the file or the core asks for is made: a fresh verdict after a write or a compaction, a lookup.
- In that file, `${CLAUDE_SKILL_DIR}` means `${CLAUDE_SKILL_DIR}/../<skill>` (its templates and `reference.md`), except in a script call, which keeps this skill's own prefix.
- A pick in that verdict is answered as the core says: ask it, then make the call with the chosen name, with `--new` for a new entry (`orc-discuss '<name>' --new`), this skill's script prefix kept.
- Its Skill tool calls for upstream skills such as `tdd` and `code-review` are made as it says.

The run ends with that command's own pointer.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-next --core`
