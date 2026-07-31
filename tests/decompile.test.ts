/**
 * Reading a compiled diagram back into declarations.
 *
 * The valuable test here is the round trip: recompiling recovered source must
 * reproduce the same *topology* as the original. That is an end-to-end assertion
 * over the parser and the renderer at once — it fails if the renderer ever
 * stamps a wire with an endpoint it did not draw.
 *
 * It is deliberately a topology claim rather than a byte claim. Recovery is
 * partial by construction, and the suite says which parts, so that the honest
 * limit is pinned rather than discovered later by a user.
 */
import { describe, expect, test } from 'vitest';

import {
	buildNetlist,
	compileSchematic,
	parseSchematic,
	type SchematicFence
} from '../src/index.js';
import { parseSchematicSvg } from '../src/decompile.js';

const fence: SchematicFence = { bounds: { width: 900, height: 520 }, title: 'Recovery fixture' };
const full = { ...fence, mode: 'full' } as const;

const RC_FILTER = `source:VIN "AC" at (110, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" at (330, 150) #amber
junction:VOUT "V_{out}" at (560, 150) #cyan
capacitor:C1 "100 nF" at (560, 320) #cyan [orientation=down]
ground:GND "0 V" at (330, 430) #slate

VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> GND.in #slate [ortho]`;

/** Nets as sorted terminal lists, which is topology with nothing else attached. */
function topology(source: string): string[] {
	return buildNetlist(parseSchematic(source, fence))
		.nets.map((net) =>
			net.terminals
				.map((terminal) => `${terminal.componentId}.${terminal.port}`)
				.sort()
				.join(' ')
		)
		.sort();
}

describe('what comes back', () => {
	test('recovers every component with its placement, label and paint', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(recovery.components.map((component) => component.id)).toEqual([
			'VIN',
			'R1',
			'VOUT',
			'C1',
			'GND'
		]);
		expect(recovery.components[1]).toMatchObject({
			id: 'R1',
			kind: 'resistor',
			x: 330,
			y: 150,
			line: 2,
			color: { kind: 'token', value: 'amber' }
		});
		/* The label round-trips through XML escaping and the micro-math syntax. */
		expect(recovery.components[2]!.label).toBe('V_{out}');
	});

	test('recovers an orientation only when the declaration carried one', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(recovery.components.find((part) => part.id === 'C1')!.orientation).toBe('down');
		expect(recovery.components.find((part) => part.id === 'R1')!.orientation).toBeUndefined();
	});

	test('recovers every connection with its endpoints and curve', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(recovery.connections.map((wire) => `${wire.from}->${wire.to}`)).toEqual([
			'VIN.positive->R1.in',
			'R1.out->VOUT.node',
			'VOUT.node->C1.in',
			'C1.out->GND.in'
		]);
		expect(recovery.connections.map((wire) => wire.curve)).toEqual([
			'line',
			'line',
			'ortho',
			'ortho'
		]);
	});

	test('recovers markers, bus width and signal domain', () => {
		const source = `port:A "A" at (140, 200) #blue [width=8]\nport:B "B" at (620, 200) #emerald [width=8]\nA.out -> B.in #blue [ortho digital width=8 marker-end=arrow]`;
		const recovery = parseSchematicSvg(compileSchematic(source, full).svg);
		expect(recovery.connections[0]).toMatchObject({
			markerEnd: 'arrow',
			markerStart: 'none',
			width: 8,
			signalKind: 'digital'
		});
	});

	test('recovers a bezier from the command the path used', () => {
		const source = `port:A "A" at (140, 200) #blue\nport:B "B" at (620, 380) #emerald\nA.out -> B.in #blue [bezier]`;
		expect(parseSchematicSvg(compileSchematic(source, full).svg).connections[0]!.curve).toBe(
			'bezier'
		);
	});

	test('recovers a host alias colour by its sanitized name', () => {
		const source = `resistor:R1 "R" at (330, 150) #brand-primary\nresistor:R2 "R" at (620, 150) #amber\nR1.out -> R2.in #amber [line]`;
		const recovery = parseSchematicSvg(compileSchematic(source, full).svg);
		expect(recovery.components[0]!.color).toEqual({ kind: 'alias', value: 'brand-primary' });
		expect(() => parseSchematic(recovery.source, fence)).not.toThrow();
	});

	test('recovers a start marker as well as an end marker', () => {
		const source = `port:A "A" at (140, 200) #blue\nport:B "B" at (620, 200) #emerald\nA.out -> B.in #blue [line marker-start=dot marker-end=arrow]`;
		const recovery = parseSchematicSvg(compileSchematic(source, full).svg);
		expect(recovery.connections[0]).toMatchObject({ markerStart: 'dot', markerEnd: 'arrow' });
		expect(recovery.source).toContain('marker-start=dot');
	});

	test('recovers a custom CSS colour as a CSS colour', () => {
		const source = `resistor:R1 "R" at (330, 150) rgb(255, 128, 0)\nresistor:R2 "R" at (620, 150) #amber\nR1.out -> R2.in #amber [line]`;
		const recovery = parseSchematicSvg(compileSchematic(source, full).svg);
		expect(recovery.components[0]!.color).toMatchObject({ kind: 'css' });
		/* And the written form must be re-parseable: a CSS colour takes no `#`. */
		expect(() => parseSchematic(recovery.source, fence)).not.toThrow();
	});
});

describe('the round trip', () => {
	test('recovered source recompiles to the same topology', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(topology(recovery.source)).toEqual(topology(RC_FILTER));
	});

	test('recovered source recompiles to the same placement', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		const original = parseSchematic(RC_FILTER, fence);
		const recompiled = parseSchematic(recovery.source, fence);
		expect(recompiled.components.map((part) => [part.id, part.x, part.y])).toEqual(
			original.components.map((part) => [part.id, part.x, part.y])
		);
	});

	test('recovered source is itself recoverable, unchanged', () => {
		/* A second pass must be a fixed point. If it is not, the writer and the
		   scanner disagree about the canonical form. */
		const once = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		const twice = parseSchematicSvg(compileSchematic(once.source, full).svg);
		expect(twice.source).toBe(once.source);
	});
});

describe('what does not come back', () => {
	test('names the losses rather than approximating them', () => {
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(recovery.lost.map((loss) => loss.code)).toContain('component-variant');
		for (const loss of recovery.lost) expect(loss.detail).toMatch(/\S/);
	});

	test('drops a family variant, and says so', () => {
		/* `type=voltage-ac` is not stamped anywhere a scanner can read, so VIN comes
		   back as a plain source. The loss is declared; it is not guessed at. */
		const recovery = parseSchematicSvg(compileSchematic(RC_FILTER, full).svg);
		expect(recovery.source).toContain('source:VIN');
		expect(recovery.source).not.toContain('voltage-ac');
		expect(recovery.lost.some((loss) => loss.code === 'component-variant')).toBe(true);
	});

	test('reports a net-name loss only for documents that carry nets', () => {
		const withNet = `port:A "A" at (140, 200) #blue\nport:B "B" at (620, 200) #emerald\nA.out -> B.in #blue [line net=BUS]`;
		const noWires = `resistor:R1 "R" at (330, 150) #amber`;
		expect(
			parseSchematicSvg(compileSchematic(withNet, full).svg).lost.some(
				(loss) => loss.code === 'net-name'
			)
		).toBe(true);
		expect(
			parseSchematicSvg(compileSchematic(noWires, full).svg).lost.some(
				(loss) => loss.code === 'net-name'
			)
		).toBe(false);
	});
});

describe('refusals', () => {
	test('rejects markup compiled without semantic hooks', () => {
		const svg = compileSchematic(RC_FILTER, fence).svg;
		expect(() => parseSchematicSvg(svg)).toThrow(/carries no node hooks/);
	});

	test('rejects a non-string', () => {
		expect(() => parseSchematicSvg(undefined as never)).toThrow(/must be a string/);
	});

	test('ignores a node group that lost its identity attributes', () => {
		/* Defensive rather than expected: markup this scanner did not write may be
		   shaped like the real thing without carrying its hooks. */
		const svg = compileSchematic(RC_FILTER, full).svg.replace('data-node-kind="resistor"', '');
		const recovery = parseSchematicSvg(svg);
		expect(recovery.components.map((part) => part.id)).not.toContain('R1');
	});

	test('ignores a wire group that lost its endpoints', () => {
		const svg = compileSchematic(RC_FILTER, full).svg.replace(
			'data-wire-target="R1.in"',
			''
		);
		expect(parseSchematicSvg(svg).connections).toHaveLength(3);
	});

	test('omits the net when the markup carries none', () => {
		/* Every compiled wire carries a resolved net, so this only happens to markup
		   that was edited after the fact — it must degrade, not invent a net. */
		const svg = compileSchematic(RC_FILTER, full).svg.replaceAll(/ data-net-id="[^"]*"/g, '');
		const recovery = parseSchematicSvg(svg);
		expect(recovery.connections.every((wire) => wire.net === undefined)).toBe(true);
		expect(recovery.lost.some((loss) => loss.code === 'net-name')).toBe(false);
	});

	test('skips a wire group that lost its source line', () => {
		const svg = compileSchematic(RC_FILTER, full).svg.replace(
			/(data-wire-source="VIN.positive"[^>]*?) data-source-line="\d+"/,
			'$1'
		);
		expect(parseSchematicSvg(svg).connections).toHaveLength(3);
	});

	test('skips a wire group that lost its drawn path', () => {
		/* The path is the only record of which curve was used, so a group without
		   one is dropped rather than reported as a straight line. */
		const svg = compileSchematic(RC_FILTER, full).svg.replace(
			/<path([^>]*schematic-trace[^>]*)\/>/,
			''
		);
		expect(parseSchematicSvg(svg).connections).toHaveLength(3);
	});

	test('skips a node group that lost its label', () => {
		/* Attribute order is id, kind, label — so the resistor's label is the one
		   that follows its kind. */
		const svg = compileSchematic(RC_FILTER, full).svg.replace(
			/(data-node-kind="resistor") data-node-label="[^"]*"/,
			'$1'
		);
		expect(parseSchematicSvg(svg).components.map((part) => part.id)).not.toContain('R1');
	});

	test('falls back to the parser default for an unknown colour token', () => {
		const svg = compileSchematic(RC_FILTER, full).svg.replaceAll(
			'schematic-token--amber',
			'schematic-token--chartreuse'
		);
		const recovery = parseSchematicSvg(svg);
		expect(recovery.components.find((part) => part.id === 'R1')!.color).toEqual({
			kind: 'token',
			value: 'slate'
		});
	});
});
