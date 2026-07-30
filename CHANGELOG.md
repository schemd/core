# Changelog

All notable changes to `@schemd/core` are recorded here. Dates describe actual npm publication dates; unpublished versions deliberately use `Unreleased`.

## [0.5.0] - 2026-07-30

### Added

- **Relative placement.** A declaration can state where it sits instead of computing it: `resistor:R1 "1 kΩ" right-of VIN by 190 #amber`. Six relations — `right-of`, `left-of`, `above`, `below`, `aligned-x with`, `aligned-y with` — each taking a component or one of its terminals, and the four directions taking an optional `by` distance. `at (x, y)` is untouched, the two forms mix freely, and a document that uses only coordinates compiles to the bytes it always did.
- Directions measure from the referenced **body**, so `by 190` is 190 units of clear space between facing edges. An axis no relation sets is inherited from the first reference, so `right-of A` means beside A and level with it; an alignment overrides that.
- **It is a lowering pass, not a layout engine.** Relations resolve to one `at (x, y)` before the AST is finished, so the netlist, design rules, source map, and renderer never learn relative placement exists. Pinned as a property: a relative document and the absolute one it resolves to compile to **byte-identical SVG**.
- Resolution is one topological sort and one pass of arithmetic. Forward references work; a cycle is an error naming its members in order.
- `compileSchematic` returns `placements` — what each relation resolved to, with port aliases folded to canonical terminals, sorted by source line, empty when unused. Also at `@schemd/core/placement`.
- `compileSchematic` returns `routing` — `attempts` (rip-up retries, zero for a first-pass route), `rippedUp`, and `congestion` per routing-hash cell with `SCHEMATIC_CONGESTION_CELL_SIZE` describing the grid. Read out of the hash the router already filled.
- New `limits` fields: `placementDepth` (64) caps a reference chain, `routingAttempts` (12) caps routing passes. `routingAttempts: 1` restores pre-0.5 routing exactly.
- `routeSchematicConnections` and `validateSchematicGeometry` return routes _and_ the report. `routeConnections` and `validateDocumentGeometry` keep their signatures.

### Changed

- **Routing retries around contention rather than giving up at the first trace that will not fit.** The first pass is still the greedy source-order route, so anything that already compiled takes the path it always did. When a trace fails, what has been laid is torn up and tried again with that trace first and the rest ordered shortest-span-first.
- A reversal bus now routes at **twelve wires, up from ten**.
- **Thirteen is where it stops, and that is a limit of the channel model rather than of declaration order.** Widening the fence changes nothing, and twenty thousand random orders were searched at that width without finding one that routes. Pinned by a test so a future channel-model change has a target.
- The gzip budgets rise to 34 KiB and 37 KiB, from 32 and 35. Relative placement cannot tree-shake out of the compile path — it is a language feature, so every document that parses carries it. Recorded rather than absorbed.

### Verified

- Ten mutants join the kill gate, one per load-bearing property. Twenty-four of twenty-four are killed.
- **A pre-existing mutant survived once rip-up existed, and we strengthened the test rather than retiring the mutant.** `terminal approaches are reserved before any wire is placed` was killed in 0.4.0 by a reversal-bus fixture that could not compile without the reservation; with retries in place the same fixture now compiles anyway, hiding the defect. It asserts `routing.attempts === 0` now — a bus that size is an ordinary figure and must not need a retry. This is the hazard the feature introduces generally: rip-up can paper over a router defect that used to fail loudly.
- Determinism is asserted rather than argued: a congested document compiles to one distinct output over 250 runs and reports the same routing over 50. What in-process repetition cannot check is a different process on a different platform, which CI covers by compiling on Linux the goldens written on macOS.
- The fuzz suite gains random placement graphs — forward, backward, self, and cyclic references — and asserts each one either resolves with finite coordinates or is rejected with a line-accurate diagnostic. Never a hang, never an unhandled throw.
- A congested-routing case joins the benchmark with its own ceiling. Every existing case routes on the first pass and would have stayed green while the retry path grew arbitrarily expensive.

### Performance

- Clean documents are unaffected, measured rather than assumed: the dense 16×16 routing benchmark is unchanged, because a first-pass route runs the code it ran before rip-up existed. The twelve-wire contended bus, which no source order can route at all, compiles in about 31 ms.

## [0.4.0] - 07/26/2026

### Fixed

- Every connection that declares a closed endpoint marker paints one. SVG resolves `marker-start` at the first vertex of a _path element_ and `marker-end` at its last — not once per subpath — so the compound trace that `default` and `embedded-css` output emit showed a single arrowhead however many wires shared a batch. Three `[arrow]` connections in one colour produced three lines and one arrow. Connections carrying `arrow`, `dot`, or `diamond-filled` now keep a path to themselves; unmarked traces still compound, and open markers still travel on their own carrier. Every marker fixture in the suite happened to give each wire a distinct colour, which put every wire in a batch of its own and hid the defect from the goldens.
- A reversal bus routes. The router scored reuse of an occupied channel as expensive-but-legal while `routeConnections` rejected it outright, so it could return a route it had already proved would be thrown out; a four-wire crossbar failed from the third wire on, with no workaround, since crossing traces must be orthogonal. A contact the contact validator rejects now costs the router infinity through the same predicate the validator uses, every trace reserves its terminal approach before any wire is placed, and a blocked channel offers a lane a pitch to either side. A reversal bus of ten wires compiles where three used to.
- Port aliases address one terminal everywhere. `SchematicEndpoint.port` has always been documented as canonical, but the parser never normalized it, so topology resolution, contact validation, the netlist and the design rules each keyed on whichever spelling the author typed. `R1.out -> A.in` beside `R1.r -> B.in` was rejected as two nets colliding at a point they shared, while the same diagram spelled `R1.out` twice compiled; `V1.out -> P1.in` escaped the `shorted-supply` rule that `V1.positive -> P1.in` triggered. The parser now rewrites both endpoints to the terminal they resolve to.
- Integrated-circuit pins serialize at the documented precision. Pin stubs and labels interpolated raw JavaScript numbers while every other vector went through the three-decimal writer, so a pin count that divides badly emitted seventeen significant digits — and a drawn stub end that disagreed with the routed port point below the third decimal.
- A terminal can no longer be wired to itself. `R1.in -> R1.in` compiled to `d="M 158 200 H 158"`: a wire that paints nothing, carries a label nobody can see, and adds a one-terminal net. Aliases made it easy to write by accident, since `emitter` and `source` are one lead on a MOSFET.

### Added

- **`limits`: an optional per-compilation resource budget.** `components`, `connections`, `sourceCharacters`, `wireCrossings` and `svgOutputBytes` may each be set on the compile options; every omitted field keeps its default, so passing nothing behaves exactly as before, and `Infinity` states no limit explicitly. This restores the cheap early rejection the retired counts used to provide, under the control of the host that knows whether the source is trustworthy: a budget rejects a document at the declaration that crosses it, before any routing or rendering.
- The budget is resolved once per compilation and handed to both passes, so an accessor cannot be generous to the parser and mean to the renderer — the same defence the fence's bounds and title already had. `compileSchematic` now snapshots bounds for the same reason.
- A misspelled field is an error rather than a silent no-op. A limit a host believes it set and did not is worse than no limit at all.

### Removed

- **A document is no longer capped at a component or connection count.** `MAX_SCHEMATIC_COMPONENTS` and `MAX_SCHEMATIC_CONNECTIONS` are gone, along with their entries in `SCHEMATIC_LIMITS` — a diagram may declare as many of either as it can place. Removing the counts alone would have changed nothing a user could see, because three other ceilings stood behind them: a 4,096-unit canvas that could not hold a thousand parts however many the parser allowed, a 131,072-character source cap that ran out near three thousand declarations, and a 2 MiB output cap. The canvas now runs to 1,048,576 units a side, one call reads up to 16,777,216 characters, and the writer emits up to 256 MiB. What remains bounds allocation, not diagram size. **Breaking for anyone importing the two constants or reading `SCHEMATIC_LIMITS.components`.**
- Scaling was measured rather than assumed: 64,000 components with 32,000 connections compile in about a second, at a flat 16 µs per component from 8,000 up. 11,200 components with 800 obstacle-dodging orthogonal traces take 130 ms. A performance gate now compares per-component cost at 1,000 and 10,000 components, so a quadratic term cannot reappear behind the retired ceiling.
- **Hosts compiling untrusted source should set a `limits` budget and a timeout.** The old counts doubled as a cheap early rejection; the defaults that replaced them sit far past any readable diagram, and no byte ceiling stops a small document from being expensive to route.

### Changed

- An unroutable orthogonal connection names both endpoints and three things that free a channel, in place of the bare `No collision-free orthogonal route exists.` The router now refuses contacts the validator would reject, so this is the diagnostic such a trace reaches.
- Canvas and title validation live in one place each instead of three near-identical copies across the fence parser, the runtime parser boundary and the renderer. `Render title must be a non-empty string of at most 512 characters.` is now `Render titles cannot be empty.` / `Render titles cannot exceed 512 characters.`, matching the parser's wording.
- The two size budgets rise to 32 KiB and 35 KiB gzip, from 31 KiB and 34 KiB. The configurable budget, port canonicalization and the routing fixes are real additions; the gate caught the growth, the two deduplications above paid part of it back, and the rest is recorded here rather than absorbed silently.
- The routing spatial hash addresses cells with a 2^26 column stride. The old 8,192 stride was only collision-free because bounds stopped at 4,096 units; two traces on a larger canvas would have hashed into one bucket and been compared as though they touched.
- `BoundedSvgWriter` takes an optional byte ceiling, defaulting to the compiler's. Verifying the boundary no longer means allocating 256 MiB to reach it.
- `canonicalPortName` is exported. Hosts that resolve author-written port names — link targets, hover cards, netlist overlays — need the same answer the compiler uses.

### Verified

- A regression suite states each defect and pins the property that makes it impossible, rather than the output that happened to change. Where the old behaviour was _asserted by the suite_ — a compound path carrying one arrowhead for two wires, a transistor lead wired to itself — the assertion is now its inverse.
- Seven mutants join the kill gate: a rejected contact must cost the router infinity, terminal approaches must be reserved before routing, a blocked channel must offer a lane aside, a closed marker must keep its trace out of a compound path, a supplied budget must be enforced rather than accepted, a misspelled budget field must fail, and one budget must govern the whole compilation. Fourteen of fourteen are killed.
- Two Chromium goldens cover the blind spot the existing four shared: four same-colour wires that each declare a closed marker, and a four-wire reversal bus.

### Performance

- Cubic Bézier obstacle testing no longer allocates four mapped arrays and four spreads per subdivision, on a function that halves the curve until its hull is a quarter-unit across. Bézier-heavy documents compile roughly 60% faster.
- Wire-contact testing allocates nothing per call, and the universal contact pass stamps candidates instead of allocating a `Set` for every span in the document. Dense orthogonal routing pays about 13% more than 0.3.8 overall: the router now prices spans it previously emitted blind, and has more places to put a wire.

## [0.3.8] - 07/26/2026

### Changed

- Geometry diagnostics say how to fix the diagram, not only what is wrong with it. An overlap now reports the amount and a coordinate that clears it — `R2 overlaps R1 by 44 units horizontally; move R2 to x >= 284, or use a UML container` — expressed in the `at (x, y)` origin the author types rather than the derived body rectangle. The advice follows the axis the author already used to separate the pair, so two parts side by side move apart sideways instead of being stacked because that happened to be eight units cheaper.
- Out-of-bounds diagnostics name the offending coordinate and the range it must fall in. A body that escapes the canvas after layout reports the overhang and an origin that would contain it, and notes that widening the fence is also an answer.

### Documented

- The README carries a standing statement of limitations and operational risks. `verifyNetlist` performs structural linting over a flat connectivity model — not electrical, timing, analog, or functional verification — and a clean result does not mean a circuit is correct. Routing is deterministic but bounded. The model is flat and capped at 512 components. Coverage percentages describe the exercised source, not the published package or every runtime.
- The 0.3.4 and 0.3.6 entries below are corrected in place: both announced a subpath the package export map did not expose, and the claim stood for three releases.

### Verified

- Every geometry diagnostic is asserted twice: once for the text it produces, and once by applying its own advice to the rejected document and compiling the result. Advice that fails to resolve the error fails the suite.

## [0.3.7] - 07/25/2026

### Fixed

- `@schemd/core/netlist` and `@schemd/core/describe` are importable. Both modules shipped in the tarball with no entry in the package `exports` map, so `import '@schemd/core/netlist'` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` while `dist/netlist.js` sat there unused — the netlist subpath since it was announced in 0.3.4, the describe subpath since 0.3.6. Nothing caught either, because every test imports from `src`, where subpaths do not exist.

### Verified

- A packaging test now decides, in one place, which source modules are public: every one of them must have a subpath, every subpath must resolve to the module it names, and no subpath may point at a module that is not there. Removing an entry fails the suite.

## [0.3.6] - 07/25/2026

### Added

- Diagrams can describe themselves. `describeSchematic` and `describeNetlist` derive a deterministic account of a document from its connectivity — scale and signal domain in one sentence fit for an `alt` attribute, an inventory grouped by kind, and one sentence per net naming the terminals it ties. Labels are flattened through the same `mathLabelText` the renderer uses, so `V_{in}` is spoken as `Vin` and `1 k\Omega` as `1 kΩ`. The description states only what the netlist proves: it does not name circuit archetypes, because recognising an intent the source never declared produces a confident wrong label, which is worse for a screen-reader user than an accurate structural one.
- The module is deliberately absent from the package entry, so neither size budget moves and a host that only compiles carries no prose generation. **Correction (0.3.7):** the module was intended to be reachable as `@schemd/core/describe`, but the required package export was missing until 0.3.7. Consumers of 0.3.6 cannot import that subpath.

### Verified

- Description output is covered to the project's 100% statement, branch, function, and line thresholds, including documents that declare nothing, a single component, labels that only repeat their identifier, and nouns whose plural is irregular.
- Both size budgets are unmoved from 0.3.5, because the entry point does not reach the new module.

## [0.3.5] - 07/25/2026

### Changed

- The router's spatial hash addresses both axes. Cells were keyed on x alone, so a single column held every obstacle stacked along it and a short segment paid the participation predicate and a slab test once per row — the quadratic term in routing a tall document. Obstacle and wire cells are now keyed on column and row, with a y-span rejection ahead of the exact predicates. Dense 16x16 routing drops from 7.7 ms to 4.1 ms, and a 512-component chain — one connection per component, the shape that provoked the old behaviour — from 40.4 ms to 16.3 ms. Output is byte-identical.
- Router lane candidates are gathered without intermediate arrays. Each list was built by spreading a two-element array per obstacle into a set; obstacle bounds are now added to the set directly. De-duplication still precedes the sort, because a grid repeats the same few coordinates on every row and collapsing runs after sorting proved markedly slower on exactly those documents.
- The slab test's first early-out is gone. The axis-aligned cases return before it, so both deltas are non-zero and no NaN can short-circuit; the clips are monotone, so an empty x interval stays empty and the second early-out already returns the same answer.

### Verified

- Output equivalence is checked against 173 documents — every diagram in the published documentation plus seeded random grids, including the 53 that compile to a diagnostic — by comparing SHA-256 digests of the compiled SVG before and after. All three changes are byte-identical to 0.3.4.
- Coverage, the targeted mutation gate, and the Chromium goldens all hold at their release thresholds. Removing the early-out kept branch coverage at 100% rather than stranding a branch the new filters made unreachable.

## [0.3.4] - 07/25/2026

### Added

- Connectivity is now a first-class artifact. `buildNetlist` returns the nodes, nets, and edges behind a validated document, `verifyNetlist` runs deterministic design rules over that model, and `inspectSchematic` does both in one call. Seven rules ship: shorted supply rails, conflicting bus widths, mixed signal domains, unconnected components, duplicate connections, contended digital drivers, and disconnected subcircuits. Diagnostics carry a stable code, a severity, the subjects involved, and the source line wherever a declaration owns the fault.
- `SCHEMATIC_RULES` publishes the rule catalogue — code, severity, and summary — so hosts can document or filter checks without hard-coding strings. **Correction (0.3.7):** the module was intended to be reachable as `@schemd/core/netlist`, but the required package export was missing until 0.3.7. Consumers of 0.3.4 through 0.3.6 cannot import that subpath.

### Changed

- Orthogonal routing no longer re-answers the same question. Obstacle participation is resolved once per route rather than once per segment query, obstacles spanning several buckets are examined once, and the innermost slab test allocates nothing. Dense 16x16 routing drops from 10.4 ms to 7.5 ms with byte-identical output.
- Every component emitted two label elements carrying identical paint. With a stylesheet present that paint now lives in the stylesheet; without one it travels on a single inherited group. Text lengths round through the shared number formatter, so `textLength="17.849999999999998"` is gone. A 512-component diagram falls from 279,243 to 246,987 bytes, a repeated instance from 541 to 478 bytes, and the Chromium goldens are unchanged.

### Verified

- Netlist extraction and every rule are covered to the project's 100% statement, branch, function, and line thresholds, including documents whose edges name components that were never declared.

## [0.3.3] - 07/21/2026

### Changed

- `cnot` is now an intrinsic two-track controlled-X with continuous control and target rails. Canonical `in1`/`out1` and `in2`/`out2` ports compose directly with quantum wires; legacy `in`, `out`, `control`, and `target` endpoint spellings remain valid.

### Verified

- A Chromium golden locks the two-rail CNOT geometry and its reversed horizontal orientation.

## [0.3.2] - 07/20/2026

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
- The component type guards and the SVG number formatter now have exactly one implementation each: the parser and renderer import layout's canonical guards, `svgNumber` is an alias of `formatNumber` (proven byte-identical across 2M sampled values), and the renderer's 24 repeated text-paint and 8 `lengthAdjust` attribute literals are shared fragments. Output is byte-identical.

### Fixed

- The public parser now validates and snapshots JavaScript-supplied source, bounds, and title values before parsing or routing, preventing raw `TypeError`s and geometry changes from volatile accessors.
- The documented legacy `schematic` fence identifier works again; recognition no longer rejects the alias before its compatibility grammar can run.
- `schematicSourceMap` now enforces the same parser-provenance boundary as the renderer instead of trusting forged mutable documents.
- The bounded SVG writer commits its byte count atomically, so a rejected multibyte append does not corrupt subsequent in-budget writes.
- Full-mode component accessibility labels now expose rendered Unicode micro-math text instead of raw `_`, brace, and backslash syntax.
- Grammar documentation no longer claims unsupported delimiter escaping.

### Verified

- Compiler bundle: 101,672 B minified, 30,348 B gzip — 372 B below the 30,720 B gate.
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
