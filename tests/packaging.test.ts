/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

import manifest from '../package.json';

/**
 * The package's public surface must be reachable by the names the docs promise.
 *
 * Two releases shipped a module that could not be imported: `@schemd/core/netlist`
 * was announced in 0.3.4 and `@schemd/core/describe` in 0.3.6, and both landed in
 * the tarball with no `exports` entry, so `import '@schemd/core/netlist'` failed
 * with ERR_PACKAGE_PATH_NOT_EXPORTED while the file sat unused in `dist`. Nothing
 * caught it because every test imports from `../src`, where subpaths do not exist.
 *
 * A module is either public — exported, documented, supported — or internal.
 * Deciding that here, once, is what keeps the two from drifting apart.
 *
 * The source list comes from Vite's glob rather than `node:fs`: this package
 * declares no Node type dependency and should not grow one for a test.
 */

const INTERNAL_MODULES = new Set(['index', 'limits', 'route-cache', 'xml']);

const sourceModules = Object.keys(import.meta.glob('../src/*.ts'))
	.map((path) => path.replace('../src/', '').replace(/\.ts$/, ''))
	.sort();

const subpaths = Object.keys(manifest.exports).filter((key) => key !== '.');
const exportedModules = new Set(subpaths.map((key) => key.replace('./', '')));

describe('package exports', () => {
	it('finds the source modules it is meant to police', () => {
		/* A glob that silently matched nothing would make every other case pass. */
		expect(sourceModules).toContain('describe');
		expect(sourceModules).toContain('netlist');
		expect(sourceModules.length).toBeGreaterThan(6);
	});

	it('gives every public source module an importable subpath', () => {
		const missing = sourceModules.filter(
			(module) => !INTERNAL_MODULES.has(module) && !exportedModules.has(module)
		);
		expect(missing, `public modules with no exports entry: ${missing.join(', ')}`).toEqual([]);
	});

	it('points every subpath at the module it names', () => {
		for (const subpath of subpaths) {
			const name = subpath.replace('./', '');
			const entry = (manifest.exports as Record<string, { types?: string; import?: string }>)[
				subpath
			]!;
			/* A copy-pasted block keeping the previous module's path would pass
			   every check but this one. */
			expect(entry.import, `${subpath} points at the wrong module`).toBe(`./dist/${name}.js`);
			expect(entry.types, `${subpath} types point at the wrong module`).toBe(
				`./dist/${name}.d.ts`
			);
		}
	});

	it('exports no subpath without a source module behind it', () => {
		const orphans = [...exportedModules].filter((name) => !sourceModules.includes(name));
		expect(orphans, `subpaths with no source module: ${orphans.join(', ')}`).toEqual([]);
	});

	it('ships the directory every subpath resolves into', () => {
		expect(manifest.files).toContain('dist');
		expect(manifest.exports['.']?.import).toBe('./dist/index.js');
	});
});
