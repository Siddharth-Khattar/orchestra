# Changelog

All notable changes to orc are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A logo, a social preview card and four figures (the pipeline, the traceability chain, the architecture and a command run), each in a light and a dark version, with their sources under `docs/assets/src/`.
- A quick start and an FAQ in the README, a side-effects table in the command reference, and diagrams for the pending-decision lifecycle and the history of the guide's run.
- `CONTRIBUTING.md`, a bug report form and a pull request template.

### Fixed

- Wording in the docs that overstated what the status script does, and the guide's step numbers, which now match its sections.

## [0.1.0] - 2026-11-23

The first public release, and an early one: expect rough edges in interactive use.

### Added

- Eight Claude Code slash commands that run a spec from interview to landing on top of Matt Pocock's skills: `/orc-setup`, `/orc-discuss`, `/orc-spec`, `/orc-tickets`, `/orc-build`, `/orc-land`, `/orc` and `/orc-next`.
- A registry of requirement and decision ids that specs, tickets and commits cite, with a `Refs:` trailer tying each commit to its ticket.
- A read-only status script that judges every step afresh from git and the tracker, so no state is kept between sessions.
- GitHub Issues or local markdown files as the tracker, and three landing modes: `local-merge`, `pr-agent` and `pr-human`.
- A guide, a command reference, concepts, configuration, troubleshooting and design pages under `docs/`, plus the full specification.

[Unreleased]: https://github.com/Siddharth-Khattar/orchestra/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Siddharth-Khattar/orchestra/releases/tag/v0.1.0
