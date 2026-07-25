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
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const BUDGETS = [
	{
		label: 'Compiler bundle (tree-shaken to compileSchematic)',
		module: '../src/compiler.ts',
		entry: (path) =>
			`import { compileSchematic } from ${JSON.stringify(path)};globalThis.schemdCompile=compileSchematic;`,
		maxGzipBytes: 31 * 1024
	},
	{
		label: 'Package bundle (every public export)',
		module: '../src/index.ts',
		entry: (path) => `import * as schemd from ${JSON.stringify(path)};globalThis.schemd=schemd;`,
		maxGzipBytes: 34 * 1024
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
		gzipBytes: gzipSync(chunks[0].code, { level: 9 }).byteLength
	};
}

const failures = [];
for (const budget of BUDGETS) {
	const { minifiedBytes, gzipBytes } = await measure(budget);
	const headroom = budget.maxGzipBytes - gzipBytes;
	console.log(
		`${budget.label}: ${minifiedBytes.toLocaleString('en-US')} B minified, ${gzipBytes.toLocaleString('en-US')} B gzip ` +
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
