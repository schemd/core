# Performance and size

The release gate bundles the public compiler entry with Vite, minifies it for ES2022, and gzips at level 9. `bun run size` fails above exactly 30,720 B. The 0.3.2 release candidate measures 99,378 B minified and 29,196 B gzip, leaving 1,524 B of enforced headroom.

The compiler has zero runtime dependencies. Parsing and rendering are bounded by exported resource limits. Orthogonal routing uses deterministic obstacle geometry, a one-channel fast path, cached document routes, sparse fallback search, and a hard state ceiling. Mixed-curve topology checks use spatial buckets, and component overlap detection uses an x-ordered, lazily expired y-bucket sweep rather than a document-wide pair scan. Route-cache identity does not serialize the document or duplicate derived orientation state.

Run the reproducible local matrix after a build:

```sh
bun run benchmark
```

It reports median latency and SVG bytes for a representative compile, the 512-component ceiling, a dense 16-by-16 crossing fixture, and repeated-symbol output. Across three isolated runs on Node.js 26.4.0 / Apple Silicon, the median run measured 0.213 ms / 6,038 B, 5.626 ms / 279,243 B, and 3.783 ms / 44,604 B for those workloads. The extra dense-route cost enforces net-aware contacts and bridge ownership; timing is machine-specific, while byte measurements are deterministic for the audited source.

Generated output is guarded by regression fixtures: an individual unused family contributes zero bytes, rotation is an instance transform, and repeated canonical components amortize their vector definition.
