import { expect, test, type Page } from '@playwright/test';

import { compileSchematic } from '../../src/index.js';

const STABLE_PAGE_STYLE = `<style>
html,body{margin:0;padding:0;background:#fff;color:#0f172a}
figure{display:inline-block;margin:0;line-height:0}
figcaption{display:none}
svg{display:block}
text{opacity:0}
</style>`;

async function mountSchematic(
	page: Page,
	source: string,
	bounds: { readonly width: number; readonly height: number },
	title: string
): Promise<void> {
	const { svg } = compileSchematic(source, {
		bounds,
		title,
		mode: 'embedded-css',
		idPrefix: `golden-${title.toLowerCase().replaceAll(' ', '-')}`
	});
	await page.setContent(`${STABLE_PAGE_STYLE}${svg}`);
}

test('topology, junctions, and bridge ownership remain visually stable', async ({ page }) => {
	await mountSchematic(
		page,
		`port:A "A" at (70,100) #blue
junction:J "junction" at (260,100) #cyan
port:B "B" at (450,100) #blue [orientation=left]
port:C "C" at (260,210) #cyan [orientation=up]
port:L "horizontal" at (70,340) #blue
port:R "horizontal" at (830,340) #blue [orientation=left]
port:T "vertical" at (560,230) #amber [orientation=down]
port:D "vertical" at (560,470) #amber [orientation=up]
A.out -> J.node #blue [ortho net=CONTROL]
J.node -> B.in #blue [ortho]
J.node -> C.in #cyan [ortho]
L.out -> R.in #blue [ortho net=HORIZONTAL]
T.out -> D.in #amber [ortho net=VERTICAL]`,
		{ width: 900, height: 540 },
		'Net topology'
	);

	await expect(page.locator('figure')).toHaveScreenshot('net-topology.png');
});

test('universal routes, endpoint markers, and legal containment remain visually stable', async ({
	page
}) => {
	await mountSchematic(
		page,
		`port:L1 "line" at (70,100) #blue
port:R1 "line" at (420,100) #blue [orientation=left]
port:L2 "curve" at (70,240) #purple
port:R2 "curve" at (420,320) #purple [orientation=left]
package:PKG "Control package" at (720,220) #slate [width=380 height=300]
action:ACT "Dispatch" at (700,200) #cyan [width=130 height=70]
component-port:EDGE "API" at (530,220) #emerald
lifeline:LIFE "Worker" at (720,490) #slate [width=120 height=170]
activation:RUN "Active" at (720,490) #cyan [width=28 height=90]
destruction:END "End" at (720,550) #amber
L1.out -> R1.in #blue [line marker-start=dot marker-end=triangle net=LINE]
L2.out -> R2.in #purple [bezier marker-start=diamond marker-end=diamond-filled net=CURVE]`,
		{ width: 960, height: 620 },
		'Collision families'
	);

	await expect(page.locator('figure')).toHaveScreenshot('collision-families.png');
});

test('open marker interiors expose arbitrary host backgrounds without trace bleed', async ({ page }) => {
	await mountSchematic(
		page,
		`port:L1 "diamond" at (70,80) #blue
port:R1 "triangle" at (450,80) #blue [orientation=left]
port:L2 "open" at (70,180) #purple
port:R2 "open" at (450,180) #purple [orientation=left]
L1.out -> R1.in #blue [line marker-start=diamond marker-end=triangle net=SHAPES]
L2.out -> R2.in #purple [ortho marker-start=open-arrow marker-end=open-arrow net=ARROWS]`,
		{ width: 520, height: 260 },
		'Transparent markers'
	);
	await page.addStyleTag({
		content:
			'html,body{background-color:#e2e8f0;background-image:linear-gradient(45deg,#cbd5e1 25%,transparent 25%,transparent 75%,#cbd5e1 75%),linear-gradient(45deg,#cbd5e1 25%,transparent 25%,transparent 75%,#cbd5e1 75%);background-position:0 0,10px 10px;background-size:20px 20px}'
	});

	await expect(page.locator('figure')).toHaveScreenshot('transparent-markers.png');
});
