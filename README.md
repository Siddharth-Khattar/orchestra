<h1 align="center">
  <img src="docs/assets/logo-light.svg#gh-light-mode-only" alt="orc" height="72">
  <img src="docs/assets/logo-dark.svg#gh-dark-mode-only" alt="orc" height="72">
</h1>

<p align="center">
  Take a change from interview to landed merge in Claude Code,<br>
  with every commit traceable to the decision behind it.
</p>

<p align="center">
  <a href="https://github.com/Siddharth-Khattar/orchestra/releases"><img src="https://img.shields.io/github/v/release/Siddharth-Khattar/orchestra?label=release&color=0071E3" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6E6E73" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024.3-6E6E73" alt="Node 24.3 or newer">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/guide.md">Guide</a> ·
  <a href="docs/commands.md">Commands</a> ·
  <a href="docs/concepts.md">Concepts</a> ·
  <a href="docs/how-it-works.md">How it works</a>
</p>

<p align="center">
  <img src="docs/assets/pipeline-light.png#gh-light-mode-only" alt="The path of one change through orc: /orc-setup once, then for each roadmap entry /orc-discuss, /orc-spec and /orc-tickets in one session, then /orc-build in a fresh session after /clear, /orc-discuss if a decision is pending, and /orc-land." width="838">
  <img src="docs/assets/pipeline-dark.png#gh-dark-mode-only" alt="The path of one change through orc: /orc-setup once, then for each roadmap entry /orc-discuss, /orc-spec and /orc-tickets in one session, then /orc-build in a fresh session after /clear, /orc-discuss if a decision is pending, and /orc-land." width="838">
</p>

## What it is

Orc is a set of eight Claude Code slash commands that sits beside Matt Pocock's agent skills ([`mattpocock/skills`](https://github.com/mattpocock/skills), called upstream in these docs). Upstream already covers the core loop well: grilling a design, writing a spec, splitting it into tickets, building with TDD and reviewing. Orc adds what tends to go missing once that work spans several days and sessions, and it does so without editing a single upstream file.

| Orc adds | So that |
|---|---|
| A registry of requirement and decision ids (`REQ-01`, `D-03`) | specs, tickets and commits can cite what was decided, and a change of mind never rewrites history |
| A `Refs:` trailer on every commit that implements a ticket | a requirement can be traced to the commits that deliver it |
| One named command per step, each opening with a banner and ending with a pointer | you always see what a step is about to run, write and push, and what comes next |
| A status command that reads git and the tracker and stores nothing | a crash, a `/clear` or a new day loses no state |
| Interviews that ask closed questions through Claude Code's native picker | answering is a keypress and the recommended answer is always first |
| A landing step with three modes | a spec gets as much ceremony as it needs, from a local merge to a reviewed PR |

What it deliberately leaves out:

- **No engine of its own.** Orc has no execution engine, event log, state file or merge queue. Each step command briefs the upstream skill that does the work and then follows it.
- **Claude Code only**, with GitHub Issues or local markdown files as the tracker.
- **No edits to `CLAUDE.md` or `AGENTS.md`.** Orc never creates or changes either file.

> [!NOTE]
> **Early release (0.2.0).** The status script is covered by an automated test suite, while the commands themselves have been exercised mostly in scripted headless Claude Code sessions, where a script answers the pickers. Interactive use may still show rough edges, such as how a picker reads at a glance. If you hit one, please [open an issue](https://github.com/Siddharth-Khattar/orchestra/issues).

## Quick start

You need Claude Code, `git` and Node 24.3.0 or newer. Orc's status script runs directly on Node's type stripping, and that version also covers the `skills` CLI that installs orc, which needs Node 22.20 or newer. An authenticated `gh` is only required if you use the GitHub Issues tracker or one of the two PR landing modes.

Run the first line from the root of the repo you want to use orc in, then start Claude Code there and run setup:

```
npx skills@1 add Siddharth-Khattar/orchestra -a claude-code --copy -y
/orc-setup
```

The first line copies orc's eight skills into `.claude/skills/`. `/orc-setup` then asks for a tracker, a profile, any extra upstream skills and your test command, vendors the upstream skills next to orc's at one pinned commit, and writes orc's config and rules. It ends by offering one commit of everything it wrote, which is worth taking, since the build works in git worktrees and a worktree only sees committed files.

From there the whole flow is a handful of commands:

```
/orc-discuss            project interview: requirements, architecture, roadmap

per spec, in roadmap order:
  /orc-discuss          spec interview: decisions, seams, landing mode
  /orc-spec             same session
  /orc-tickets          same session
  /clear
  /orc-build
  /orc-discuss          when the build recorded decisions to lock
  /orc-land

/orc                    at any time, also after a crash or on a new day
```

The interview, the spec and the tickets are meant to share one session, while the build starts in a fresh one: the pointer each command prints tells you which. If you would rather not remember the order at all, `/orc-next` proposes the next step and runs it once you confirm. The [guide](docs/guide.md) walks one change through all of this, from an empty repo to a landed merge.

## What a command looks like

Every command opens with a banner before it touches anything and ends with a pointer to the next step. This is `/orc-build` in a repo with two tickets waiting:

<p align="center">
  <img src="docs/assets/session-light.png#gh-light-mode-only" alt="A run of /orc-build. The banner lists what the command runs, its target, what it reads, what it writes and what it sends outward. The run ends with the pointer: Done. Next: /orc-discuss memo-cli (every ticket is built; 1 decision to lock first)." width="838">
  <img src="docs/assets/session-dark.png#gh-dark-mode-only" alt="A run of /orc-build. The banner lists what the command runs, its target, what it reads, what it writes and what it sends outward. The run ends with the pointer: Done. Next: /orc-discuss memo-cli (every ticket is built; 1 decision to lock first)." width="838">
</p>

The banner and the pointer are produced by the status script, not composed by the model, so they read the same on every run. The [command reference](docs/commands.md) has the banner of each command as text.

## Commands

| Command | GSD equivalent | Wraps upstream | What it does |
|---|---|---|---|
| `/orc-setup` | new-project (tooling part) | `setup-matt-pocock-skills` | Vendors upstream, writes config and rules. Run again to update |
| `/orc-discuss [spec]` | new-project interview, discuss-phase | `grilling`, `domain-modeling` | Picker interview, then locks ids into the registry |
| `/orc-spec [spec]` | spec-phase | `to-spec` | Writes the spec to the tracker |
| `/orc-tickets [spec]` | plan-phase | `to-tickets` | Splits the spec into tickets with blocking edges |
| `/orc-build [spec or ticket]` | execute-phase | `implement-spec`, `implement` | Builds the spec, or one ticket, on the spec branch |
| `/orc-land [spec]` | ship | `pr` (PR modes) | Lands the spec branch in the chosen mode |
| `/orc [spec]` | progress | none | Status. Read-only |
| `/orc-next` | next | none | Proposes the next step in a picker, then runs it |

The GSD column is there for anyone coming from [GSD](https://github.com/gsd-build/get-shit-done) (Get Shit Done), and each banner names the same equivalent. With no argument a step command acts on the active spec, the first roadmap entry that is neither dropped nor finished.

## Documentation

| Page | Read it when you want to |
|---|---|
| [Guide](docs/guide.md) | follow one change from install to a landed merge, with what you see at each step |
| [Commands](docs/commands.md) | look up what a command runs, reads, writes, pushes and asks |
| [Concepts](docs/concepts.md) | understand the registry, entry states, trackers, landing modes, pending decisions and trailers |
| [Configuration](docs/configuration.md) | change a profile, the push setting or the test command, or update orc and upstream |
| [Troubleshooting](docs/troubleshooting.md) | know why a command stopped and what to do about it, and where v1's limits are |
| [How it works](docs/how-it-works.md) | review the design as a maintainer or a security-minded adopter: the status script, the verdict, the permission hook |
| [Specification](docs/spec.md) | check the exhaustive detail behind any of the above |

## FAQ

**Do I need GitHub?**
No. With the local markdown tracker and the `local-merge` landing mode, everything stays in files and git. `gh` only comes into play for the GitHub Issues tracker and the two PR landing modes.

**I already have some of Matt Pocock's skills installed. Will setup clobber them?**
Not silently. `/orc-setup` asks before it overwrites any upstream skill that is already in `.claude/skills/`.

**Does orc change my `CLAUDE.md`?**
Never, and neither does upstream's setup when it runs through `/orc-setup`. The block upstream would put there goes into `.claude/rules/agent-skills.md` instead. [Concepts](docs/concepts.md#what-orc-writes-in-your-repo) lists every path orc writes.

**Can I squash-merge a spec's PR?**
It is best avoided. Orc recognises a landing by the per-ticket commits reaching the default branch, so a squashed or rebased PR reads as `squashed` and is left for you to check by hand.

**What does `/orc-discuss` mean by `/wayfinder`?**
It is an upstream skill for charting work that is too foggy to settle in one interview. The project interview offers it as an escape hatch, and so does a spec interview's first visit when the entry looks too big for one session. Either can read a finished map's decisions into the registry.

**How much context does a command cost?**
Each command's skill text and verdict have byte budgets that the test suite enforces, and a step command's verdict is built to stay the same size as the registry and the roadmap grow. [How it works](docs/how-it-works.md#context-cost) has the numbers.

**How do I remove orc?**
There is no uninstaller, although everything orc and its setup wrote is plain files in your repo. [Concepts](docs/concepts.md#what-orc-writes-in-your-repo) lists each path and who wrote it, so you can delete the ones you no longer want. The registry is worth a second thought before it goes, since specs, tickets and commits cite its ids.

## Development

The skills live in `skills/`, and only that folder is installed into a target repo. The status script, `skills/orc/status.mts`, is dependency-free TypeScript that Node runs directly.

```
npm install
npm test
npm run typecheck
```

`npm test` takes about two minutes, since most tests build real git repositories. [How it works](docs/how-it-works.md#testing-and-budgets) says what the two test files guarantee, and [CONTRIBUTING](CONTRIBUTING.md) covers what a change needs to touch.

## License

Orc is released under the [MIT License](LICENSE). It does not ship upstream's skills, which `/orc-setup` fetches into your repo: those are Matt Pocock's and carry their own license.
