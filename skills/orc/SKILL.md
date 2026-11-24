---
name: orc
description: "(GSD: progress) Show where every roadmap entry stands and the next command to run, judged from the registry, git and the tracker. Read-only, so it is safe after a /clear, a crash or on a new day."
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

# /orc

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

Read-only: no tool call but the script call below, which only an argument or a missing verdict needs. The verdict is at the end of this file.

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time.

1. Print its `Banner:` lines first, before any tool call, as plain text without their indent and never in a code block. With an argument, print them with the `Target:` line reading `<argument> (as given)`, then discard the injected outcome and call `node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc '<argument>'`, its path exactly so, and print that call's outcome as step 2 says, not its banner. The argument may be an entry name, a ticket or spec path (letters, digits, `-`, `_`, `.` and `/`, not starting with `-`) or an issue reference, `#` followed by digits only (`#12`), which the single quotes keep from the shell. Any other argument is never typed: say it names no entry and keep the injected verdict. If the end holds no `orc verdict 1` line, print `/orc  (GSD: progress)` and `Target:  <argument, or none>`, then make the same call (no argument: `orc`).
2. By the outcome:
   - **Go:** print the `Report:` lines without their indent, all but the last in one fenced `text` block. The last, `Done. Next: ...`, follows the block.
   - **Stop:** print its message and its `Pointer:` as they are.
   - **Pick:** ask with AskUserQuestion which entry was meant, the question saying why (`Why:`) and the candidates as options, free text allowed when `Other: yes`. Then call `orc '<chosen name>'` and print its outcome as above.

Never reword, shorten or add to the report. The pointer is the last line, with nothing after it.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc`
