import { describe, expect, test } from 'vitest';

import { compileSchematic } from '../src/index.js';

const examples = [
	{
		title: 'RC low-pass filter',
		bounds: { width: 760, height: 460 },
		source: `source:VIN "AC" at (90, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" at (280, 150) #amber
junction:VOUT "V_{out}" at (470, 150) #cyan
capacitor:C1 "100 nF" at (470, 290) #cyan [orientation=down]
junction:RETURN "return" at (470, 380) #slate
ground:GND "0 V" at (650, 380) #slate
VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> RETURN.node #slate [line]
VIN.negative -> RETURN.node #slate [ortho]
RETURN.node -> GND.in #slate [line]`
	},
	{
		title: 'Digital register',
		bounds: { width: 900, height: 420 },
		source: `port:DIN "D[7:0]" at (80, 130) #blue [width=8]
register:REG "Q[7:0]" at (390, 130) #purple [width=8]
clock:CLK "CLK" at (390, 300) #amber
port:OUT "Q[7:0]" at (720, 130) #emerald [width=8 orientation=left]
DIN.out -> REG.in #blue [digital width=8]
CLK.out -> REG.clock #amber [digital ortho]
REG.out -> OUT.in #emerald [digital width=8]`
	},
	{
		title: 'Quantum operator',
		bounds: { width: 900, height: 360 },
		source: `prepare:Q0 "|0\\rangle" at (80, 150) #blue
hadamard:H "H" at (260, 150) #cyan
qgate:U "U" at (480, 150) #purple [parameter="\\theta" phase="\\pi/2" matrix="[[a,b],[c,d]]"]
measure:M "M" at (720, 150) #emerald
Q0.out -> H.in #blue [quantum]
H.out -> U.in #cyan [quantum]
U.out -> M.in #purple [quantum]`
	},
	{
		title: 'UML deployment',
		bounds: { width: 760, height: 460 },
		source: `device:EDGE "Edge device" at (170, 140) #blue [width=180 height=100]
artifact:FW "firmware.bin" at (480, 140) #amber [width=170 height=90]
action:DEPLOY "Deploy" at (480, 340) #cyan [width=150 height=70]
EDGE.right -> FW.left #blue [assembly]
DEPLOY.top -> FW.bottom #cyan [control-flow]`
	}
] as const;

describe('0.3.0 release documentation', () => {
	test.each(examples)('compiles the $title example in every output mode', ({ title, bounds, source }) => {
		for (const mode of ['default', 'embedded-css', 'full'] as const) {
			const { svg } = compileSchematic(source, { title, bounds, mode, idPrefix: 'release-docs' });
			expect(svg).toContain('<svg ');
			expect(svg).not.toMatch(/NaN|Infinity|(?:^|[\s,(="])-0(?=[\s,)"']|$)/);
		}
	});
});
