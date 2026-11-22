import { rotate, toMilli, type IPoint, type Turn } from '../geom.js';
import type { SchematicComponent } from '../types.js';
import type { KindDef, LocalPort } from './common.js';
import { ELECTRICAL_KINDS } from './electrical.js';
import { LOGIC_KINDS } from './logic.js';
import { QUANTUM_KINDS } from './quantum.js';
import { UML_KINDS } from './uml.js';

export const KINDS: Readonly<Record<string, KindDef>> = {
	...ELECTRICAL_KINDS,
	...LOGIC_KINDS,
	...QUANTUM_KINDS,
	...UML_KINDS
} as unknown as Readonly<Record<string, KindDef>>;

export const definition = (component: SchematicComponent): KindDef => KINDS[component.kind]!;

const TURNS: Readonly<Record<string, Turn>> = { right: 0, down: 1, left: 2, up: 3 };
export const turnOf = (component: SchematicComponent): Turn =>
	'orientation' in component && component.orientation !== undefined ? TURNS[component.orientation]! : 0;

export interface PlacedPort {
	readonly id: string;
	readonly point: IPoint;
	readonly normal: IPoint;
}

function placedPort(component: SchematicComponent, local: LocalPort): PlacedPort {
	const turn = turnOf(component);
	const cx = toMilli(component.x);
	const cy = toMilli(component.y);
	if (turn === 0) return { id: local.id, point: { x: cx + local.x, y: cy + local.y }, normal: { x: local.nx, y: local.ny } };
	const offset = rotate({ x: local.x, y: local.y }, turn);
	return { id: local.id, point: { x: cx + offset.x, y: cy + offset.y }, normal: rotate({ x: local.nx, y: local.ny }, turn) };
}

export const placedPorts = (component: SchematicComponent): readonly PlacedPort[] =>
	definition(component).ports(component).map((local) => placedPort(component, local));

export function resolvePlaced(component: SchematicComponent, name: string): PlacedPort | undefined {
	const local = definition(component).resolve(component, name);
	return local === undefined ? undefined : placedPort(component, local);
}

export function canonicalName(component: SchematicComponent, name: string): string | undefined {
	const def = definition(component);
	const local = def.resolve(component, name);
	if (local === undefined) return undefined;
	const ports = def.ports(component);
	if (ports.some((e) => e.id === local.id)) return local.id;
	return ports.find((e) => e.x === local.x && e.y === local.y)?.id ?? local.id;
}

export function halfExtents(component: SchematicComponent): readonly [number, number] {
	const [w, h] = definition(component).extents(component);
	return turnOf(component) % 2 === 1 ? [h, w] : [w, h];
}
