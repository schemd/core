# Changelog

All notable changes to `@schemd/core` are recorded here. Dates describe actual npm publication dates; unpublished versions deliberately use `Unreleased`.

## [0.3.0] - 07/19/2026

### Added

- Exact quarter-turn component orientation through `orientation=right|down|left|up`, including rotated ports, outward normals, AABBs, text extents, obstacle routing, and four-turn identity.
- Electrical sources, native junctions/test points/connectors, power symbols, switch and protection families, amplifiers, resonators, meters, loads, expanded passive/diode/transistor variants, and side-aware IC orientation.
- Digital buffers, logic states, clocks, latches/flip-flops, mux/demux blocks, encoders, decoders, registers, counters, half/full adders, comparators, and bus primitives.
- Named and parameterized quantum gates, preparation/reset/measurement, control and swap structures, generalized controlled gates, barriers/delays, and classical result nodes.
- First-class UML structure, deployment, activity, interaction, and state-machine primitives plus synchronous, asynchronous, return, control-flow, object-flow, assembly, and delegation relations.
- Public vocabulary registries and discriminated AST contracts for every new family, signal domain, output mode, semantic hook, and UML relation.

### Changed

- `qgate` now uses the same high-fidelity shell, typography, sizing discipline, orientation path, and semantic metadata quality as `hadamard`, while retaining optional `parameter`, `phase`, and `matrix` detail rows.
- Orthogonal routing consumes rotated component obstacles and terminates at exact rotated semantic ports.
- Repeated canonical geometry is amortized through diagram-local `<symbol>`/`<use>` reuse; unused families emit no definitions.
- The hard compiler budget is now exactly 30,720 B gzip and fails at 30,721 B.

### Compatibility and migration

- Existing syntax without orientation remains valid; omitted orientation is byte-for-byte equivalent to `orientation=right` where compatibility is promised.
- Existing component kinds, public entry points, port aliases, `hadamard`, `cnot`, `qgate`, IC, diode/transistor, logic, and UML documents remain supported.
- New public AST members are additive. TypeScript consumers with exhaustive switches over `SchematicComponent['kind']` must add the 0.3.0 discriminants.
- See [the 0.2.x migration guide](./docs/MIGRATION-0.3.md) for exact changes.

### Verified release-candidate measurements

- Compiler grew from 59,363 B minified / 18,181 B gzip in 0.2.1 to 90,714 B minified / 26,398 B gzip in 0.3.0. The candidate retains 4,322 B below the 30,720 B gate.
- Coverage: 100% statements, branches, functions, and lines.
- Runtime dependencies: zero.
- On Node.js 26.4.0 / Apple Silicon, the Phase 5 warm medians were 0.202 ms for the representative RC compile, 6.583 ms for 512 rotated components, and 2.982 ms for the dense 16×16 routing fixture. Their SVG outputs were 6,019 B, 279,243 B, and 44,604 B respectively.
- The repeated-symbol fixture emitted 1,353 B for one resistor and 35,463 B for 64 mixed-orientation instances: 541.429 B per additional labeled instance after the shared symbol definition. Re-run `bun run benchmark` on the release commit for machine-specific latency confirmation.

### Known limits

- Quarter-turn orientation is intentionally rejected for rotationally symmetric UML/electrical nodes where it would have no semantic effect.
- Standards options implement documented visual subsets; this package does not claim IEEE, IEC, OpenQASM, or OMG certification.
- Text sizing remains deterministic and SSR-safe rather than font-engine exact. Hosts using materially different fonts should preserve the supplied SVG typography or allocate additional label space.

## [0.2.1]

- Last 0.2.x release. Historical documentation remains at [the official 0.2.1 route](https://schemd.johnowolabiidogun.dev/docs/0.2.1/overview).
