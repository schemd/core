# Changelog

All notable changes to `@schemd/core` are recorded here. Dates describe actual npm publication dates; unpublished versions deliberately use `Unreleased`.

## [Unreleased — 0.3.2]

### Added

- Signal connections now resolve to first-class net topology. Exact shared terminals and junction branches join implicitly, `net=NAME` joins disconnected segments explicitly, unnamed nets receive deterministic `$N` identities, and every net enforces one signal-domain/width contract.
- Straight, cubic Bézier, and orthogonal routes now share one collision policy across component bodies, transformed endpoint markers, and topology-aware wire contacts. Separate nets may meet only at bridgeable perpendicular orthogonal crossings.
- Physical-body overlap detection rejects accidental node collisions while preserving edge contact, UML semantic containment, and lifeline activation/execution/destruction overlays. The validator uses an x-ordered, lazily expired y-bucket sweep and includes a 240-body adversarial regression.
- Chromium visual regression gates now pin net/junction/bridge geometry plus line, Bézier, marker, container, activation, and destruction output in committed, font-independent goldens.
- Orthogonal routing now builds one document-level x-bucket index and reuses it for every obstacle query. Source-ordered routes add their flattened wire segments and connector-label rectangles to the same index: same-net reuse is free, strict crossings are cheap, and unrelated collinear channel reuse is strongly discouraged.
- Deterministic bounded property fuzzing exercises 60 randomized parallel-net documents and 24 randomized crossing meshes. A dependency-free mutation gate isolates seven high-risk net, routing, overlap, and marker mutants in a temporary tree and requires a 100% kill score.
- A third Chromium golden renders every open marker family over a checkerboard host background, making opaque interiors, hidden carrier leakage, and endpoint-trace bleed pixel-visible.

### Changed

- Full-mode wire groups expose `data-net-id`, and `SchematicWireSource` carries the same parser-resolved identity for host simulations and probes.
- Same-net crossings remain continuous without bridge arcs. Separate-net collinear overlap, endpoint contact, non-orthogonal crossing, and subpixel bridge clusters now fail with source-line diagnostics instead of producing ambiguous copper or malformed scallops.
- Mixed-curve wire contact checks use bounded spatial buckets; all-orthogonal documents retain the specialized crossing pass and its bridge ownership order.
- Open arrow, triangle, and diamond markers no longer assume a white or theme-surface fill. A zero-width semantic carrier places the marker while the visible trace is inset beneath its genuinely transparent interior, including in interactive hover states.
- Bridge control points now remain in traversal order, so the final routed point is always the actual target endpoint rather than a bridge extremum.

### Fixed

- The public parser now validates and snapshots JavaScript-supplied source, bounds, and title values before parsing or routing, preventing raw `TypeError`s and geometry changes from volatile accessors.
- The documented legacy `schematic` fence identifier works again; recognition no longer rejects the alias before its compatibility grammar can run.
- `schematicSourceMap` now enforces the same parser-provenance boundary as the renderer instead of trusting forged mutable documents.
- The bounded SVG writer commits its byte count atomically, so a rejected multibyte append does not corrupt subsequent in-budget writes.
- Full-mode component accessibility labels now expose rendered Unicode micro-math text instead of raw `_`, brace, and backslash syntax.
- Grammar documentation no longer claims unsupported delimiter escaping.

### Verified

- Compiler bundle: 102,622 B minified, 30,241 B gzip — 479 B below the 30,720 B gate.
- Coverage: 100% statements, branches, functions, and lines across 143 unit, stress, and property tests; 7/7 targeted mutants killed; 3 Chromium visual goldens.
- Across three isolated Node.js 26.4.0 / Apple Silicon runs, the median warm run measured 0.249 ms for the representative compile, 5.727 ms at the 512-component ceiling, and 10.705 ms for the occupancy-aware dense 16×16 crossing fixture.
- Runtime dependencies: zero.

## [0.3.1] - 07/20/2026

### Fixed

- Orthogonal routing no longer fails diagrams whose components sit closer than twice the 12-unit clearance margin. The post-routing guard now rejects only physical body clips; escape stubs may legitimately pass through a neighbor's clearance ring, so densely packed parallel wires route as straight traces instead of throwing `Orthogonal route intersects … after routing.`
- Empty `qgate` detail rows (`parameter=""`, `phase=""`, `matrix=""`) no longer reserve blank text space: layout and renderer now agree that empty details are absent, so such gates keep the canonical shared quantum shell.
- `embedded-css` output no longer emits keyboard-focusable component and wire groups beneath its `role="img"` root, which flattened them for assistive technology while leaving unlabeled tab stops. Internal `tabindex`/ARIA semantics are now exclusive to `full` mode, and every `full`-mode root is `role="group"` regardless of which semantic hooks are enabled.

### Changed

- `renderSchematic` skips the redundant geometry revalidation pass when the parser's route cache proves the same frozen document already validated against identical bounds, and computes the AST-serializing signature hash only when no `idPrefix` is supplied. Rendered output is byte-identical; hosts that pass `idPrefix` (such as compile endpoints) no longer pay an `O(document)` serialization per render.

### Verified release-candidate measurements

- Compiler bundle: 90,294 B minified, 26,479 B gzip — 4,241 B below the 30,720 B gate and 33 B smaller than 0.3.0.
- Coverage: 100% statements, branches, functions, and lines across 123 tests, including new regressions for sub-clearance routing, single-track barriers, and empty quantum detail rows.
- Runtime dependencies: zero. No public API, grammar, or geometry contracts changed; no migration is required.

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
