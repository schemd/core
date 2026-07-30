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
		name: 'a caller-supplied budget is enforced, not merely accepted',
		file: 'src/limits.ts',
		from: '\t\tresolved[name] = limit;',
		to: '\t\tresolved[name] = resolved[name]!;',
		tests: ['tests/regressions.test.ts']
	},
	{
		name: 'a misspelled budget field fails instead of being ignored',
		file: 'src/limits.ts',
		from: '\t\tif (!CONFIGURABLE_LIMITS.includes(name)) {',
		to: '\t\tif (false && CONFIGURABLE_LIMITS.includes(name)) {',
		tests: ['tests/regressions.test.ts']
	},
	{
		name: 'one budget governs the whole compilation',
		file: 'src/compiler.ts',
		from: '\t\tlimits: resolveSchematicLimits(options.limits)',
		to: '\t\tlimits: options.limits',
		tests: ['tests/regressions.test.ts']
	},
	{
		name: 'open triangle interiors stay transparent',
		file: 'src/renderer.ts',
		from: 'd="M0 1 11 6 0 11Z" fill="none"',
		to: 'd="M0 1 11 6 0 11Z" fill="context-stroke"',
		tests: ['tests/renderer.test.ts']
	},
	{
		name: 'an unconstrained axis inherits the first reference',
		file: 'src/placement.ts',
		from: '\t\tlet position: SchematicPoint = { x: seed.originX, y: seed.originY };',
		to: '\t\tlet position: SchematicPoint = { x: 0, y: 0 };',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'a direction measures from the reference body, not its origin',
		file: 'src/placement.ts',
		from: '\t\tconst rectangle = componentRectangle(component);\n\t\treturn { ...rectangle, originX: component.x, originY: component.y };',
		to: '\t\treturn {\n\t\t\tminX: component.x,\n\t\t\tmaxX: component.x,\n\t\t\tminY: component.y,\n\t\t\tmaxY: component.y,\n\t\t\toriginX: component.x,\n\t\t\toriginY: component.y\n\t\t};',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'the two axis gap defaults stay distinct',
		file: 'src/placement.ts',
		from: '\t\t\t: PLACEMENT_VERTICAL_GAP);',
		to: '\t\t\t: PLACEMENT_HORIZONTAL_GAP);',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'the placement depth budget is enforced',
		file: 'src/placement.ts',
		from: '\t\tif (chain > placementDepth) {',
		to: '\t\tif (false && chain > placementDepth) {',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'reported placements are ordered by source line',
		file: 'src/placement.ts',
		from: '\treturn placements.sort((left, right) => left.line - right.line);',
		to: '\treturn placements.sort((left, right) => right.line - left.line);',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'a declaration waits for every reference it names',
		file: 'src/placement.ts',
		from: '\t\t\tif (remaining === 0) ready.push(dependent);',
		to: '\t\t\tready.push(dependent);',
		tests: ['tests/placement.test.ts']
	},
	{
		name: 'the first routing pass is source order',
		file: 'src/layout.ts',
		from: '\t\tconst base = pass === 1 ? connections.map((_, index) => index) : criticality;',
		to: '\t\tconst base = criticality;',
		tests: ['tests/rip-up.test.ts', 'tests/regressions.test.ts']
	},
	{
		name: 'a failed trace is promoted to the front of the next pass',
		file: 'src/layout.ts',
		from: '\t\tpromoted.unshift(failed);',
		to: '\t\tpromoted.push(failed);',
		tests: ['tests/rip-up.test.ts']
	},
	{
		name: 'the routing attempt budget is enforced',
		file: 'src/layout.ts',
		from: '\t\tif (pass >= routingAttempts || failedAt === 0) throw failure;',
		to: '\t\tif (failedAt === 0) throw failure;',
		tests: ['tests/rip-up.test.ts']
	},
	{
		name: 'congestion cells are reported in a stable order',
		file: 'src/layout.ts',
		from: '\treturn cells.sort((left, right) => left.x - right.x || left.y - right.y);',
		to: '\treturn cells;',
		tests: ['tests/rip-up.test.ts']
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
