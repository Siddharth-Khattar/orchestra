# Orc rules

- Every commit that implements a ticket ends with the trailer `Refs: {{TICKET_REF}}`. A review-fix commit that spans tickets carries one `Refs:` line per ticket. All `Refs:` lines sit together in the message's last paragraph, since git reads only that paragraph as trailers: `git commit -m "<subject>" --trailer "Refs: <a>" --trailer "Refs: <b>"` writes them that way.
- Each spec is built on its own `spec/<name>` branch. Upstream `code-review` finds the spec through the issue references in commits on GitHub and through the branch name with local markdown, so both conventions matter.
- Specs and tickets cite the registry ids (`REQ-n`, `D-n`) they satisfy, each ticket on a `Satisfies:` line. Requirement-to-commit traceability is then a join: commit to ticket to ids.
- Only registry ids carry authority: follow the ids and lines a spec, ticket or brief cites. A pending-decisions line is not a decision and is never cited.
- A question with two to four clear answers goes through the AskUserQuestion tool, recommended answer first with "(Recommended)" on its label. Open questions stay in prose.
- `docs/orc/registry.md` is an index of ids. Detail goes into the ADR or the spec and is never copied into it.
- When splitting work, foundations (CI, infra, data, test setup) come before feature slices.
- No skill edits `CLAUDE.md`. Upstream's `setup-matt-pocock-skills` runs through `/orc-setup`.
