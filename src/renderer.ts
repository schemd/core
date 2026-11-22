import { fmt, toMilli } from './geom.js';
import {
	connectionLabelPoint,
	formatNumber as svgNumber,
	isDigitalComponent,
	isQuantumSpecial,
	isUmlComponent,
	PORT_HOTSPOT_RADIUS,
	routeConnections,
	validateSchematicGeometry,
	type RoutedConnection
} from './layout.js';
import {
	MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	normalizeSchematicCanvas,
	normalizeSchematicTitle,
	resolveSchematicLimits,
	type SchematicResolvedLimits
} from './limits.js';
import { assertParsedSchematicDocument } from './parser.js';
import { parsedSchematicGeometry } from './route-cache.js';
import { colorAttributes, TEXT_PAINT } from './symbols/common.js';
import { definition, halfExtents, placedPorts, turnOf } from './symbols/index.js';
import {
	QUANTUM_GATE_KINDS,
	SCHEMD_OUTPUT_MODES,
	SCHEMD_SEMANTIC_HOOKS,
	SchematicSyntaxError,
	type CompileSchematicOptions,
	type QuantumGateComponent,
	type SchematicBounds,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicPoint,
	type SchematicSemanticHook,
	type SchematicSheet,
	type SchematicSignalMarker,
	type SchemdOutputMode
} from './types.js';
import { MATH_LABEL_FONT_FAMILY, mathLabelText, renderMathLabelTspans } from './math-label.js';
import { escapeXml } from './xml.js';

export const MAX_SVG_OUTPUT_BYTES = MAX_SCHEMATIC_SVG_OUTPUT_BYTES;

const VEC = 'var(--schematic-vector,var(--schematic-vector-fallback,currentColor))';
const STATES = [':hover', ':focus', '.is-hovered', '.is-active', '.is-selected'];
const COMP_STATES = [':hover', ':focus', ':focus-within', '.is-hovered', '.is-active', '.is-selected'];
const sel = (tail: string) =>
	[...COMP_STATES.map((s) => `.schematic-component${s}${tail}`), ...STATES.map((s) => `.schematic-wire${s}${tail}`)].join(',');

const STATIC_SVG_STYLES =
	`.schematic-token{fill:none;stroke:${VEC};stroke-linecap:round;stroke-linejoin:round;stroke-width:var(--schematic-stroke-width,1.65);vector-effect:non-scaling-stroke}.schematic-marker-carrier{stroke-width:0!important}.schematic-node-fill{fill:${VEC}}.schematic-designator,.schematic-label,.schematic-gate-symbol,.schematic-quantum-detail,.schematic-pin-label,.schematic-uml-text,.schematic-connection-label{fill:currentColor}.schematic-designator,.schematic-label{stroke:none;text-anchor:middle;font-size:12px}.schematic-uml-row{font-size:12px}.schematic-uml-stereotype{font-size:11px}.schematic-connection-label{font-size:11px;paint-order:stroke;stroke:var(--schematic-surface,#fff);stroke-width:4;stroke-linejoin:round}.schematic-surface{fill:var(--schematic-surface,transparent)}.schematic-grid-line{fill:none;stroke:var(--schematic-grid,currentColor);stroke-width:1;opacity:.12;vector-effect:non-scaling-stroke}`;

const HOOK_SVG_STYLES =
	`.schematic-port-hotspot{fill:transparent!important;stroke:transparent!important;stroke-width:8;vector-effect:non-scaling-stroke;pointer-events:all;outline:none}.schematic-port-hotspot:focus-visible{fill:${VEC}!important;fill-opacity:.22!important;stroke:${VEC}!important;stroke-width:2}`;

const INTERACTIVE_SVG_STYLES =
	`.schematic-component,.schematic-wire{outline:none;transition:opacity .2s ease,filter .2s ease}.schematic-component .schematic-token,.schematic-wire .schematic-token{transition:stroke .2s ease,fill .2s ease,color .2s ease,opacity .2s ease,stroke-width .2s ease}.schematic-glow-layer{opacity:0;pointer-events:none;transition:opacity .2s ease}${sel('>.schematic-glow-layer')}{opacity:1}.schematic-component.is-degraded,.schematic-wire.is-degraded{opacity:.45}.schematic-component.is-degraded>.schematic-glow-layer,.schematic-wire.is-degraded>.schematic-glow-layer{opacity:0}${sel(' .schematic-token')}{stroke-width:var(--schematic-interactive-stroke-width,2.25)}.schematic-port-hotspot{fill:${VEC}!important;fill-opacity:0;transition:fill-opacity .2s ease,opacity .2s ease}${STATES.map((s) => `.schematic-port-hotspot${s}`).join(',')}{fill-opacity:.2}.schematic-port-hotspot.is-degraded{opacity:.45}@media(prefers-reduced-motion:reduce){.schematic-component,.schematic-wire,.schematic-token,.schematic-glow-layer,.schematic-port-hotspot{transition:none}}`;

interface NormalizedCompileOptions extends CompileSchematicOptions {
	bounds: SchematicBounds | 'auto';
	title: string;
	mode: SchemdOutputMode;
	semanticHookMask: number;
	limits: SchematicResolvedLimits;
}

const NODE_HOOK = 1;
const PORT_HOOK = 2;
const WIRE_HOOK = 4;

const UTF8_ENC = new TextEncoder();
const UTF8_DEC = new TextDecoder();
const UTF8_SCRATCH = new Uint8Array(65_536);

export class BoundedSvgWriter {
	private readonly chunks: string[] = [];
	private at = 0;
	private readonly limit: number;

	constructor(limitBytes: number = MAX_SCHEMATIC_SVG_OUTPUT_BYTES) {
		this.limit = limitBytes;
	}

	private overBudget(): SchematicSyntaxError {
		return new SchematicSyntaxError(`Compiled SVG exceeds the ${this.limit.toLocaleString('en-US')} byte output limit.`);
	}

	append(chunk: string): void {
		const len = chunk.length;
		if (len === 0) return;
		const rem = this.limit - this.at;
		if (len > rem) throw this.overBudget();
		let written = 0;
		let pos = 0;
		let out = '';
		let dirty = false;
		while (pos < len) {
			let end = Math.min(len, pos + 21_845);
			if (end < len && chunk.charCodeAt(end - 1) >= 0xd800 && chunk.charCodeAt(end - 1) <= 0xdbff) end -= 1;
			const slice = pos === 0 && end === len ? chunk : chunk.slice(pos, end);
			const n = UTF8_ENC.encodeInto(slice, UTF8_SCRATCH).written;
			written += n;
			if (written > rem) throw this.overBudget();
			if (n !== slice.length) {
				if (!dirty) {
					out = chunk.slice(0, pos);
					dirty = true;
				}
				out += UTF8_DEC.decode(UTF8_SCRATCH.subarray(0, n));
			} else if (dirty) out += slice;
			pos = end;
		}
		this.chunks.push(dirty ? out : chunk);
		this.at += written;
	}

	finish(): string {
		return this.chunks.join('');
	}

	get byteLength(): number {
		return this.at;
	}
}

function normalizeCompileOptions(value: unknown): NormalizedCompileOptions {
	if (typeof value !== 'object' || value === null) throw new SchematicSyntaxError('Render options must be an object.');
	const c = value as Record<string, unknown>;
	const bounds = normalizeSchematicCanvas(c.bounds, 'Render');
	const title = normalizeSchematicTitle(c.title, 'Render');
	const idPrefix = c.idPrefix;
	if (idPrefix !== undefined && (typeof idPrefix !== 'string' || idPrefix.length > 128)) {
		throw new SchematicSyntaxError('Render idPrefix must be a string of at most 128 characters.');
	}
	const mode = c.mode;
	if (mode !== undefined && (typeof mode !== 'string' || !SCHEMD_OUTPUT_MODES.includes(mode as SchemdOutputMode))) {
		throw new SchematicSyntaxError('Render mode must be one of: default, embedded-css, or full.');
	}
	let mask = 7;
	const rawHooks = c.semanticHooks;
	if (rawHooks !== undefined) {
		if (!Array.isArray(rawHooks)) throw new SchematicSyntaxError('Render semanticHooks must be an array.');
		mask = 0;
		for (const hook of rawHooks) {
			if (typeof hook !== 'string' || !SCHEMD_SEMANTIC_HOOKS.includes(hook as SchematicSemanticHook)) {
				throw new SchematicSyntaxError('Render semanticHooks may contain only: nodes, ports, or wires.');
			}
			mask |= hook === 'nodes' ? NODE_HOOK : hook === 'ports' ? PORT_HOOK : WIRE_HOOK;
		}
	}
	const limits = resolveSchematicLimits(c.limits);
	const normalizedMode = (mode ?? 'default') as SchemdOutputMode;
	return idPrefix === undefined
		? { bounds, title, mode: normalizedMode, semanticHookMask: mask, limits }
		: { bounds, title, idPrefix, mode: normalizedMode, semanticHookMask: mask, limits };
}

function stableHash(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return (hash >>> 0).toString(36);
}

const isOpenMarker = (m: SchematicSignalMarker): boolean => m === 'open-arrow' || m === 'triangle' || m === 'diamond';

function markerAttrs(c: SchematicConnection, idPrefix: string, open: boolean): string {
	const s = isOpenMarker(c.markerStart) === open ? c.markerStart : 'none';
	const e = isOpenMarker(c.markerEnd) === open ? c.markerEnd : 'none';
	return `${s === 'none' ? '' : ` marker-start="url(#${idPrefix}-marker-${s})"`}${e === 'none' ? '' : ` marker-end="url(#${idPrefix}-marker-${e})"`}${!open && c.dashed === true ? ' stroke-dasharray="7 5"' : ''}`;
}

function visiblePath(c: SchematicConnection, route: RoutedConnection): string {
	const trim = (m: SchematicSignalMarker) => (isOpenMarker(m) ? (m === 'open-arrow' ? 9 : 12) : 0);
	const st = trim(c.markerStart);
	const et = trim(c.markerEnd);
	if (st === 0 && et === 0) return route.d;
	const inset = (a: SchematicPoint, b: SchematicPoint, dist: number) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const s = Math.min(1, dist / Math.hypot(dx, dy));
		return { x: a.x + dx * s, y: a.y + dy * s };
	};
	let d = route.d;
	if (st > 0) {
		const p = inset(route.points[0]!, route.points[1]!, st);
		d = d.replace(/^M -?[\d.]+ -?[\d.]+/, `M ${svgNumber(p.x)} ${svgNumber(p.y)}`);
	}
	if (et > 0) {
		const p = inset(route.points.at(-1)!, route.points.at(-2)!, et);
		if (/ H -?[\d.]+$/.test(d)) d = d.replace(/-?[\d.]+$/, svgNumber(p.x));
		else if (/ V -?[\d.]+$/.test(d)) d = d.replace(/-?[\d.]+$/, svgNumber(p.y));
		else d = d.replace(/-?[\d.]+ -?[\d.]+$/, `${svgNumber(p.x)} ${svgNumber(p.y)}`);
	}
	return d;
}

const openCarrier = (c: SchematicConnection, route: RoutedConnection, idPrefix: string): string => {
	const m = markerAttrs(c, idPrefix, true);
	return m === '' ? '' : `<path ${colorAttributes(c.color, 'schematic-marker-carrier')} d="${route.d}" stroke-width="0"${m} />`;
};

const wireLabel = (c: SchematicConnection, route: RoutedConnection): string => {
	if (c.label === undefined) return '';
	const pt = connectionLabelPoint(route);
	return `<text class="schematic-connection-label" ${TEXT_PAINT} x="${svgNumber(pt.x)}" y="${svgNumber(pt.y - 7)}" text-anchor="middle" font-size="11">${renderMathLabelTspans(c.label)}</text>`;
};

const glowUse = (id: string, glowId: string): string =>
	`<use class="schematic-glow-layer" href="#${id}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />`;

function connectionMarkup(c: SchematicConnection, routed: RoutedConnection, index: number, idPrefix: string, glowId: string): string {
	const end = routed.points.at(-1)!;
	const src = escapeXml(`${c.from.componentId}.${c.from.port}`);
	const dst = escapeXml(`${c.to.componentId}.${c.to.port}`);
	const traceId = `${idPrefix}-wire-${index}-vector`;
	const sig = c.signalKind ?? 'electrical';
	const sigCls = c.signalKind === undefined ? '' : ` schematic-signal--${sig}`;
	const data = ` data-wire-source="${src}" data-wire-target="${dst}" data-source-line="${c.line}"${c.netId === undefined ? '' : ` data-net-id="${escapeXml(c.netId)}"`}${c.signalKind === undefined ? '' : ` data-signal-kind="${sig}"`}${c.width === undefined ? '' : ` data-bus-width="${c.width}"`}${c.trunk === undefined ? '' : ` data-wire-trunk="${c.trunk}"`}`;
	/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
	const rel = c.relation ?? 'signal';
	const endDot = rel === 'signal' && c.markerEnd === 'none' ? `<circle ${colorAttributes(c.color, 'schematic-node-fill')} cx="${svgNumber(end.x)}" cy="${svgNumber(end.y)}" r="3" />` : '';
	let jDots = '';
	const dot = (p: SchematicPoint) => `<circle ${colorAttributes(c.color, 'schematic-node-fill schematic-junction')} cx="${svgNumber(p.x)}" cy="${svgNumber(p.y)}" r="3" />`;
	if (routed.junction !== undefined) jDots += dot(routed.junction);
	if (routed.joins !== undefined) for (const p of routed.joins) jDots += dot(p);
	return `<g class="schematic-wire${sigCls}"${data} tabindex="0" role="group" aria-label="${escapeXml(rel)} from ${src} to ${dst}">${openCarrier(c, routed, idPrefix)}<path id="${traceId}" ${colorAttributes(c.color, `schematic-trace${sigCls}`)} d="${visiblePath(c, routed)}"${markerAttrs(c, idPrefix, false)} />${glowUse(traceId, glowId)}${endDot}${jDots}${wireLabel(c, routed)}</g>`;
}

function compactConnectionMarkup(
	connections: readonly SchematicConnection[],
	routes: readonly RoutedConnection[],
	idPrefix: string,
	embedVisuals: boolean,
	glowId: string
): string {
	const batches = new Map<string, { color: SchematicColor; markerAttributes: string; signalKind: string; traces: string[]; endpoints: string[]; labels: string[]; carriers: string[] }>();
	const dotD = (p: SchematicPoint) => `M ${svgNumber(p.x - 3)} ${svgNumber(p.y)} a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`;
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		const ma = markerAttrs(c, idPrefix, false);
		const sig = c.signalKind ?? 'electrical';
		const key = ma.includes('marker-') ? `#${i}` : `${c.color.kind}:${c.color.value}|${ma}|${sig}|${c.width ?? 1}`;
		let b = batches.get(key);
		if (b === undefined) {
			b = { color: c.color, markerAttributes: ma, signalKind: sig, traces: [], endpoints: [], labels: [], carriers: [] };
			batches.set(key, b);
		}
		const routed = routes[i]!;
		b.traces.push(visiblePath(c, routed));
		const car = openCarrier(c, routed, idPrefix);
		if (car !== '') b.carriers.push(car);
		/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
		if ((c.relation ?? 'signal') === 'signal' && c.markerEnd === 'none') b.endpoints.push(dotD(routed.points.at(-1)!));
		if (routed.junction !== undefined) b.endpoints.push(dotD(routed.junction));
		if (routed.joins !== undefined) for (const p of routed.joins) b.endpoints.push(dotD(p));
		const lbl = wireLabel(c, routed);
		if (lbl !== '') b.labels.push(lbl);
	}
	let out = '';
	let idx = 0;
	for (const b of batches.values()) {
		const traceId = `${idPrefix}-wire-batch-${idx++}-vector`;
		const trace = `<path${embedVisuals ? ` id="${traceId}"` : ''} ${colorAttributes(b.color, `schematic-trace${b.signalKind === 'electrical' ? '' : ` schematic-signal--${b.signalKind}`}`)} d="${b.traces.join(' ')}"${b.markerAttributes} />`;
		const eps = b.endpoints.length === 0 ? '' : `<path ${colorAttributes(b.color, 'schematic-node-fill')} d="${b.endpoints.join(' ')}" />`;
		const rest = `${b.carriers.join('')}${trace}${embedVisuals ? glowUse(traceId, glowId) : ''}${eps}${b.labels.join('')}`;
		out += embedVisuals ? `<g class="schematic-wire">${rest}</g>` : rest;
	}
	return out;
}

function componentMetadata(c: SchematicComponent): string {
	if (isDigitalComponent(c)) return [c.variant, c.width > 1 ? `${c.width} bit` : ''].filter(Boolean).join(', ');
	if (isQuantumSpecial(c)) {
		return [c.operator, c.controlType, c.controls > 0 ? `${c.controls} controls` : '', c.targets > 0 ? `${c.targets} targets` : '', c.width > 1 ? `${c.width} bit` : '']
			.filter(Boolean)
			.join(', ');
	}
	if ((QUANTUM_GATE_KINDS as readonly string[]).includes(c.kind)) {
		const g = c as QuantumGateComponent;
		return [g.parameter, g.phase, g.matrix].filter(Boolean).join(', ');
	}
	if (c.kind === 'ic') return `${c.pins.left.length + c.pins.right.length + c.pins.top.length + c.pins.bottom.length} pins`;
	if ('variant' in c && !isUmlComponent(c)) return String(c.variant);
	if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor') return c.passiveType ?? 'fixed';
	if (c.kind === 'diode') return c.diodeType;
	if (c.kind === 'transistor') return c.transistorType;
	if (c.kind === 'ground') return c.groundStyle;
	return '';
}

const MARKERS: readonly (readonly [SchematicSignalMarker, string, string, string])[] = [
	['arrow', '0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8', ' orient="auto-start-reverse" overflow="visible"', '<path d="M0 0 8 4 0 8Z" fill="context-stroke" />'],
	['open-arrow', '0 0 9 10" refX="9" refY="5" markerWidth="9" markerHeight="10', ' orient="auto-start-reverse" overflow="visible"', '<path d="M0 0 9 5 0 10" fill="none" stroke="context-stroke" stroke-width="1.5" />'],
	['dot', '0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8', '', '<circle cx="4" cy="4" r="3" fill="context-stroke" />'],
	['triangle', '0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12', ' orient="auto-start-reverse" overflow="visible"', '<path d="M0 1 11 6 0 11Z" fill="none" stroke="context-stroke" stroke-width="1.5" />'],
	['diamond', '0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12', ' orient="auto-start-reverse" overflow="visible"', '<path d="M0 6 6 1 12 6 6 11Z" fill="none" stroke="context-stroke" stroke-width="1.5" />'],
	['diamond-filled', '0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12', ' orient="auto-start-reverse" overflow="visible"', '<path d="M0 6 6 1 12 6 6 11Z" fill="context-stroke" stroke="context-stroke" />']
];

export interface RenderedSchematic {
	readonly svg: string;
	readonly byteLength: number;
	readonly sheet: SchematicSheet;
}

export function renderSchematic(document: SchematicDocument, options: CompileSchematicOptions): string {
	return renderSchematicSized(document, options).svg;
}

export function renderSchematicSized(document: SchematicDocument, options: CompileSchematicOptions): RenderedSchematic {
	assertParsedSchematicDocument(document);
	const norm = normalizeCompileOptions(options);
	const canvas = norm.bounds;
	const geometry =
		parsedSchematicGeometry(document, canvas) ??
		validateSchematicGeometry(
			document,
			norm,
			canvas === 'auto'
				? undefined
				: routeConnections(document.connections, new Map(document.components.map((c) => [c.id, c])), canvas, norm.limits.wireCrossings)
		);
	const routedConnections = geometry.routes;
	const sheet = geometry.sheet;
	const origin = sheet.x === 0 && sheet.y === 0 ? '' : ` x="${sheet.x}" y="${sheet.y}"`;
	const sigHash = () =>
		stableHash(`${canvas === 'auto' ? `${sheet.x},${sheet.y},` : ''}${sheet.width}x${sheet.height}:${norm.title}:${JSON.stringify(document)}`);
	const cand = (norm.idPrefix ?? `schematic-${sigHash()}`).replace(/[^A-Za-z0-9_-]/g, '-');
	const safePrefix = /[A-Za-z0-9]/.test(cand) ? cand : `schematic-${sigHash()}`;
	const titleId = `${safePrefix}-title`;
	const descId = `${safePrefix}-description`;
	const gridId = `${safePrefix}-grid`;
	const glowId = `${safePrefix}-schematic-glow-filter`;
	const styles = norm.mode === 'embedded-css' || norm.mode === 'full';
	const hooks = norm.mode === 'full';
	const nodeHooks = hooks && (norm.semanticHookMask & NODE_HOOK) !== 0;
	const portHooks = hooks && (norm.semanticHookMask & PORT_HOOK) !== 0;
	const wireHooks = hooks && (norm.semanticHookMask & WIRE_HOOK) !== 0;

	const reusableSymbols = new Map<string, { id: string; component: SchematicComponent }>();
	for (const c of document.components) {
		const key = definition(c).symbol?.(c);
		if (key !== undefined && !reusableSymbols.has(key)) reusableSymbols.set(key, { id: `${safePrefix}-symbol-${key}`, component: c });
	}
	const title = escapeXml(norm.title);
	const nComp = document.components.length;
	const nConn = document.connections.length;
	const desc = `${nComp} component${nComp === 1 ? '' : 's'} and ${nConn} connection${nConn === 1 ? '' : 's'}.`;
	const writer = new BoundedSvgWriter(norm.limits.svgOutputBytes);

	let symDefs = '';
	const vecPaint = 'class="schematic-token" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--schematic-vector,currentColor)"';
	const ndPaint = `class="schematic-token schematic-node-fill" ${TEXT_PAINT} style="fill:var(--schematic-vector,currentColor)"`;
	for (const { id, component } of reusableSymbols.values()) {
		symDefs += `<g id="${id}">${definition(component).draw(component, vecPaint, ndPaint)}</g>`;
	}
	const usedMarkers = new Set<SchematicSignalMarker>();
	for (const c of document.connections) {
		usedMarkers.add(c.markerStart);
		usedMarkers.add(c.markerEnd);
	}
	let markerDefs = '';
	for (const [name, box, orient, body] of MARKERS) {
		if (usedMarkers.has(name)) markerDefs += `<marker id="${safePrefix}-marker-${name}" viewBox="${box}" markerUnits="userSpaceOnUse"${orient}>${body}</marker>`;
	}
	const embeddedDefs = styles
		? `<style>${STATIC_SVG_STYLES}${portHooks ? HOOK_SVG_STYLES : ''}${INTERACTIVE_SVG_STYLES}</style><pattern id="${gridId}" width="20" height="20" patternUnits="userSpaceOnUse"><path class="schematic-grid-line" d="M20 0H0V20" /></pattern><filter id="${glowId}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>`
		: '';
	const defs = `${embeddedDefs}${markerDefs}${symDefs}`;
	writer.append(
		`<figure class="schematic-frame"${hooks ? ' data-schematic' : ''}><svg class="schematic-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${sheet.x} ${sheet.y} ${sheet.width} ${sheet.height}" width="${sheet.width}" height="${sheet.height}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" font-family="${MATH_LABEL_FONT_FAMILY}" role="${hooks ? 'group' : 'img'}" aria-labelledby="${titleId} ${descId}" preserveAspectRatio="xMidYMid meet"><title id="${titleId}">${title}</title><desc id="${descId}">${desc}</desc>${defs === '' ? '' : `<defs>${defs}</defs>`}${styles ? `<rect class="schematic-surface"${origin} width="100%" height="100%" /><rect class="schematic-grid"${origin} width="100%" height="100%" fill="url(#${gridId})" />` : ''}<g class="schematic-vectors">`
	);
	if (wireHooks) {
		for (let i = 0; i < nConn; i += 1) writer.append(connectionMarkup(document.connections[i]!, routedConnections[i]!, i, safePrefix, glowId));
	} else if (nConn > 0) {
		writer.append(compactConnectionMarkup(document.connections, routedConnections, safePrefix, norm.mode === 'embedded-css', glowId));
	}
	const batchLimit = Math.min(16384, Math.max(256, norm.limits.svgOutputBytes));
	let compBuf = '';
	for (let i = 0; i < nComp; i += 1) {
		const c = document.components[i]!;
		const def = definition(c);
		const key = def.symbol?.(c);
		const symbolId = key === undefined ? undefined : reusableSymbols.get(key)?.id;
		const id = escapeXml(c.id);
		const rot = turnOf(c) * 90;
		const vecTrans = rot === 0 ? '' : ` transform="rotate(${rot})"`;
		const vecId = styles ? `${safePrefix}-node-${i}-vector` : '';
		const vecIdAttr = styles ? ` id="${vecId}"` : '';
		const dataAttr = nodeHooks
			? ` data-node-id="${id}" data-node-kind="${c.kind}" data-node-label="${escapeXml(c.label)}" data-component="${id}" data-kind="${c.kind}" data-source-line="${c.line}"${'orientation' in c && c.orientation !== undefined ? ` data-orientation="${c.orientation}"` : ''}${'fit' in c && c.fit !== undefined ? ` data-fit="${c.fit}"` : ''}`
			: '';
		let a11y = '';
		if (hooks) {
			const meta = componentMetadata(c);
			a11y = `${portHooks ? '' : ' tabindex="0"'} role="group" aria-label="${escapeXml(`${c.id}, ${c.kind}${c.label === '' ? '' : `, ${mathLabelText(c.label)}`}${meta === '' ? '' : `, ${meta}`}`)}"`;
		}
		let hotspots = '';
		if (portHooks) {
			const x0 = toMilli(c.x);
			const y0 = toMilli(c.y);
			const pPaint = colorAttributes(c.color, 'schematic-port-hotspot');
			for (const p of placedPorts(c)) {
				const pid = escapeXml(p.id);
				hotspots += `<circle ${pPaint} cx="${fmt(p.point.x - x0)}" cy="${fmt(p.point.y - y0)}" r="${PORT_HOTSPOT_RADIUS}" fill="transparent" stroke="transparent" stroke-width="8" vector-effect="non-scaling-stroke" pointer-events="all" data-port-id="${pid}" data-parent-node="${id}" tabindex="0" role="button" aria-label="${id} port ${pid}" />`;
			}
		}
		const vector =
			symbolId === undefined
				? `<g${vecIdAttr} class="schematic-component-vector"${vecTrans}>${def.draw(c, colorAttributes(c.color), colorAttributes(c.color, 'schematic-node-fill'))}</g>`
				: `<use${vecIdAttr} ${colorAttributes(c.color, 'schematic-component-vector')} href="#${symbolId}"${vecTrans} />`;
		let extLabels = '';
		if (!isUmlComponent(c)) {
			const isJunc = c.kind === 'junction';
			const hh = isJunc ? 0 : halfExtents(c)[1];
			const dy = isJunc ? -27_000 : -hh - 10_000;
			const ly = isJunc ? -10_000 : hh + 19_000;
			const tx = isJunc ? 10 : 0;
			const ts = isJunc ? ' style="text-anchor:start"' : '';
			const lbls = `<text class="schematic-designator" x="${tx}" y="${fmt(dy)}"${ts}>${id}</text>${c.label === '' ? '' : `<text class="schematic-label" x="${tx}" y="${fmt(ly)}"${ts}>${renderMathLabelTspans(c.label)}</text>`}`;
			extLabels = styles ? lbls : `<g ${TEXT_PAINT} text-anchor="middle" font-size="12">${lbls}</g>`;
		}
		compBuf += `<g class="schematic-component"${dataAttr} transform="translate(${svgNumber(c.x)} ${svgNumber(c.y)})"${a11y}>${vector}${styles ? glowUse(vecId, glowId) : ''}${def.inner?.(c) ?? ''}${extLabels}${hotspots}</g>`;
		if (compBuf.length >= batchLimit) {
			writer.append(compBuf);
			compBuf = '';
		}
	}
	writer.append(`${compBuf}</g></svg><figcaption>${title}</figcaption></figure>`);
	return { svg: writer.finish(), byteLength: writer.byteLength, sheet };
}
