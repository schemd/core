import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mutants = [
	{
		name: 'shared terminals must unify inferred nets',
		file: 'src/parser.ts',
		from: 'if (owner === undefined) terminalOwner.set(key, index);\n\t\t\telse union(index, owner);',
		to: 'if (owner === undefined) terminalOwner.set(key, index);\n\t\t\telse union(index, index);',
		tests: ['tests/topology.test.ts']
	},
	{
		name: 'equal explicit net names must unify disconnected terminals',
		file: 'src/parser.ts',
		from: 'if (owner === undefined) namedOwner.set(connection.net, index);\n\t\t\telse union(index, owner);',
		to: 'if (owner === undefined) namedOwner.set(connection.net, index);\n\t\t\telse union(index, index);',
		tests: ['tests/topology.test.ts']
	},
	{
		name: 'connector labels remain routing obstacles',
		file: 'src/layout.ts',
		from: "return endpoint ? entry.kind === 'body' : entry.kind !== 'body';",
		to: "return entry.kind === 'body';",
		tests: ['tests/layout.test.ts']
	},
	{
		name: 'a contact the validator rejects must cost the router infinity',
		file: 'src/layout.ts',
		from: '\t\t\t\tif (!contact.strict || contact.overlap || !previous.orthogonal) {\n\t\t\t\t\treturn Number.POSITIVE_INFINITY;\n\t\t\t\t}',
		to: '\t\t\t\tif (false) {\n\t\t\t\t\treturn Number.POSITIVE_INFINITY;\n\t\t\t\t}',
		tests: ['tests/layout.test.ts', 'tests/regressions.test.ts']
	},
	{
		name: 'strict crossings stay cheaper than a blocked channel',
		file: 'src/layout.ts',
		from: 'cost += ROUTER_CROSSING_PENALTY;',
		to: 'cost += ROUTER_CROSSING_PENALTY * 0;',
		tests: ['tests/layout.test.ts', 'tests/topology.test.ts', 'tests/regressions.test.ts']
	},
	{
		name: 'terminal approaches are reserved before any wire is placed',
		file: 'src/layout.ts',
		from: '\t\tif (connection.curve !== \'ortho\') continue;',
		to: '\t\tif (connection.curve === \'ortho\') continue;',
		tests: ['tests/regressions.test.ts']
	},
	{
		name: 'a blocked channel offers a lane one pitch aside',
		file: 'src/layout.ts',
		from: 'const ROUTER_CHANNEL_PITCH = 12;',
		to: 'const ROUTER_CHANNEL_PITCH = 0;',
		tests: ['tests/layout.test.ts', 'tests/regressions.test.ts']
	},
	{
		name: 'port aliases resolve to one canonical terminal',
		file: 'src/layout.ts',
		from: '\t\ttable.get(port) ?? table.get(terminalPointKey(resolvePortPoint(component, port))) ?? port',
		to: '\t\ttable.get(port) ?? port',
		tests: ['tests/regressions.test.ts']
	},
	{
		name: 'a closed marker keeps its trace out of a compound path',
		file: 'src/renderer.ts',
		from: "\t\tconst key = markerAttributes.includes('marker-')",
		to: "\t\tconst key = markerAttributes.includes('marker-') && false",
		tests: ['tests/renderer.test.ts', 'tests/regressions.test.ts']
	},
	{
		name: 'vertically touching component bounds are not overlaps',
		file: 'src/layout.ts',
		from: 'left.maxY > right.minY',
		to: 'left.maxY >= right.minY',
		tests: ['tests/layout.test.ts']
	},
	{
		name: 'open triangle interiors stay transparent',
		file: 'src/renderer.ts',
		from: 'd="M0 1 11 6 0 11Z" fill="none"',
		to: 'd="M0 1 11 6 0 11Z" fill="context-stroke"',
		tests: ['tests/renderer.test.ts']
	}
];

const sandbox = await mkdtemp(join(tmpdir(), 'schemd-mutation-'));
try {
	for (const path of ['src', 'tests']) await cp(join(root, path), join(sandbox, path), { recursive: true });
	for (const path of ['package.json', 'tsconfig.json', 'vitest.config.ts']) {
		await cp(join(root, path), join(sandbox, path));
	}
	await symlink(join(root, 'node_modules'), join(sandbox, 'node_modules'), 'dir');
	const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
	const survivors = [];

	for (const mutant of mutants) {
		const path = join(sandbox, mutant.file);
		const original = await readFile(join(root, mutant.file), 'utf8');
		const first = original.indexOf(mutant.from);
		if (first < 0 || original.indexOf(mutant.from, first + mutant.from.length) >= 0) {
			throw new Error(`Mutation target must occur exactly once: ${mutant.name}`);
		}
		await writeFile(path, original.replace(mutant.from, mutant.to));
		const result = spawnSync(process.execPath, [vitest, 'run', ...mutant.tests], {
			cwd: sandbox,
			env: { ...process.env, FORCE_COLOR: '0' },
			encoding: 'utf8',
			timeout: 45_000
		});
		await writeFile(path, original);
		if (result.error !== undefined && result.error.code !== 'ETIMEDOUT') throw result.error;
		if (result.status === 0) {
			survivors.push({ mutant, output: `${result.stdout}${result.stderr}` });
			console.error(`SURVIVED  ${mutant.name}`);
		} else {
			console.log(`KILLED    ${mutant.name}`);
		}
	}

	if (survivors.length > 0) {
		for (const { mutant, output } of survivors) {
			console.error(`\n--- ${mutant.name} ---\n${output.trim()}`);
		}
		process.exitCode = 1;
	} else {
		console.log(`\nMutation score: 100% (${mutants.length}/${mutants.length} killed)`);
	}
} finally {
	await rm(sandbox, { recursive: true, force: true });
}
