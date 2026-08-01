/**
 * Byte-identity corpus: the gate that makes a refactor provable.
 *
 * The 0.3.5 release validated three router changes by comparing SHA-256 digests
 * of compiled SVG across a corpus, but the harness was a one-off and was never
 * committed — so every subsequent refactor has had to re-argue the same point
 * from goldens and unit tests, which cover behaviour rather than bytes.
 *
 * This is that harness, committed. It compiles a deterministic corpus spanning
 * every component family, every output mode and every routing strategy, and
 * digests each result. A document that *fails* to compile is digested by its
 * diagnostic, because "this source is rejected with this message on this line"
 * is exactly as load-bearing as "this source compiles to these bytes" — 53 of
 * the documents in the 0.3.5 run were diagnostics, and a refactor that silently
 * changed one would be a regression the goldens could not see.
 *
 *   node scripts/corpus.mjs --write     record the baseline
 *   node scripts/corpus.mjs             compare against it, non-zero on drift
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileSchematic } from '../dist/index.js';
import { COMPONENT_KINDS, SEMANTIC_COLORS, SCHEMD_OUTPUT_MODES } from '../dist/types.js';

const BASELINE = fileURLToPath(new URL('../tests/fixtures/corpus-baseline.json', import.meta.url));

/**
 * Deterministic 32-bit generator.
 *
 * `Math.random` would make a failure unreproducible, which is the one thing a
 * regression corpus cannot afford. Mulberry32 is four operations and needs no
 * dependency.
 *
 * @param seed - Any 32-bit integer.
 * @returns A function yielding the next value in `[0, 1)`.
 */
function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Every kind rendered on its own, so no family can change unobserved. */
function singletonDocuments() {
	const documents = [];
	for (const kind of COMPONENT_KINDS) {
		documents.push({
			name: `singleton/${kind}`,
			source: `${kind}:N1 "Label" at (200, 200) #amber`,
			fence: { bounds: { width: 400, height: 400 }, title: 'singleton' },
			mode: 'full'
		});
	}
	return documents;
}

/** Each family's variant axis, so a `type=` option cannot drift silently. */
function variantDocuments() {
	const axes = [
		['resistor', 'type', ['fixed', 'variable', 'rheostat', 'potentiometer', 'thermistor', 'ldr']],
		['diode', 'type', ['standard', 'schottky', 'zener', 'led', 'photodiode', 'varactor', 'scr', 'triac']],
		['transistor', 'type', ['npn', 'pnp', 'nmos', 'pmos', 'njfet', 'pjfet', 'nigbt', 'pigbt']],
		['ground', 'style', ['chassis', 'earth', 'signal']],
		['source', 'type', ['voltage-dc', 'voltage-ac', 'battery', 'vcvs', 'cccs']],
		['switch', 'type', ['spst', 'spdt', 'pushbutton', 'relay']],
		['buffer', 'type', ['plain', 'tristate', 'schmitt']],
		['flipflop', 'type', ['sr-latch', 'd-latch', 'd', 'jk', 't']],
		['logic', 'state', ['high', 'low', 'unknown', 'high-z']]
	];
	const documents = [];
	for (const [kind, option, values] of axes) {
		for (const value of values) {
			documents.push({
				name: `variant/${kind}/${value}`,
				source: `${kind}:N1 "V" at (200, 200) #cyan [${option}=${value}]`,
				fence: { bounds: { width: 400, height: 400 }, title: 'variant' },
				mode: 'full'
			});
		}
	}
	return documents;
}

/** Orientation is a whole geometry path; four turns per representative kind. */
function orientationDocuments() {
	const documents = [];
	for (const kind of ['resistor', 'diode', 'transistor', 'source', 'ic', 'hadamard']) {
		for (const orientation of ['right', 'down', 'left', 'up']) {
			documents.push({
				name: `orientation/${kind}/${orientation}`,
				source: `${kind}:N1 "O" at (250, 250) #blue [orientation=${orientation}]`,
				fence: { bounds: { width: 500, height: 500 }, title: 'orientation' },
				mode: 'full'
			});
		}
	}
	return documents;
}

/** Every routing strategy and marker family, which is where geometry is hardest. */
function routingDocuments() {
	const documents = [];
	for (const curve of ['line', 'bezier', 'ortho']) {
		for (const marker of ['none', 'arrow', 'dot', 'diamond-filled', 'triangle-open']) {
			const option = marker === 'none' ? curve : `${curve} marker-end=${marker}`;
			documents.push({
				name: `routing/${curve}/${marker}`,
				source: [
					'port:A "A" at (100, 200) #blue',
					'port:B "B" at (600, 400) #emerald [orientation=left]',
					`A.out -> B.in #blue [${option}]`
				].join('\n'),
				fence: { bounds: { width: 800, height: 600 }, title: 'routing' },
				mode: 'full'
			});
		}
	}
	return documents;
}

/** Seeded grids: the shape that exercises the router's spatial hash and rip-up. */
function randomGridDocuments() {
	const documents = [];
	for (let seed = 1; seed <= 40; seed += 1) {
		const random = mulberry32(seed * 2654435761);
		const size = 3 + Math.floor(random() * 4);
		const lines = [];
		for (let index = 0; index < size * size; index += 1) {
			const color = SEMANTIC_COLORS[Math.floor(random() * SEMANTIC_COLORS.length)];
			const orientation = ['right', 'down', 'left', 'up'][Math.floor(random() * 4)];
			lines.push(
				`resistor:R${index} "R${index}" at (${120 + (index % size) * 160}, ${120 + Math.floor(index / size) * 160}) #${color} [orientation=${orientation}]`
			);
		}
		const wires = Math.floor(random() * size) + 1;
		for (let index = 0; index < wires; index += 1) {
			const from = Math.floor(random() * size * size);
			const to = Math.floor(random() * size * size);
			if (from === to) continue;
			const curve = ['line', 'bezier', 'ortho'][Math.floor(random() * 3)];
			lines.push(`R${from}.out -> R${to}.in #slate [${curve}]`);
		}
		documents.push({
			name: `grid/seed-${seed}`,
			source: lines.join('\n'),
			fence: { bounds: { width: 1400, height: 1400 }, title: `grid ${seed}` },
			mode: 'full'
		});
	}
	return documents;
}

/** Relative placement, whose whole contract is that it lowers to absolute. */
function placementDocuments() {
	const relations = ['right-of', 'left-of', 'above', 'below'];
	const documents = [];
	for (const relation of relations) {
		documents.push({
			name: `placement/${relation}`,
			source: [
				'source:VIN "AC" at (300, 300) #blue [type=voltage-ac]',
				`resistor:R1 "1k" ${relation} VIN by 190 #amber`,
				'junction:J1 "J" aligned-y with R1 #cyan'
			].join('\n'),
			fence: { bounds: { width: 900, height: 900 }, title: 'placement' },
			mode: 'full'
		});
	}
	return documents;
}

/** Output modes and semantic hooks change the writer's path, not the geometry. */
function modeDocuments() {
	const source = [
		'source:VIN "AC" at (90, 150) #blue [type=voltage-ac]',
		'resistor:R1 "1 k\\Omega" at (280, 150) #amber',
		'junction:VOUT "V_{out}" at (470, 150) #cyan',
		'capacitor:C1 "100 nF" at (470, 290) #cyan [orientation=down]',
		'VIN.positive -> R1.in #blue [line]',
		'R1.out -> VOUT.node #amber [line]',
		'VOUT.node -> C1.in #cyan [ortho]'
	].join('\n');
	const documents = [];
	for (const mode of SCHEMD_OUTPUT_MODES) {
		documents.push({
			name: `mode/${mode}`,
			source,
			fence: { bounds: { width: 760, height: 460 }, title: 'RC low-pass filter' },
			mode
		});
	}
	documents.push({
		name: 'mode/full+hooks',
		source,
		fence: { bounds: { width: 760, height: 460 }, title: 'RC low-pass filter' },
		mode: 'full',
		semanticHooks: ['nodes', 'ports', 'wires']
	});
	return documents;
}

/**
 * Documents that must be *rejected*.
 *
 * A refactor that changed one of these from an error to a compile — or merely
 * moved the line number — would be a silent behavioural change no golden covers.
 */
function diagnosticDocuments() {
	const cases = [
		['unknown-kind', 'nonesuch:N1 "X" at (10, 10) #amber'],
		['duplicate-id', 'resistor:R1 "A" at (100, 100) #amber\nresistor:R1 "B" at (200, 200) #blue'],
		['unknown-port', 'resistor:R1 "A" at (100, 100) #amber\nresistor:R2 "B" at (300, 100) #blue\nR1.nope -> R2.in #amber [line]'],
		['self-wire', 'resistor:R1 "A" at (100, 100) #amber\nR1.in -> R1.in #amber [line]'],
		['out-of-bounds', 'resistor:R1 "A" at (100000, 100000) #amber'],
		['bad-color', 'resistor:R1 "A" at (100, 100) #notacolor'],
		['empty-document', '// only a comment'],
		['unknown-option', 'resistor:R1 "A" at (100, 100) #amber [nonsense=1]'],
		['duplicate-option', 'resistor:R1 "A" at (100, 100) #amber [orientation=up orientation=down]'],
		['placement-cycle', 'resistor:R1 "A" right-of R2 by 100 #amber\nresistor:R2 "B" right-of R1 by 100 #blue'],
		['missing-reference', 'resistor:R1 "A" right-of GHOST by 100 #amber'],
		['overlap', 'resistor:R1 "A" at (200, 200) #amber\nresistor:R2 "B" at (210, 200) #blue'],
		['width-mismatch', 'bus:B1 "B" at (100, 100) #amber [width=8]\nbus:B2 "C" at (400, 100) #blue [width=4]\nB1.out -> B2.in #amber [line width=8]'],
		['bad-bounds', 'resistor:R1 "A" at (100, 100) #amber']
	];
	return cases.map(([name, source], index) => ({
		name: `diagnostic/${name}`,
		source,
		fence:
			name === 'bad-bounds'
				? { bounds: { width: 0, height: 0 }, title: 'bad' }
				: { bounds: { width: 800, height: 600 }, title: 'diagnostic' },
		mode: 'full'
	}));
}

/** The whole corpus, in a stable order. */
export function corpusDocuments() {
	return [
		...singletonDocuments(),
		...variantDocuments(),
		...orientationDocuments(),
		...routingDocuments(),
		...randomGridDocuments(),
		...placementDocuments(),
		...modeDocuments(),
		...diagnosticDocuments()
	];
}

/**
 * Compile one document to a digest.
 *
 * The digest covers the SVG *and* the derived artifacts a host can observe, so
 * a refactor that changed the source map, the placements or the routing report
 * while leaving the markup alone is still caught.
 *
 * @param entry - One corpus document.
 * @returns A stable `sha256` over the observable result, compiled or rejected.
 */
export function digestDocument(entry) {
	const hash = createHash('sha256');
	try {
		const result = compileSchematic(entry.source, {
			...entry.fence,
			mode: entry.mode,
			...(entry.semanticHooks ? { semanticHooks: entry.semanticHooks } : {})
		});
		hash.update('ok ');
		hash.update(result.svg);
		hash.update(' sourceMap ');
		hash.update(JSON.stringify(result.sourceMap ?? null));
		hash.update(' placements ');
		hash.update(JSON.stringify(result.placements ?? null));
		hash.update(' routing ');
		hash.update(JSON.stringify(result.routing ?? null));
	} catch (error) {
		/* The diagnostic is the observable result. Its text and its line are
		   both contract, so both go into the digest. */
		hash.update('error ');
		hash.update(String(error?.message ?? error));
		hash.update(' line ');
		hash.update(String(error?.line ?? ''));
	}
	return hash.digest('hex');
}

/** Digest the whole corpus. */
export function digestCorpus() {
	const digests = {};
	for (const entry of corpusDocuments()) digests[entry.name] = digestDocument(entry);
	return digests;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
	const digests = digestCorpus();
	const count = Object.keys(digests).length;
	if (process.argv.includes('--write')) {
		writeFileSync(BASELINE, `${JSON.stringify(digests, undefined, '\t')}\n`);
		console.log(`Recorded ${count} corpus digests.`);
	} else if (!existsSync(BASELINE)) {
		console.error('No baseline recorded. Run: node scripts/corpus.mjs --write');
		process.exit(1);
	} else {
		const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
		const drift = [];
		for (const [name, digest] of Object.entries(digests)) {
			if (baseline[name] === undefined) drift.push(`+ ${name} (new)`);
			else if (baseline[name] !== digest) drift.push(`~ ${name} (changed)`);
		}
		for (const name of Object.keys(baseline)) {
			if (digests[name] === undefined) drift.push(`- ${name} (missing)`);
		}
		if (drift.length > 0) {
			console.error(`Corpus drift in ${drift.length} of ${count} documents:`);
			for (const line of drift.slice(0, 40)) console.error(`  ${line}`);
			process.exit(1);
		}
		console.log(`${count} corpus documents byte-identical to baseline.`);
	}
}
