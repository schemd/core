/**
 * Two budgets, because there are two honest answers to "how big is schemd?".
 *
 * The compiler budget measures what a host pays to *compile*: the entry tree
 * shaken down to `compileSchematic`. That is the figure the README quotes and
 * the one a real consumer ships.
 *
 * The package budget measures the whole public entry with nothing shaken away —
 * what registry size tools such as Bundlephobia report, because they bundle
 * `import * from '@schemd/core'`. Every export lands in it, including ones a
 * given host never calls. Tracking only the first budget let the published
 * figure move 1.8 KB in 0.3.4 with no gate noticing.
 */
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const BUDGETS = [
	{
		label: 'Compiler bundle (tree-shaken to compileSchematic)',
		module: '../src/compiler.ts',
		entry: (path) =>
			`import { compileSchematic } from ${JSON.stringify(path)};globalThis.schemdCompile=compileSchematic;`,
		/*
		 * 34 KiB from 32 in 0.5. Relative placement does not tree-shake out of this
		 * budget and was never going to: it is a language feature, so `parseSchematic`
		 * calls the lowering pass on every document and a host that compiles at all
		 * carries it. The routing report is the same story from the other side — the
		 * router is already here, and the report is what it now records while working.
		 * Recorded rather than absorbed, and paid for by features rather than drift.
		 */
		/*
		 * 35 KiB from 34 in 0.7, for bundle nudging. Like relative placement before
		 * it this cannot tree-shake out of the compile path — it is reached from
		 * `routeWithRipUp`, so every document that routes carries it — and it buys
		 * a reversal bus of thirty-two wires where twelve was previously recorded
		 * as a hard limit of the channel model. Roughly 380 B, measured, and paid
		 * for by a capability rather than by drift.
		 *
		 * Four separate attempts to buy it back are recorded in `O5Idea.md` §13:
		 * packed encodings, glyph tables and literal hoisting each made the gzipped
		 * bundle *larger* despite shrinking the minified one. This bundle sits at a
		 * gzip-efficiency floor, so the honest move is to record the cost here
		 * rather than to chase it.
		 */
		/*
		 * 36 KiB from 35 in 0.8. The edge-price cache is 127 B. Trunk branches
		 * are about 1,150 B: roughly 800 of routing, anchoring and junction drawing,
		 * and 355 of the five diagnostics that say which end joins the net and how
		 * to fix a branch with nothing to tap. Stubbing those sentences out was
		 * measured rather than assumed, and is not an option this project takes —
		 * a diagnostic that does not say how to fix the diagram is the defect.
		 * Trunks cannot tree-shake out of this budget because `trunk` is syntax:
		 * every document is parsed by the code that resolves it.
		 */
		/*
		 * 38 KiB from 36 in 0.8, for sub-circuits: about 1,400 B of expansion — renaming,
		 * offsetting, parameter binding, and resolving exposed terminals through
		 * nested instances — and 684 B for the twenty-one diagnostics that name
		 * which block, instance, parameter or terminal is wrong and what to write
		 * instead. Measured by stubbing the sentences in a scratch tree. Like
		 * trunks, `subcircuit` is syntax, so it is carried by every host that
		 * parses; a document that defines none skips the pass after one scan.
		 */
		/*
		 * 40 KiB from 38 in 1.0, and brotli-11 now gated beside gzip. The rebuild
		 * deleted the per-connection router with its reorder, rip-up rescue and
		 * bundle nudging, the per-kind switches, and the hand-written scanner
		 * (the 0.x patterns with the `d` flag give the same columns), and paid
		 * for: routing by net with trees and junctions by default, negotiated
		 * congestion with history (PathFinder), a spatial index that keeps
		 * compilation linear, exact integer geometry, wires that keep clear of
		 * text and free pins, pins entered along their axis, the diagnostics
		 * model behind `diagnoseSchematic`, and new diagnostics that say how to
		 * fix what they report. Net cost about 2.4 KiB gzip over 0.8. Measured against the 0.8.0 build: the routing
		 * stack is where the bytes are, and it is code, which compresses worse
		 * than the templates it replaced. The one lever left — moving diagnostic
		 * prose behind codes, about 2.9 KiB — is not one this project takes.
		 */
		/*
		 * 42 KiB from 40 before 1.0 shipped, both measured against the build
		 * before them. 669 B gzip for text measured against Arial's advances
		 * instead of one cell width — so labels are no longer squeezed by
		 * `textLength` — and placement that reports every broken relation with
		 * its columns. 1,344 B for what a seeded property search over random
		 * layouts found the router drawing wrongly, and for wires that meet at
		 * a junction part instead of tapping each other beside it: dots where a wire crosses
		 * its own net, loops drawn along the tree, other nets' leads treated as
		 * contact, leads checked against bodies and free pins with diagnostics
		 * that name both parts, one bridge where a connection is written twice,
		 * and bridges that stop short of a junction.
		 */
		/*
		 * 44 KiB from 42 in 1.1, measured against the 1.0.2 build: 42,765 B to
		 * 44,602 B gzip, 37,207 B to 38,793 B brotli-11. `fit=wires` is about
		 * 1,450 B of code — reading each terminal's wire, filling the unwired
		 * ones, centring the part, and drawing rails and pins from where they
		 * landed — together with `aligned-y with B.out at in2`, the copper-graph
		 * node that stops a repeated junction connection from crashing, and the
		 * lowest rail's terminal facing down. 386 B is the seven diagnostics that
		 * say which terminal cannot line up and the height that would let it,
		 * measured by stubbing them in a scratch tree. `fit` is an option every
		 * kind's parser reads, and fitting runs in `parseSchematic`, so it cannot
		 * tree-shake out of this path; a document with no fitted part skips the
		 * pass after one filter.
		 */
		/*
		 * 46 KiB from 44, and 40 KiB brotli-11 from 38.5, for a measured sheet
		 * and draft placement: 44,731 B to 46,407 B gzip, 38,894 B to 40,317 B
		 * brotli-11. The sheet is 524 B — routing on an open canvas, measuring
		 * parts, traces and wire labels, and writing a viewBox that starts where
		 * the drawing does. The draft pass is 1,118 B: following each wire to a
		 * part with no position, stepping aside when the place is taken, rows for
		 * parts no wire reaches, and holding back the relations that refer to a
		 * drafted part. Reading a missing `bounds` as `auto` is 34 B. Neither can
		 * tree-shake out: a fence or a declaration with no position is syntax,
		 * and `parseSchematic` reads both. A document that states its bounds and
		 * every position skips both after one comparison each.
		 */
		maxGzipBytes: 46 * 1024,
		maxBrotliBytes: 40 * 1024
	},
	{
		label: 'Package bundle (every public export)',
		module: '../src/index.ts',
		entry: (path) => `import * as schemd from ${JSON.stringify(path)};globalThis.schemd=schemd;`,
		/* 37 KiB from 35 in 0.5, for the same two features plus their exported types. */
		/* 39 KiB from 37 in 0.8: the 116 B left over could not hold trunks, and
		   the decompiler reads them back too. 41 KiB from 39 in 0.8, for sub-circuits. */
		/* 43 KiB from 41 in 1.0, for the same machinery plus `diagnoseSchematic`;
		   45 KiB for the measured text and layout fixes above. 47 KiB in 1.1, for
		   fitting and terminal alignment as above, and the decompiler reading
		   `fit=wires` back (45,948 B to 47,690 B gzip). */
		/* 49 KiB and 42.5 KiB brotli-11 for the measured sheet and draft
		   placement above plus the four draft constants and the sheet margin
		   (47,806 B to 49,662 B gzip, 41,511 B to 43,120 B brotli-11). */
		maxGzipBytes: 49 * 1024,
		maxBrotliBytes: 42.5 * 1024
	},
	{
		label: 'Schema entry (@schemd/core/schema)',
		module: '../src/schema.ts',
		entry: (path) => `import * as schema from ${JSON.stringify(path)};globalThis.schemdSchema=schema;`,
		/*
		 * New in 1.3. The schema is data, but describeComponentPorts asks the
		 * symbol registry for a kind's ports, so the parsers of every kind come
		 * with it. Only a tool that lists components imports this entry; the two
		 * budgets above do not include it. 16,465 B gzip and 14,565 B brotli-11
		 * when it was added; nearly all of it is the symbol registry.
		 */
		maxGzipBytes: 16.5 * 1024,
		maxBrotliBytes: 14.5 * 1024
	}
];

const virtualEntry = 'virtual:schemd-size-entry';

/** Bundle one entry and return its minified and gzip byte counts. */
async function measure({ module, entry }) {
	const modulePath = fileURLToPath(new URL(module, import.meta.url));
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		plugins: [
			{
				name: 'schemd-size-entry',
				enforce: 'pre',
				resolveId(id) {
					if (id === virtualEntry) return `\0${virtualEntry}`;
				},
				load(id) {
					if (id === `\0${virtualEntry}`) return entry(modulePath);
				}
			}
		],
		build: {
			minify: true,
			rollupOptions: { input: virtualEntry, treeshake: true },
			target: 'es2022',
			write: false
		}
	});

	const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
	const chunks = outputs.filter((item) => item.type === 'chunk' && item.code.length > 0);
	if (chunks.length !== 1) throw new Error(`Expected one chunk; received ${chunks.length}.`);
	return {
		minifiedBytes: Buffer.byteLength(chunks[0].code),
		gzipBytes: gzipSync(chunks[0].code, { level: 9 }).byteLength,
		brotliBytes: brotliCompressSync(chunks[0].code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength
	};
}

const failures = [];
for (const budget of BUDGETS) {
	const { minifiedBytes, gzipBytes, brotliBytes } = await measure(budget);
	const headroom = budget.maxGzipBytes - gzipBytes;
	if (brotliBytes > budget.maxBrotliBytes) {
		failures.push(
			`${budget.label} exceeds its ${budget.maxBrotliBytes.toLocaleString('en-US')} B brotli-11 budget by ${(brotliBytes - budget.maxBrotliBytes).toLocaleString('en-US')} B.`
		);
	}
	console.log(
		`${budget.label}: ${minifiedBytes.toLocaleString('en-US')} B minified, ${brotliBytes.toLocaleString('en-US')} B brotli-11, ${gzipBytes.toLocaleString('en-US')} B gzip ` +
			`(${
				headroom >= 0
					? `${headroom.toLocaleString('en-US')} B under`
					: `${(-headroom).toLocaleString('en-US')} B over`
			} the ${budget.maxGzipBytes.toLocaleString('en-US')} B budget)`
	);
	if (headroom < 0) {
		failures.push(
			`${budget.label} exceeds its ${budget.maxGzipBytes.toLocaleString('en-US')} B gzip budget by ${(-headroom).toLocaleString('en-US')} B.`
		);
	}
}

if (failures.length > 0) throw new Error(failures.join('\n'));
