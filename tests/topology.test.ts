import { describe, expect, test } from 'vitest';

import { compileSchematic, parseSchematic, renderSchematic, routeConnections } from '../src/index.js';

const fence = { bounds: { width: 900, height: 600 }, title: 'Topology contract' } as const;

describe('net topology semantics', () => {
	test('resolves named, junction-propagated, disconnected, and generated nets deterministically', () => {
		const source = `port:A "A" at (80,100) #blue
junction:J "J" at (240,100) #blue
port:B "B" at (400,100) #blue [orientation=left]
port:C "C" at (80,260) #blue
port:D "D" at (400,260) #blue [orientation=left]
port:E "E" at (80,420) #slate
port:F "F" at (400,420) #slate [orientation=left]
A.out -> J.node #blue [ortho net=DATA]
J.node -> B.in #blue [ortho]
C.out -> D.in #blue [line net=DATA]
E.out -> F.in #slate [line]`;
		const document = parseSchematic(source, fence);
		expect(document.connections.map(({ net, netId }) => ({ net, netId }))).toEqual([
			{ net: 'DATA', netId: 'DATA' },
			{ net: undefined, netId: 'DATA' },
			{ net: 'DATA', netId: 'DATA' },
			{ net: undefined, netId: '$1' }
		]);

		const compiled = compileSchematic(source, { ...fence, mode: 'full' });
		expect(compiled.sourceMap.wires.map((wire) => wire.netId)).toEqual([
			'DATA',
			'DATA',
			'DATA',
			'$1'
		]);
		expect(compiled.svg.match(/data-net-id="DATA"/g)).toHaveLength(3);
		expect(compiled.svg).toContain('data-net-id="$1"');
	});

	test('rejects conflicting names, signal domains, widths, relation misuse, and malformed names', () => {
		expect(() =>
			parseSchematic(
				`port:A "A" at (80,100) #blue
junction:J "J" at (240,100) #blue
port:B "B" at (400,100) #blue
A.out -> J.node #blue [net=LEFT]
J.node -> B.in #blue [net=RIGHT]`,
				fence
			)
		).toThrow(/conflicting nets LEFT and RIGHT/);
		expect(() =>
			parseSchematic(
				`port:A "A" at (80,100) #blue
port:B "B" at (300,100) #blue
port:C "C" at (80,260) #blue
port:D "D" at (300,260) #blue
A.out -> B.in #blue [digital net=BUS]
C.out -> D.in #blue [net=BUS]`,
				fence
			)
		).toThrow(/share one signal kind and width/);
		expect(() =>
			parseSchematic(
				`port:A "A" at (80,100) #blue [width=8]
port:B "B" at (300,100) #blue [width=8]
port:C "C" at (80,260) #blue
port:D "D" at (300,260) #blue
A.out -> B.in #blue [width=8 net=BUS]
C.out -> D.in #blue [net=BUS]`,
				fence
			)
		).toThrow(/share one signal kind and width/);
		expect(() =>
			parseSchematic(
				`class:A "A" at (160,120) #slate
class:B "B" at (500,120) #slate
A.right -> B.left #slate [association net=MODEL]`,
				fence
			)
		).toThrow(/Only signal connections may declare a net/);
		for (const net of ['1V8', 'bad.name', 'x'.repeat(65)]) {
			expect(() =>
				parseSchematic(
					`port:A "A" at (80,100) #blue\nport:B "B" at (300,100) #blue\nA.out -> B.in #blue [net=${net}]`,
					fence
				)
			).toThrow(/net must begin with a letter/);
		}
	});

	test('bridges only separate orthogonal nets', () => {
		const source = (shared: boolean) => `port:L "L" at (80,300) #blue
port:R "R" at (820,300) #blue [orientation=left]
port:T "T" at (450,80) #cyan [orientation=down]
port:B "B" at (450,520) #cyan [orientation=up]
L.out -> R.in #blue [ortho net=${shared ? 'COMMON' : 'HORIZONTAL'}]
T.out -> B.in #cyan [ortho net=${shared ? 'COMMON' : 'VERTICAL'}]`;
		const shared = parseSchematic(source(true), fence);
		const sharedRoutes = routeConnections(
			shared.connections,
			new Map(shared.components.map((component) => [component.id, component])),
			fence.bounds
		);
		expect(sharedRoutes[1]!.d).not.toContain(' A ');
		const separate = parseSchematic(source(false), fence);
		const separateRoutes = routeConnections(
			separate.connections,
			new Map(separate.components.map((component) => [component.id, component])),
			fence.bounds
		);
		expect(separateRoutes[1]!.d).toContain(' A 5 5 ');
	});
});

describe('universal geometry collisions', () => {
	test('rejects line and Bézier body intersections while orthogonal routing avoids the body', () => {
		const declarations = `port:L "L" at (80,200) #blue
resistor:X "Obstacle" at (450,200) #amber
port:R "R" at (820,200) #blue [orientation=left]`;
		expect(() => parseSchematic(`${declarations}\nL.out -> R.in #blue [line]`, fence)).toThrow(
			/Line route intersects X/
		);
		expect(() =>
			parseSchematic(
				`port:L "L" at (80,100) #blue
resistor:X "Obstacle" at (450,200) #amber
port:R "R" at (820,300) #blue [orientation=left]
L.out -> R.in #blue [bezier]`,
				fence
			)
		).toThrow(/Bézier route intersects X/);
		expect(() =>
			parseSchematic(
				`port:L "L" at (80,100) #blue
resistor:X "Obstacle" at (450,200) #amber
port:R "R" at (820,300) #blue [orientation=left]
L.out -> R.in #blue [line]`,
				fence
			)
		).toThrow(/Line route intersects X/);
		expect(() =>
			parseSchematic(
				`junction:BACK "Back" at (100,200) #slate
port:L "L" at (300,300) #blue
port:R "R" at (700,500) #blue [orientation=left]
junction:AHEAD "Ahead" at (840,550) #slate
L.out -> R.in #blue [line]`,
				fence
			)
		).not.toThrow();
		expect(() => parseSchematic(`${declarations}\nL.out -> R.in #blue [ortho]`, fence)).not.toThrow();
	});

	test('includes transformed marker footprints in component collision checks', () => {
		const declarations = `port:L "L" at (80,100) #blue
junction:J "J" at (140,110) #amber
port:R "R" at (520,100) #blue [orientation=left]`;
		expect(() =>
			parseSchematic(`${declarations}\nL.out -> R.in #blue [line marker-start=triangle]`, fence)
		).toThrow(/triangle marker intersects J/);
		expect(() => parseSchematic(`${declarations}\nL.out -> R.in #blue [line]`, fence)).not.toThrow();
	});

	test('rejects accidental body overlap but preserves exact edge contact and UML containment', () => {
		expect(() =>
			parseSchematic(
				`resistor:R1 "R1" at (120,100) #amber\nresistor:R2 "R2" at (180,100) #amber`,
				fence
			)
		).toThrow(/R2 overlaps R1/);
		expect(() =>
			parseSchematic(
				`junction:J1 "J1" at (120,100) #amber\njunction:J2 "J2" at (120,100) #blue`,
				fence
			)
		).toThrow(/overlaps/);
		expect(() =>
			parseSchematic(
				`resistor:R1 "R1" at (120,100) #amber\nresistor:R2 "R2" at (204,100) #amber`,
				fence
			)
		).not.toThrow();
		expect(() =>
			parseSchematic(
				`package:P "Package" at (350,260) #slate [width=500 height=360]
action:A "Action" at (350,260) #cyan [width=120 height=70]
component-port:CP "Port" at (100,260) #blue`,
				fence
			)
		).not.toThrow();
		expect(() =>
			parseSchematic(
				`lifeline:L "Life" at (300,280) #slate [width=120 height=360]
activation:A "Active" at (300,280) #cyan [width=30 height=120]
destruction:D "End" at (300,430) #amber`,
				fence
			)
		).not.toThrow();
	});

	test('retains deterministic render output after topology validation', () => {
		const document = parseSchematic(
			`port:A "A" at (80,100) #blue\nport:B "B" at (400,100) #blue\nA.out -> B.in #blue [net=CLK]`,
			fence
		);
		expect(renderSchematic(document, { ...fence, idPrefix: 'topology' })).toBe(
			renderSchematic(document, { ...fence, idPrefix: 'topology' })
		);
	});
});
