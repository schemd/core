# Performance and size

The release gate bundles the public compiler entry with Vite, minifies it for ES2022, and gzips at level 9. `bun run size` fails above exactly 30,720 B. The 0.3.2 release candidate measures 102,622 B minified and 30,241 B gzip, leaving 479 B of enforced headroom.

The compiler has zero runtime dependencies. Parsing and rendering are bounded by exported resource limits. Orthogonal routing builds one x-bucket obstacle index per document, reuses query stamps without allocating per-edge de-duplication sets, prunes lanes that cannot improve the current route, and falls back to a sparse search with a hard state ceiling. Completed source-ordered routes add wire occupancy and connector-label rectangles to that index. Mixed-curve topology checks use separate spatial buckets, and component overlap detection uses an x-ordered, lazily expired y-bucket sweep rather than a document-wide pair scan. Route-cache identity does not serialize the document or duplicate derived orientation state.

Run the reproducible local matrix after a build:

```sh
bun run benchmark
```

It reports median latency and SVG bytes for a representative compile, the 512-component ceiling, a dense 16-by-16 crossing fixture, and repeated-symbol output. It also fails deliberately generous 2 ms, 30 ms, and 75 ms regression ceilings; these are CI tripwires, not latency SLAs. Across three isolated runs on Node.js 26.4.0 / Apple Silicon, the median run measured 0.249 ms / 6,038 B, 5.727 ms / 279,243 B, and 10.705 ms / 44,185 B for those workloads. The dense fixture now prices every earlier wire channel while retaining bridge correctness; timing is machine-specific, while byte measurements are deterministic for the audited source.

`bun run test:fuzz` replays the deterministic 84-document route corpus. `bun run test:mutation` copies only local source/tests into an isolated temporary tree, applies seven bounded critical-path mutants, and fails unless all seven are killed. Neither gate adds a runtime dependency or enters the published package.

Generated output is guarded by regression fixtures: an individual unused family contributes zero bytes, rotation is an instance transform, and repeated canonical components amortize their vector definition.
