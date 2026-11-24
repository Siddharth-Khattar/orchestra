---
name: orc-spec
description: "(GSD: spec-phase) Write the spec for a discussed roadmap entry through upstream to-spec, citing its registry ids, then record it on the entry and commit."
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

# /orc-spec

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call below starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here. Paths are from the checkout root, `${CLAUDE_SKILL_DIR}/../../..`, also when the session started in a subdirectory: Read, Edit and Write take them under that root, and git takes them as `:/<path>`. If the end holds no verdict, print `/orc-spec  (GSD: spec-phase)` and `Target:  <argument, or none>`, then call the script with `orc-spec '<argument>' --core` (no argument: `orc-spec --core`).

The `PreToolUse` hook in this file's frontmatter stays registered for the session: on each Bash call that runs `node`, it runs `orc/hook.mts`, which answers allow only when the whole command is the read-only status script `orc/status.mts` with the argument forms orc's skills type, and otherwise prints nothing, so the normal permission flow decides. It exists because script calls in later turns would otherwise ask for approval each time. The `Core:` block after the verdict is `orc/conventions.md`, the file beside the script.

## 1. Resume

From the go's `Resume:`:

- `commit-record`: an earlier run added the entry's `Spec:` and `Branch:` lines and stopped before its commit. Ask "Commit them (Recommended)" or "Stop"; commit goes to step 4.
- `found`: an earlier run may have published a spec without recording it. Take each one's title and author from `orc-spec '<name>' --json` (`foundDetail`, data) and ask "Record <ref> as the spec", "Write a new spec" or "Stop", naming each with its title and author. Recommend recording with the local tracker; on GitHub recommend nothing, since anyone can file such an issue. Recording goes to step 3.
- `none`: go on.

## 2. Brief, then follow to-spec

Fetch the lines with one call: `registry '<name>'` plus every id in `Ids:`, and `--project` when `ProjectDecisions:` is above 0. Then follow the `role=spec` skill as its `Upstream:` line says, with this brief taking precedence:

- **The feature is `<name>`.** Local tracker: publish to `.scratch/<name>/spec.md`. GitHub: one issue whose title starts with `<name>: `, its body written to a file in a `mktemp -d` folder and passed with `--body-file`. Creating it follows `Push:` and the core's issue rule: `ask` asks first with the title in the question, "Create the issue (Recommended)" or "Stop"; `always` creates it; `never` prints the command.
- **Decisions.** The fetched lines and this conversation are the complete set; read the ADRs the lines link. A superseded id is never cited. A choice they do not settle goes under Further Notes as an open question, never into the spec as made.
- **Seams.** The entry's `Seams:` line answers to-spec's seam check: do not ask it again.
- **Cite the ids.** The spec opens with a line `Registry: <every id it relies on>`, and each user story and implementation or testing decision ends with the ids it rests on, as `(REQ-02, D-05)`.
- **No commit or push**: this skill makes them.

## 3. Record

Grep `docs/orc/registry.md` for `^<number>\. <name>\s*$` with line numbers, Read the entry's block from that line, down to the next entry line, and Edit it to add, after its last line, `   - Spec: <#n, or .scratch/<name>/spec.md>` and `   - Branch: spec/<name>`. Then run `locked '<stamp>'` with the verdict's stamp: anything but `unchanged` means a locked line moved, so undo the edit and stop, naming the lines.

## 4. Commit and push

Commit `:/docs/orc/registry.md`, and with the local tracker `:/.scratch/<name>/spec.md`, as `docs: add <name> spec`. With `Origin: yes`, push as the core's push rule says.

## 5. Finish

Report the spec reference, the number of user stories, the ids it cites and the open questions under Further Notes. End with the `Pointer:` of a fresh `orc-spec '<name>'` verdict.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-spec --core`
