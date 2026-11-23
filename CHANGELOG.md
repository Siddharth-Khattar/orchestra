# Changelog

All notable changes to orc are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-23

The first public release, and an early one: expect rough edges in interactive use.

### Added

- Eight Claude Code slash commands that run a spec from interview to landing on top of Matt Pocock's skills: `/orc-setup`, `/orc-discuss`, `/orc-spec`, `/orc-tickets`, `/orc-build`, `/orc-land`, `/orc` and `/orc-next`.
- A registry of requirement and decision ids that specs, tickets and commits cite, with a `Refs:` trailer tying each commit to its ticket.
- A read-only status script that judges every step afresh from git and the tracker, so no state is kept between sessions.
- GitHub Issues or local markdown files as the tracker, and three landing modes: `local-merge`, `pr-agent` and `pr-human`.
- A guide, a command reference, concepts, configuration, troubleshooting and design pages under `docs/`, plus the full specification.

[0.1.0]: https://github.com/Siddharth-Khattar/orchestra/releases/tag/v0.1.0
