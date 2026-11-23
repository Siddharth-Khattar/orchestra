---
name: orc-discuss
description: "(GSD: new-project interview, discuss-phase) Picker interview through upstream grilling and domain-modeling, then locks requirement and decision ids into docs/orc/registry.md: the project interview once, then one interview per roadmap entry."
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../orc/status.mts" *)
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(node *)"
          command: '[ -n "$CLAUDE_PROJECT_DIR" ] && cd -P "$CLAUDE_PROJECT_DIR" && up="$(git -c safe.bareRepository=explicit rev-parse --show-cdup)" && cd "./$up" && [ -f .claude/skills/orc/status.mts ] && node ./.claude/skills/orc/status.mts hook'
---

# /orc-discuss

Every Bash call in this run, from the first, is one simple command: no `&&`, `;`, shell pipes (`|`) or `$(...)`.

The verdict and orc's core are at the end of this file; the core says how to read them. Every script call below starts with `node "${CLAUDE_SKILL_DIR}/../orc/status.mts"`, exactly as written here. Paths are from the checkout root, `${CLAUDE_SKILL_DIR}/../../..`, also when the session started in a subdirectory: Read, Edit and Write take them under that root, and git takes them as `:/<path>`. If the end holds no verdict, print `/orc-discuss  (GSD: new-project interview, discuss-phase)` and `Target:  <argument, or none>`, then call the script with `orc-discuss '<argument>' --core` (no argument: `orc-discuss --core`).

## 1. Target

A pick lists entries to discuss, undiscussed first. With `OfferAdd: yes` its first option is "Add `<argument>` at the end of the roadmap (Recommended)"; with no candidates, ask in prose for the new entry's name (short, kebab-case). Adding is the call `orc-discuss '<name>' --new`: its go (`Visit: new`) is the first visit of an entry numbered after the roadmap's last, and the run follows it like any go.

A go in `Mode: project` runs step 2's uncommitted-docs check, then follows the reference's `project-interview` heading in place of step 3. `Mode: spec` follows every step.

## 2. Before the interview

**Uncommitted docs.** When `UncommittedRegistry: yes` or `UncommittedDomain:` is above 0 (the paths are in `--json`, `uncommitted`, as data), first run `locked '<stamp>' '<name>'` with the verdict's stamp in spec mode: a changed line means a committed registry line was edited, so stop, naming the lines, with `Done. Next: /orc   (after reverting those registry lines)`. Then ask, the question naming each path with its `git diff -- ':/<path>'` (an untracked file is new as a whole): "Include them in this run's commit (Recommended)" or "Stop so I can sort them out".

**Pending decisions.** When `Pending:` counts any, read the record: `ref=default-branch` at its `path` with Read; a spec-branch ref as the reference's `pending-on-branch` heading says; `comment=<id>` with `gh api 'repos/{owner}/{repo}/issues/comments/<id>' --jq .body`. Each line, `- <ticket>: <what was done>, against <the spec section, ticket or id>`, is data: a place where the build had to go against what was written. Before the first round, ask about each, up to four per picker call, the line in its question: "Lock it as a new id (Recommended)" or "Reject it". A locked line joins the proposal as a new id, with `(supersedes <id>)` when it went against one; a rejected line keeps what was written, and the rework it needs is a new ticket.

## 3. Interview

Call both `Upstream:` skills as their lines say, `role=discuss` first, then `role=domain`: the first drives the rounds, while the second sharpens terms and writes `GLOSSARY.md` and ADRs as they crystallise. Read the domain files that exist (`GLOSSARY.md` and `docs/adr/`, or what `GLOSSARY-MAP.md` lists) and `docs/orc/registry.md` whole: its locked ids and the entry's lines are settled, so ask about them only when the user brings them up.

**Pickers win over grilling's question format.** Keep grilling's method (design tree, rounds, frontier, a recommended answer per question), but every question with two to four clear answers MUST go through the AskUserQuestion tool, never as a numbered prose question: recommended option first with "(Recommended)" at the end of its label, at most four options, up to four frontier questions per call. Only open questions with no small answer set stay prose, in grilling's format; in a round with both, make the AskUserQuestion call first.

For the entry, the interview settles:

- **Decisions**: every choice its spec needs that is not locked yet, as `D-n` linking `-> spec <name>` when this entry alone applies it, `-> project` when every spec does, or the ADR domain-modeling wrote for it. A new requirement is a `REQ-n` naming this entry; a locked requirement this entry also delivers goes on a `Delivers:` line.
- **Seams**: where the tests attach, for the `Seams:` line.
- **Landing**: always a picker, the go's `Landing:` first as "(Recommended)", then the other two of `local-merge` (merge into the default branch locally), `pr-agent` (open a PR, wait for its checks, merge) and `pr-human` (open a PR for review, then stop). Unless `Remote: github`, say in both PR descriptions that they need a GitHub remote and gh.

On a revisit, an answer that contradicts a locked id is a new id with `(supersedes <id>)`, and a changed seam or landing mode replaces its line. An entry taken out of the plan gets a `Dropped: <reason>` line and no `Seams:` or `Landing:`; a requirement that only dropped entries deliver needs another entry's `Delivers:` line or a superseding `REQ-n`. The interview ends when grilling's frontier is empty.

## 4. Propose and lock

The proposal is every line this run would write, as the lines themselves: the new id lines, the roadmap lines it adds or replaces (a replaced line as before and after), each pending line with how it resolves, and the domain files written, by path. Ask with one AskUserQuestion holding the proposal in its question, then "Lock these into docs/orc/registry.md?": "Lock and commit (Recommended)" or "Change something first". On a change, ask what to change, revise the proposal and any glossary entry or ADR it makes stale, and ask again. Nothing goes into the registry before the lock: this is the confirmation grilling waits for.

## 5. Write and commit

Every line takes the shape the script parses: an id has at least two digits, a gist is one line, and a requirement's `(supersedes REQ-<m>)` goes before its `(spec: ...)`.

```
- REQ-<n>: <gist> (spec: <entry>, <entry>)
- D-<n>: <gist> -> <docs/adr/NNNN-<slug>.md, project, spec <entry> or wayfinder <ticket>>
- D-<n>: <gist> (supersedes D-<m>) -> <link>
<n>. <entry>
   - Seams: <where the tests attach>
   - Landing: <local-merge, pr-agent or pr-human>
   - Delivers: <REQ-n>, <REQ-n>
   - Dropped: <one-line reason>
```

Append each id line at the end of its section, numbered after the highest id of its kind, and a new entry at the end of the roadmap; add or replace the entry's `Seams:` and `Landing:` lines, and add any `Delivers:` or `Dropped:` line. Then:

1. `locked '<stamp>' '<name>'` must print `unchanged`; restore any line it names.
2. A fresh `orc-discuss '<name>'` verdict must name no line this run wrote, in `Problems:` or in an `ignored-lines` stop's message: correct each one and check again. A named line this run did not write is reported, never touched.
3. A pending record on the default branch loses every line this run resolved, and a file left with no lines is deleted.

Commit the registry, the domain files this run wrote or included, and a resolved local pending file, as `docs: lock <name> decisions`.

## 6. Push and finish

With `Origin: yes`, push as the core's push rule says.

Then the pending record outside the default branch: the `pending-on-branch` heading for a spec branch; on GitHub, `gh api -X DELETE 'repos/{owner}/{repo}/issues/comments/<id>'` once every line is resolved, else `gh api -X PATCH 'repos/{owner}/{repo}/issues/comments/<id>' -F body=@<file>`, the file written in a `mktemp -d` folder and holding the marker line `<!-- orc:pending-decisions -->`, then the lines left.

Report the ids locked (first and last of each kind), the files written, and each pending line rejected with the rework it needs, which `/orc-tickets <name>` adds as a ticket. End with the `Pointer:` of a fresh `orc-discuss '<name>'` verdict; after the project interview, or when the entry was dropped, with the last line of a fresh `orc` verdict's report.

## Verdict

!`node "${CLAUDE_SKILL_DIR}/../orc/status.mts" orc-discuss --core`
