# Migrating from 0.2.x to 0.3.0

1. Pin `@schemd/core@0.3.0` and keep Node.js 24 or newer.
2. Existing source can remain unchanged. Missing orientation is the right-facing legacy default.
3. Replace generic blocks and hand-positioned workarounds with the new typed primitives. In particular, use `source`, `junction`, and `capacitor [orientation=down]` for an RC shunt branch.
4. If you consume the public AST, add the new `ElectricalComponent`, `DigitalComponent`, `QuantumSpecialComponent`, and expanded `UmlComponent` discriminants to exhaustive switches. `orientation` is additive on directional nodes.
5. If you inspect full-mode SVG, prefer the documented node/port/wire datasets and source-map API. Do not depend on private wrapper order or handcrafted path strings.
6. Preserve historical 0.2.x documentation/examples when rendering versioned content; 0.3.0 syntax is not valid evidence of 0.2.x support.

Connection signal domains and bus widths are now explicit and validated. A quantum wire should use `[quantum]`, a measurement result `[classical]`, and a multi-bit digital connection `[digital width=N]`. Invalid ports or width mismatches now fail rather than rendering detached traces.

The compiler budget increased from 20 KiB to 30 KiB gzip to accommodate the required multi-domain primitives. This is a hard ceiling, not a target: 0.3.0 remains below it and retains zero runtime dependencies.
