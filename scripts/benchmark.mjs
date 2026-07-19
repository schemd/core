import { performance } from 'node:perf_hooks';

import { compileSchematic } from '../dist/index.js';

const encoder = new TextEncoder();

const simpleSource = `source:VIN "AC" at (90,150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" at (280,150) #amber
junction:VOUT "Vout" at (470,150) #cyan
capacitor:C1 "100 nF" at (470,290) #cyan [orientation=down]
ground:GND "0 V" at (650,390) #slate
VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> GND.in #slate [ortho]`;

const maximumComponentSource = Array.from(
	{ length: 512 },
	(_, index) =>
		`resistor:R${index} "R" at (${100 + (index % 32) * 120},${100 + Math.floor(index / 32) * 120}) #amber [orientation=${['right', 'down', 'left', 'up'][index % 4]}]`
).join('\n');

const denseLines = [];
for (let index = 0; index < 16; index += 1) {
	const y = 120 + index * 70;
	const x = 200 + index * 80;
	denseLines.push(`port:L${index} "L" at (60,${y}) #blue`);
	denseLines.push(`port:R${index} "R" at (1540,${y}) #emerald [orientation=left]`);
	denseLines.push(`port:T${index} "T" at (${x},110) #cyan [orientation=down]`);
	denseLines.push(`port:B${index} "B" at (${x},1190) #purple [orientation=up]`);
}
for (let index = 0; index < 16; index += 1) {
	denseLines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
	denseLines.push(`T${index}.out -> B${index}.in #purple [ortho]`);
}
const denseRoutingSource = denseLines.join('\n');

const repeatedSource = (count) =>
	Array.from(
		{ length: count },
		(_, index) =>
			`resistor:R${index} "R" at (${100 + (index % 16) * 120},${100 + Math.floor(index / 16) * 120}) #amber [orientation=${['right', 'down', 'left', 'up'][index % 4]}]`
	).join('\n');

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function measure(name, source, options, iterations) {
	for (let index = 0; index < 5; index += 1) compileSchematic(source, options);
	const samples = [];
	let svgBytes = 0;
	for (let index = 0; index < iterations; index += 1) {
		const startedAt = performance.now();
		const result = compileSchematic(source, options);
		samples.push(performance.now() - startedAt);
		svgBytes = result.metrics.svgBytes;
	}
	return {
		name,
		medianMs: Math.round(median(samples) * 1000) / 1000,
		svgBytes
	};
}

const repeatedOne = compileSchematic(repeatedSource(1), {
	bounds: { width: 2048, height: 640 },
	title: 'Repeated symbol benchmark',
	idPrefix: 'repeat'
});
const repeatedSixtyFour = compileSchematic(repeatedSource(64), {
	bounds: { width: 2048, height: 640 },
	title: 'Repeated symbol benchmark',
	idPrefix: 'repeat'
});

const report = {
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	benchmarks: [
		measure(
			'simple-rc',
			simpleSource,
			{ bounds: { width: 760, height: 460 }, title: 'RC benchmark', idPrefix: 'simple' },
			25
		),
		measure(
			'maximum-512-components',
			maximumComponentSource,
			{ bounds: { width: 4096, height: 2200 }, title: 'Maximum benchmark', idPrefix: 'maximum' },
			9
		),
		measure(
			'dense-16x16-routing',
			denseRoutingSource,
			{ bounds: { width: 1600, height: 1300 }, title: 'Dense routing benchmark', idPrefix: 'dense' },
			9
		)
	],
	repeatedSymbols: {
		oneSvgBytes: encoder.encode(repeatedOne.svg).byteLength,
		sixtyFourSvgBytes: encoder.encode(repeatedSixtyFour.svg).byteLength,
		incrementalBytesPerAdditionalInstance:
			Math.round(((encoder.encode(repeatedSixtyFour.svg).byteLength - encoder.encode(repeatedOne.svg).byteLength) / 63) * 1000) / 1000
	}
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
