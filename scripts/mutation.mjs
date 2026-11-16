import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mutants = [
	{
		name: "a closed marker keeps its trace out of a compound path",
		file: "src/renderer.ts",
		from: "\t\tconst key = markerAttributes.includes('marker-')",
		to: "\t\tconst key = markerAttributes.includes('marker-') && false",
		tests: ["tests/renderer.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "a caller-supplied budget is enforced, not merely accepted",
		file: "src/limits.ts",
		from: "\t\tresolved[name] = limit;",
		to: "\t\tresolved[name] = resolved[name]!;",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a misspelled budget field fails instead of being ignored",
		file: "src/limits.ts",
		from: "\t\tif (!CONFIGURABLE_LIMITS.includes(name)) {",
		to: "\t\tif (false && CONFIGURABLE_LIMITS.includes(name)) {",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "one budget governs the whole compilation",
		file: "src/compiler.ts",
		from: "\t\tlimits: resolveSchematicLimits(options.limits)",
		to: "\t\tlimits: options.limits",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "open triangle interiors stay transparent",
		file: "src/renderer.ts",
		from: "d=\"M0 1 11 6 0 11Z\" fill=\"none\"",
		to: "d=\"M0 1 11 6 0 11Z\" fill=\"context-stroke\"",
		tests: ["tests/renderer.test.ts"]
	},
	{
		name: "an unconstrained axis inherits the first reference",
		file: "src/placement.ts",
		from: "\t\tlet position: IPoint = { x: seed.originX, y: seed.originY };",
		to: "\t\tlet position: IPoint = { x: 0, y: 0 };",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "a direction measures from the reference body, not its origin",
		file: "src/placement.ts",
		from: "\t\treturn { ...milliRect(componentPlacementRectangle(component)), originX: toMilli(component.x), originY: toMilli(component.y) };",
		to: "\t\treturn { minX: toMilli(component.x), maxX: toMilli(component.x), minY: toMilli(component.y), maxY: toMilli(component.y), originX: toMilli(component.x), originY: toMilli(component.y) };",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "the two axis gap defaults stay distinct",
		file: "src/placement.ts",
		from: "PLACEMENT_HORIZONTAL_GAP : PLACEMENT_VERTICAL_GAP) * 1000",
		to: "PLACEMENT_HORIZONTAL_GAP : PLACEMENT_HORIZONTAL_GAP) * 1000",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "the placement depth budget is enforced",
		file: "src/placement.ts",
		from: "\t\tif (chain > placementDepth) {",
		to: "\t\tif (false && chain > placementDepth) {",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "reported placements are ordered by source line",
		file: "src/placement.ts",
		from: "\treturn placements.sort((left, right) => left.line - right.line);",
		to: "\treturn placements.sort((left, right) => right.line - left.line);",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "a declaration waits for every reference it names",
		file: "src/placement.ts",
		from: "\t\t\tif (remaining === 0) ready.push(dependent);",
		to: "\t\t\tready.push(dependent);",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "a digest states the precision the SVG writer uses",
		file: "src/snapshot.ts",
		from: "\treturn value.toFixed(3);",
		to: "\treturn value.toFixed(2);",
		tests: ["tests/snapshot.test.ts"]
	},
	{
		name: "a digest reports the orientation a declaration stated",
		file: "src/snapshot.ts",
		from: "\tif ('orientation' in component && component.orientation !== undefined) {",
		to: "\tif ('orientation' in component && component.orientation === undefined) {",
		tests: ["tests/snapshot.test.ts"]
	},
	{
		name: "recovery reads a curve from the path that was drawn",
		file: "src/decompile.ts",
		from: "\tif (/\\s[HV]\\s/.test(path)) return 'ortho';",
		to: "\tif (false) return 'ortho';",
		tests: ["tests/decompile.test.ts"]
	},
	{
		name: "recovery writes a CSS colour without the token sigil",
		file: "src/decompile.ts",
		from: "\tif (color.kind === 'css') return color.value;",
		to: "\tif (color.kind === 'css') return `#${color.value}`;",
		tests: ["tests/decompile.test.ts"]
	},
	{
		name: "recovery rejects a colour token the parser does not define",
		file: "src/decompile.ts",
		from: "\treturn (SEMANTIC_COLORS as readonly string[]).includes(value);",
		to: "\treturn true;",
		tests: ["tests/decompile.test.ts"]
	},
	{
		name: "recovery skips a group missing what full mode always writes",
		file: "src/decompile.ts",
		from: "\t\tif (id === undefined || kind === undefined || label === undefined || line === undefined) {",
		to: "\t\tif (id === undefined || kind === undefined) {",
		tests: ["tests/decompile.test.ts"]
	},
	{
		name: "the SVG writer refuses a chunk that overruns the budget",
		file: "src/renderer.ts",
		from: "\t\tif (read < chunk.length || written > remaining) throw this.#overBudget();",
		to: "\t\tif (written > remaining) throw this.#overBudget();",
		tests: ["tests/byte-writer.test.ts"]
	},
	{
		name: "a rejected SVG append commits nothing",
		file: "src/renderer.ts",
		from: "\t\tif (read < chunk.length || written > remaining) throw this.#overBudget();\n\t\tthis.#at += written;",
		to: "\t\tthis.#at += written;\n\t\tif (read < chunk.length || written > remaining) throw this.#overBudget();",
		tests: ["tests/byte-writer.test.ts"]
	},
	{
		name: "the SVG writer reports the size it actually wrote",
		file: "src/renderer.ts",
		from: "\treturn this.#at;",
		to: "\treturn this.#buffer.length;",
		tests: ["tests/byte-writer.test.ts", "tests/compiler.test.ts"]
	},
	{
		name: "a branch joins the net at the end wired above it",
		file: "src/parser.ts",
		from: "connection.trunk = fromWired ? 'from' : 'to';",
		to: "connection.trunk = 'from';",
		tests: ["tests/trunk.test.ts"]
	},
	{
		name: "an instance parameter overrides the default",
		file: "src/parser.ts",
		from: "const value = supplied.get(parameter) ?? fallback;",
		to: "const value = fallback ?? supplied.get(parameter);",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "a subcircuit cannot contain itself",
		file: "src/parser.ts",
		from: "if (stack.includes(kind!)) {",
		to: "if (false) {",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "an exposed terminal resolves through every level of nesting",
		file: "src/parser.ts",
		from: "while (instances.has(id)) {",
		to: "if (instances.has(id)) {",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "shared terminals must unify inferred nets",
		file: "src/parser.ts",
		from: "if (owner === undefined) terminals.set(key, index);\n\t\t\telse union(index, owner);",
		to: "if (owner === undefined) terminals.set(key, index);\n\t\t\telse union(index, index);",
		tests: ["tests/topology.test.ts"]
	},
	{
		name: "equal explicit net names must unify disconnected terminals",
		file: "src/parser.ts",
		from: "if (owner === undefined) names.set(connection.net, index);\n\t\t\telse union(index, owner);",
		to: "if (owner === undefined) names.set(connection.net, index);\n\t\t\telse union(index, index);",
		tests: ["tests/topology.test.ts"]
	},
	{
		name: "connector labels remain routing obstacles",
		file: "src/layout.ts",
		from: "label: connection.label === undefined ? undefined : (route) => labelRectAt(connection, midpoint(route))",
		to: "label: undefined",
		tests: ["tests/layout.test.ts"]
	},
	{
		name: "port aliases resolve to one canonical terminal",
		file: "src/parser.ts",
		from: "connection.from.port = canonicalName(byId.get(connection.from.componentId)!, connection.from.port)!;",
		to: "",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "vertically touching component bounds are not overlaps",
		file: "src/geom.ts",
		from: "left.maxY > right.minY",
		to: "left.maxY >= right.minY",
		tests: ["tests/geom.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a family set is derived from the registry it classifies",
		file: "src/layout.ts",
		from: "const UML = new Set<string>(UML_COMPONENT_KINDS);",
		to: "const UML = new Set<string>();",
		tests: ["tests/uml.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a bridge never bulges into a neighbouring wire",
		file: "src/layout.ts",
		from: "limit = Math.min(limit, Math.floor((x - run.x) / 2));",
		to: "limit = Math.min(limit, radius);",
		tests: ["tests/layout.test.ts"]
	},
	{
		name: "pin stubs of separate nets that touch are named, not routed",
		file: "src/layout.ts",
		from: "if (segmentContact(stub.a, stub.b, other.a, other.b) !== undefined) {",
		to: "if (false) {",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "a drawn wire may not pass through a foreign terminal",
		file: "src/layout.ts",
		from: "if (segmentContact(chords[step - 1]!, chords[step]!, at, at) === undefined) continue;",
		to: "continue;",
		tests: ["tests/layout.test.ts"]
	},
	{
		name: "a pin exit through its own text turns only beyond it",
		file: "src/layout.ts",
		from: "if (placed.normal.y < 0 && rect.minY < escape.y && rect.maxY > escape.y - clearance) escape = { x: escape.x, y: rect.minY };",
		to: "",
		tests: ["tests/regressions.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "congestion cells are reported in a stable order",
		file: "src/layout.ts",
		from: "congestion: [...cells.values()].sort((left, right) => left.x - right.x || left.y - right.y)",
		to: "congestion: [...cells.values()].reverse()",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a contested location costs every net, touching or not",
		file: "src/route.ts",
		from: "let cost = g + length * (soft === 2 ? 2 : 1) + history;",
		to: "let cost = g + length * (soft === 2 ? 2 : 1);",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "no shortcut retakes a priced track",
		file: "src/route.ts",
		from: "if (this.#history.size > 0) return undefined;",
		to: "",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "a priced path is compared with the whole canvas",
		file: "src/route.ts",
		from: "if (wide.cost < found.cost) found = wide;",
		to: "if (false) found = wide;",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "routing order is geometric, not declaration order",
		file: "src/route.ts",
		from: "\t\t\t\tleft.key[0] - right.key[0] ||\n\t\t\t\tleft.key[1] - right.key[1] ||\n\t\t\t\tleft.key[2] - right.key[2] ||\n\t\t\t\tleft.key[3] - right.key[3] ||\n",
		to: "",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "a short detour beats an avoidable bridge",
		file: "src/route.ts",
		from: "if (better !== undefined && better.crossings < found.crossings) return better.path;",
		to: "if (false) return better.path;",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "a tree never meets four ways",
		file: "src/route.ts",
		from: "if (degree < 3 && !crowded) startCells.push(cell);",
		to: "if (!crowded) startCells.push(cell);",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "a junction is held two pitches off the pins",
		file: "src/route.ts",
		from: "Math.abs(pin.x - x) + Math.abs(pin.y - y) < 2 * PITCH",
		to: "Math.abs(pin.x - x) + Math.abs(pin.y - y) < 0",
		tests: ["tests/trunk.test.ts"]
	},
	{
		name: "a stub through a third body is reported",
		file: "src/route.ts",
		from: "if (blocked >= 0) return fail(blocked, 'unroutable', 0);",
		to: "",
		tests: ["tests/route.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "text holding an escape point cannot wall it in",
		file: "src/route.ts",
		from: "\t\t\t\tif (!holdsEscape(obstacle.rect)) block(obstacle.rect);",
		to: "\t\t\t\tblock(obstacle.rect);",
		tests: ["tests/regressions.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "torn-up copper no longer occupies the canvas",
		file: "src/route.ts",
		from: "return this.#copper.query(rect).filter((piece) => piece.dead !== true);",
		to: "return this.#copper.query(rect);",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "a wire ending on another net is a contact",
		file: "src/route.ts",
		from: "if (along >= low && along <= high) flag(piece, other, end);",
		to: "",
		tests: ["tests/route.test.ts"]
	},
	{
		name: "the router heap prefers the deeper of two equal estimates",
		file: "src/route.ts",
		from: "return f1 !== f2 ? f1 < f2 : g1 !== g2 ? g1 > g2 : s1 < s2;",
		to: "return f1 !== f2 ? f1 < f2 : s1 < s2;",
		tests: ["tests/route.test.ts", "tests/regressions.test.ts", "tests/trunk.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "rounding is symmetric about zero",
		file: "src/geom.ts",
		from: "const rounded = Math.floor(quotient + 0.5);\n\treturn numerator < 0 ? -rounded : rounded;",
		to: "return Math.round(numerator / denominator);",
		tests: ["tests/geom.test.ts"]
	},
	{
		name: "orientation falls back to exact BigInt products",
		file: "src/geom.ts",
		from: "const limit = 67_108_864;",
		to: "const limit = Number.POSITIVE_INFINITY;",
		tests: ["tests/geom.test.ts"]
	},
	{
		name: "formatted decimals carry no trailing zeros",
		file: "src/geom.ts",
		from: "while (digits.endsWith('0')) digits = digits.slice(0, -1);",
		to: "",
		tests: ["tests/geom.test.ts"]
	},
	{
		name: "a fourth decimal rounds the milli-unit",
		file: "src/geom.ts",
		from: "if (fraction.length > 3 && fraction.charCodeAt(3) >= 53) value += 1;",
		to: "",
		tests: ["tests/geom.test.ts"]
	},
	{
		name: "an unknown endpoint is reported at its token",
		file: "src/parser.ts",
		from: "checkEndpoint(connection.from, byId, connection.line, fromId, fromPort);",
		to: "checkEndpoint(connection.from, byId, connection.line, undefined, undefined);",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "a failed component is not blamed again by its wires",
		file: "src/parser.ts",
		from: "if (poisoned.has(connection.from.componentId) || poisoned.has(connection.to.componentId)) continue;",
		to: "",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "diagnostics are listed in source order",
		file: "src/parser.ts",
		from: "return reporter.diagnostics.sort((left, right) => left.line! - right.line!);",
		to: "return reporter.diagnostics;",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "a substituted line carries no column",
		file: "src/parser.ts",
		from: "if (source.shifted === true) return undefined;",
		to: "",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "copied coordinates are offset by the instance position",
		file: "src/parser.ts",
		from: "x: fromMilli(parseMilli(syntax.x.text) + dx)",
		to: "x: fromMilli(parseMilli(syntax.x.text))",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "nested instance offsets compose",
		file: "src/parser.ts",
		from: "dx + parseMilli(instance[3]!), dy + parseMilli(instance[4]!)",
		to: "parseMilli(instance[3]!), parseMilli(instance[4]!)",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "expansion is held to the source character budget",
		file: "src/parser.ts",
		from: "if (characters > budget) {",
		to: "if (false) {",
		tests: ["tests/subcircuit.test.ts"]
	},
	{
		name: "an alias names the terminal drawn at its point",
		file: "src/symbols/index.ts",
		from: "return ports.find((entry) => entry.x === local.x && entry.y === local.y)?.id ?? local.id;",
		to: "return local.id;",
		tests: ["tests/ports.test.ts"]
	},
	{
		name: "reset accepts the numbered spellings of its one track",
		file: "src/symbols/quantum.ts",
		from: "if (component.kind === 'reset' && /^(in|out)1$/.test(name)) name = name.slice(0, -1);",
		to: "",
		tests: ["tests/ports.test.ts"]
	},
	{
		name: "orientation turns clockwise",
		file: "src/symbols/index.ts",
		from: "{ right: 0, down: 1, left: 2, up: 3 }",
		to: "{ right: 0, down: 3, left: 2, up: 1 }",
		tests: ["tests/ports.test.ts", "tests/primitives.test.ts"]
	},
	{
		name: "a battery's long plate is on its positive terminal",
		file: "src/symbols/electrical.ts",
		from: "M -42 0 H -8 M -8 -10 V 10 M 8 -16 V 16 M 8 0 H 42",
		to: "M -42 0 H -8 M -8 -16 V 16 M 8 -10 V 10 M 8 0 H 42",
		tests: ["tests/primitives.test.ts"]
	},
	{
		name: "a current source's arrow points at its negative terminal",
		file: "src/symbols/electrical.ts",
		from: "M 12 0 H -12 M -5 -6 L -12 0 -5 6",
		to: "M -12 0 H 12 M 5 -6 L 12 0 5 6",
		tests: ["tests/primitives.test.ts"]
	},
	{
		name: "a voltage source's plus sign sits beside its positive terminal",
		file: "src/symbols/electrical.ts",
		from: "{ right: [11, 0], down: [0, 11], left: [-11, 0], up: [0, -11] }",
		to: "{ right: [11, 0], down: [0, -11], left: [-11, 0], up: [0, 11] }",
		tests: ["tests/primitives.test.ts"]
	},
	{
		name: "a current-controlled voltage source carries its signs",
		file: "src/symbols/electrical.ts",
		from: "new Set(['voltage-dc', 'vcvs', 'ccvs'])",
		to: "new Set(['voltage-dc', 'vcvs'])",
		tests: ["tests/primitives.test.ts"]
	},
	{
		name: "a relation is read only where the last one ended",
		file: "src/syntax.ts",
		from: "(?:\\\\s+by\\\\s+(${DECIMAL}))?(?:\\\\s+|$)`, 'yd');",
		to: "(?:\\\\s+by\\\\s+(${DECIMAL}))?(?:\\\\s+|$)`, 'gd');",
		tests: ["tests/syntax.test.ts"]
	},
	{
		name: "a relative declaration needs a tail after its relations",
		file: "src/syntax.ts",
		from: "if (clause.relations.length > 0 && clause.tail < text.length) {",
		to: "if (clause.relations.length > 0) {",
		tests: ["tests/syntax.test.ts"]
	},
	{
		name: "a token reports the columns it sits at",
		file: "src/syntax.ts",
		from: "const [start, end] = match.indices![group]!;\n\treturn { text: match[group]!, start, end };",
		to: "return { text: match[group]!, start: 0, end: match[group]!.length };",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "a wire sets off along its pin's axis",
		file: "src/route.ts",
		from: "const heading = mode === 'point' ? axes[0] : 0;",
		to: "const heading = 0;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a pin is never entered from behind, along its own stub",
		file: "src/route.ts",
		from: "if (along[index] === to) continue;",
		to: "continue;",
		tests: ["tests/layout.test.ts", "tests/route.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "a free pin is never passed through",
		file: "src/layout.ts",
		from: "\t\t\tif (wired.has(`${component.id}.${port.id}`)) continue;",
		to: "\t\t\tcontinue;",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a wire runs inside its own component's clearance only at a price",
		file: "src/route.ts",
		from: "let cost = g + length * (soft === 2 ? 2 : 1) + history;",
		to: "let cost = g + length + history;",
		tests: ["tests/regressions.test.ts", "tests/layout.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "entering same-net copper away from the target is charged as a crossing",
		file: "src/route.ts",
		from: "if ((nextFlags & (OWN | SAME)) !== 0 && next !== targetCell) cost += SAME_NET_CROSSING;",
		to: "if ((nextFlags & OWN) !== 0 && next !== targetCell) cost += SAME_NET_CROSSING;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a lead of another net is contact, not open board",
		file: "src/route.ts",
		from: "\t\t\t\t\tif ((flags & OTHER_END) !== 0) penalty += contact;",
		to: "\t\t\t\t\tif ((flags & OTHER_END) !== 0) penalty += 0;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a loop is drawn along copper the net already has",
		file: "src/route.ts",
		from: "const along =\n\t\t\tloops.length === 0\n\t\t\t\t? undefined",
		to: "const along =\n\t\t\ttrue\n\t\t\t\t? undefined",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a connection end joins the tree only where it carries no arrow",
		file: "src/route.ts",
		from: "return fromIn ? wire.joinFrom : wire.joinTo;",
		to: "return fromIn ? wire.joinTo : wire.joinFrom;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "equal-key drafts are ordered by their endpoints, not by source order",
		file: "src/route.ts",
		from: "\t\t\t\tNumber(signature.get(left)! > signature.get(right)!) - Number(signature.get(left)! < signature.get(right)!) ||\n",
		to: "",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a same-net crossing is marked with a dot",
		file: "src/layout.ts",
		from: "if (!inside || seen.has(key)) continue;",
		to: "if (true) continue;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "the renderer draws every same-net dot, not only the junction",
		file: "src/renderer.ts",
		from: "\tconst junction = [...(routed.junction === undefined ? [] : [routed.junction]), ...(routed.joins ?? [])]",
		to: "\tconst junction = [...(routed.junction === undefined ? [] : [routed.junction])]",
		tests: ["tests/renderer.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "batched output dots every same-net crossing too",
		file: "src/renderer.ts",
		from: "\t\tfor (const point of [...(routed.junction === undefined ? [] : [routed.junction]), ...(routed.joins ?? [])]) {",
		to: "\t\tfor (const point of [...(routed.junction === undefined ? [] : [routed.junction])]) {",
		tests: ["tests/renderer.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "copper drawn twice on one row is one crossing",
		file: "src/layout.ts",
		from: "\t\t\t\tif (crossings.get(step - 1)?.includes(run.y) === true) continue;\n",
		to: "",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a bridge stops short of its own net joining the run",
		file: "src/layout.ts",
		from: "limit = Math.min(limit, Math.floor((Math.abs(ty - y) - 1) / 1000) * 1000);",
		to: "limit = Math.min(limit, radius);",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a lead is never run through another body",
		file: "src/layout.ts",
		from: "if (body.owner === owner || (facing && (body.owner === connection.from.componentId || body.owner === connection.to.componentId)) || !segmentEntersRect(stub.a, stub.b, body.rect)) continue;",
		to: "if (body.owner === owner || body.owner === connection.from.componentId || body.owner === connection.to.componentId || !segmentEntersRect(stub.a, stub.b, body.rect)) continue;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a lead is never run into a free pin",
		file: "src/layout.ts",
		from: "if (free.owner === owner || segmentContact(stub.a, stub.b, free.point, free.point) === undefined) continue;",
		to: "continue;",
		tests: ["tests/layout.test.ts", "tests/regressions.test.ts", "tests/route.test.ts", "tests/trunk.test.ts"]
	},
	{
		name: "a register numbers its extra inputs from two",
		file: "src/symbols/logic.ts",
		from: "left: ['in', ...range('in', component.inputs).slice(1)],",
		to: "left: ['in', ...range('in', component.inputs)],",
		tests: ["tests/ports.test.ts", "tests/regressions.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a tristate buffer draws its enable lead to the pin",
		file: "src/symbols/logic.ts",
		from: "<path ${paint} d=\"M 0 42 V 12\" />",
		to: "<path ${paint} d=\"M 0 24 V 12\" />",
		tests: ["tests/ports.test.ts"]
	},
	{
		name: "a splitter's tap is its first output",
		file: "src/symbols/logic.ts",
		from: "if (component.kind === 'bus' && name === 'tap') return ports.find((entry) => entry.id === right[0]);",
		to: "if (component.kind === 'bus' && name === 'tap') return undefined;",
		tests: ["tests/ports.test.ts", "tests/regressions.test.ts", "tests/parser.test.ts"]
	},
	{
		name: "text that fits is never compressed",
		file: "src/symbols/common.ts",
		from: "return mathLabelTextWidthAt(value, fontSize) <= maximum ?",
		to: "return mathLabelTextWidthAt(value, fontSize) < 0 ?",
		tests: ["tests/renderer.test.ts", "tests/uml.test.ts", "tests/snapshot.test.ts", "tests/math-label.test.ts"]
	},
	{
		name: "bold text is measured wider",
		file: "src/math-label.ts",
		from: "const BOLD_FACTOR = 1.043;",
		to: "const BOLD_FACTOR = 1;",
		tests: ["tests/math-label.test.ts", "tests/uml.test.ts", "tests/renderer.test.ts"]
	},
	{
		name: "a parsed label is frozen before it is shared",
		file: "src/math-label.ts",
		from: "const segments = Object.freeze(parse(value).map((segment) => Object.freeze(segment)));",
		to: "const segments = parse(value);",
		tests: ["tests/math-label.test.ts"]
	},
	{
		name: "a placement failure takes its dependants down silently",
		file: "src/placement.ts",
		from: "\tfor (const id of [...failed]) abandon(id);\n",
		to: "",
		tests: ["tests/placement.test.ts", "tests/diagnose.test.ts", "tests/parser.test.ts", "tests/regressions.test.ts"]
	},
	{
		name: "a cycle is reported once, not once per member",
		file: "src/placement.ts",
		from: "\t\tfor (const member of cycle) abandon(member);\n",
		to: "",
		tests: ["tests/placement.test.ts", "tests/diagnose.test.ts", "tests/parser.test.ts"]
	},
	{
		name: "left-of mirrors right-of exactly",
		file: "src/placement.ts",
		from: "return { x: reference.minX - gap - selfAtOrigin.maxX, y: position.y };",
		to: "return { x: reference.minX - gap - selfAtOrigin.maxX + 1, y: position.y };",
		tests: ["tests/placement.test.ts"]
	},
	{
		name: "a junction has no lead: its wires leave the node itself",
		file: "src/layout.ts",
		from: "\t\tif (component.kind === 'junction') return { owner: owners.get(componentId)!, point: placed.point, escape: placed.point };\n",
		to: "",
		tests: ["tests/regressions.test.ts", "tests/trunk.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a junction's body never stands in its own wires' way",
		file: "src/layout.ts",
		from: "kind: component.kind === 'junction' ? 'node' : 'body', rect: body }",
		to: "kind: 'body', rect: body }",
		tests: ["tests/regressions.test.ts", "tests/trunk.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a wire written to a junction part is drawn to it",
		file: "src/layout.ts",
		from: "\t\t\tmeetTo: components.get(connection.to.componentId)!.kind === 'junction',",
		to: "\t\t\tmeetTo: false,",
		tests: ["tests/regressions.test.ts", "tests/trunk.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "a junction's text sits beside its dot",
		file: "src/layout.ts",
		from: "\tif (component.kind === 'junction') {\n\t\treturn {",
		to: "\tif (component.kind === 'nothing') {\n\t\treturn {",
		tests: ["tests/regressions.test.ts", "tests/trunk.test.ts", "tests/layout.test.ts"]
	},
	{
		name: "text set beside a part starts at its anchor",
		file: "src/renderer.ts",
		from: "\tconst textStart = anchors.textX === undefined ? '' : ' style=\"text-anchor:start\"';",
		to: "\tconst textStart = '';",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a part's extent covers text set beside it",
		file: "src/layout.ts",
		from: "\t\t\trect.maxX = Math.max(rect.maxX, text.maxX);\n",
		to: "",
		tests: ["tests/regressions.test.ts", "tests/layout.test.ts", "tests/topology.test.ts", "tests/parser.test.ts"]
	},
	{
		name: "a junction's dot keeps out every other net",
		file: "src/route.ts",
		from: "\t\t\t\tif (!own.has(obstacle.owner)) block(obstacle.rect);",
		to: "\t\t\t\tif (false) block(obstacle.rect);",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a ket closes with an angle bracket, not the command's text",
		file: "src/math-label.ts",
		from: "\trangle: '\u27e9',\n",
		to: "",
		tests: ["tests/math-label.test.ts"]
	},
	{
		name: "a junction with every side taken joins its net's copper instead",
		file: "src/route.ts",
		from: "\t\t\tif (path === undefined && meet && mayJoin && !first) {",
		to: "\t\t\tif (false) {",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "placement measures from a junction's centred rows",
		file: "src/layout.ts",
		from: "\treturn rectUnits(componentExtent(component, true));",
		to: "\treturn rectUnits(componentExtent(component, false));",
		tests: ["tests/regressions.test.ts", "tests/placement.test.ts"]
	},
	{
		name: "a reference to a declaration that already failed is not reported as undeclared",
		file: "src/placement.ts",
		from: "\t\t\tif (reference === undefined && failedDeclarations?.has(relation.ref) === true) {",
		to: "\t\t\tif (false) {",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "connections are still checked after a placement fails",
		file: "src/parser.ts",
		from: "\t\tplacements = resolvePlacements(components, settled, limits.placementDepth, (error) => reporter.report(error), poisoned);\n\t\tcheckPlaced(settled);",
		to: "\t\tplacements = resolvePlacements(components, settled, limits.placementDepth, (error) => reporter.report(error), poisoned);\n\t\tif (reporter.failed) return undefined;\n\t\tcheckPlaced(settled);",
		tests: ["tests/diagnose.test.ts"]
	},
	{
		name: "a measured sheet keeps its margin around the drawing",
		file: "src/layout.ts",
		from: "\tconst margin = SCHEMATIC_SHEET_MARGIN * 1000;",
		to: "\tconst margin = 0;",
		tests: ["tests/auto-canvas.test.ts"]
	},
	{
		name: "a measured sheet holds its wire labels",
		file: "src/layout.ts",
		from: "\t\tif (label !== undefined) note(label.minX, label.minY, label.maxX, label.maxY);",
		to: "\t\tvoid label;",
		tests: ["tests/auto-canvas.test.ts"]
	},
	{
		name: "a measured sheet has no edge for an origin to be outside of",
		file: "src/parser.ts",
		from: "\tif (fence.bounds === 'auto') return undefined;",
		to: "\tif (fence.bounds === 'auto') fence = { ...fence, bounds: { width: 64, height: 64 } };",
		tests: ["tests/auto-canvas.test.ts"]
	},
	{
		name: "the surface starts where a measured sheet starts",
		file: "src/renderer.ts",
		from: "\tconst origin = sheet.x === 0 && sheet.y === 0 ? '' : ` x=\"${sheet.x}\" y=\"${sheet.y}\"`;",
		to: "\tconst origin = '';",
		tests: ["tests/auto-canvas.test.ts"]
	},
	{
		name: "a declaration with no position is a head and then a colour or an option block",
		file: "src/syntax.ts",
		from: "clause.relations.length === 0 && UNPLACED_TAIL.test(head[4]!) && !PLACEMENT_WORD.test(head[4]!)",
		to: "clause.relations.length === 0 && !PLACEMENT_WORD.test(head[4]!)",
		tests: ["tests/draft.test.ts", "tests/placement.test.ts"]
	},
	{
		name: "a placement word alone is not a colour",
		file: "src/syntax.ts",
		from: "clause.relations.length === 0 && UNPLACED_TAIL.test(head[4]!) && !PLACEMENT_WORD.test(head[4]!)",
		to: "clause.relations.length === 0 && UNPLACED_TAIL.test(head[4]!)",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "the draft follows a wire the way it was written before it follows one backwards",
		file: "src/draft.ts",
		from: "if (wire.forward && open(wire)) commit(",
		to: "if (open(wire)) commit(",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a pin at its part's centre has no side",
		file: "src/draft.ts",
		from: "pin.point.x === toMilli(part.x) && pin.point.y === toMilli(part.y);",
		to: "false;",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a drafted part keeps clear of every part already down",
		file: "src/draft.ts",
		from: "const clearance = DRAFT_CLEARANCE * 1000;",
		to: "const clearance = 0;",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a part too close to its own neighbour moves out, not aside",
		file: "src/draft.ts",
		from: "if (blocking.length !== 1 || blocking[0] !== anchor) break;",
		to: "if (blocking.length !== 0) break;",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "an author's position is never drafted over",
		file: "src/draft.ts",
		from: "const open = (wire: { readonly other: SchematicComponent }): boolean => drafted.has(wire.other) && !placed.has(wire.other);",
		to: "const open = (wire: { readonly other: SchematicComponent }): boolean => !placed.has(wire.other);",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a relation that reaches a drafted part waits for the draft",
		file: "src/parser.ts",
		from: "if (late.has(entry.component.id) || !entry.relations.some((relation) => late.has(relation.ref))) continue;",
		to: "if (true) continue;",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a document with no stated position starts at the draft origin",
		file: "src/draft.ts",
		from: "\tif (wholeDocument) {",
		to: "\tif (false) {",
		tests: ["tests/draft.test.ts"]
	},
	{
		name: "a junction its net's copper already runs through joins the tree there",
		file: "src/route.ts",
		from: "\t\t\t\t\t\tconnected.add(pointKey(end.point));",
		to: "\t\t\t\t\t\tvoid end;",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "a fitted gate never reads a part still to fit",
		file: "src/fit.ts",
		from: "far.componentId === component.id || pending.has(far.componentId)) continue;",
		to: "far.componentId === component.id) continue;",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "a pin wired only to its own part is not lined up with itself",
		file: "src/fit.ts",
		from: "if (near === undefined || far.componentId === component.id || pending.has",
		to: "if (near === undefined || pending.has",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "the nearest partner decides",
		file: "src/fit.ts",
		from: "\t\t\tcandidate.dx < best.dx ||",
		to: "\t\t\tcandidate.dx > best.dx ||",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "equally near partners go to the higher one",
		file: "src/fit.ts",
		from: "(candidate.y < best.y ||",
		to: "(candidate.y > best.y ||",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "a rail prefers its input's wire to its output's",
		file: "src/fit.ts",
		from: "arrival(component, input.id, connections, byId, pending) ?? arrival(component, outputs[index]!.id, connections, byId, pending)",
		to: "arrival(component, outputs[index]!.id, connections, byId, pending) ?? arrival(component, input.id, connections, byId, pending)",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "unwired terminals before the first wired one extend upward",
		file: "src/fit.ts",
		from: "if (index < first) return known[first]! - (first - index) * pitch;",
		to: "if (index < first) return known[first]! + (first - index) * pitch;",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "rails the least gap apart are accepted",
		file: "src/fit.ts",
		from: "if (lower.value - upper.value < FIT_GAP * 1000) {",
		to: "if (lower.value - upper.value <= FIT_GAP * 1000) {",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "pins the least gap apart are accepted",
		file: "src/fit.ts",
		from: "if (lower - upper >= FIT_GAP * 1000) continue;",
		to: "if (lower - upper > FIT_GAP * 1000) continue;",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "a fitted part is centred between its wires",
		file: "src/fit.ts",
		from: "\tconst centre = roundDiv(order[0]!.value + order.at(-1)!.value, 2);",
		to: "\tconst centre = order[0]!.value;",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "a fitted body never shrinks below its usual height",
		file: "src/fit.ts",
		from: "const height = Math.max(component.bodyHeight * 1000, 2 * (reach + pitch));",
		to: "const height = 2 * (reach + pitch);",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "an alignment at a terminal lines that terminal up",
		file: "src/placement.ts",
		from: "return { x: position.x, y: reference.originY - (relation.at === undefined ? 0 : terminalAtOrigin(relation.at).y) };",
		to: "return { x: position.x, y: reference.originY };",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "fitted gates with different rails never share one drawing",
		file: "src/symbols/quantum.ts",
		from: "symbol: (component) => (component.rails === undefined ? 'cnot' : `cnot-${component.rails.join('_')}`)",
		to: "symbol: () => 'cnot'",
		tests: ["tests/fit.test.ts"]
	},
	{
		name: "a junction end partway along copper is a node of the copper graph",
		file: "src/route.ts",
		from: "\t\tfor (const point of ends) points.set(pointKey(point), point);",
		to: "\t\tvoid ends;",
		tests: ["tests/regressions.test.ts"]
	},
	{
		name: "an absolute declaration may leave its label out",
		file: "src/syntax.ts",
		from: "const COMPONENT = new RegExp(`^(${ID}):(${ID})(?:\\\\s+\"([^\"]+)\")?",
		to: "const COMPONENT = new RegExp(`^(${ID}):(${ID})\\\\s+\"([^\"]+)\"",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a relative declaration may leave its label out",
		file: "src/syntax.ts",
		from: "const HEAD = new RegExp(`^(${ID}):(${ID})(?:\\\\s+\"([^\"]+)\")?",
		to: "const HEAD = new RegExp(`^(${ID}):(${ID})\\\\s+\"([^\"]+)\"",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a part declared without a label has the empty label",
		file: "src/parser.ts",
		from: "label: syntax.label?.text ?? ''",
		to: "label: syntax.label?.text ?? syntax.id.text",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a part without a label draws no label row",
		file: "src/renderer.ts",
		from: "${textStart}>${id}</text>${component.label === '' ? '' :",
		to: "${textStart}>${id}</text>${false ? '' :",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a part without a label leaves it out of its accessible name",
		file: "src/renderer.ts",
		from: "${component.kind}${component.label === '' ? '' : `, ${mathLabelText(component.label)}`}",
		to: "${component.kind}${`, ${mathLabelText(component.label)}`}",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "wires need not keep clear of a label row that is not drawn",
		file: "src/layout.ts",
		from: "return component.label === '' ? [designator] :",
		to: "return false ? [designator] :",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a part without a label decompiles without one",
		file: "src/decompile.ts",
		from: "${component.id}${component.label === '' ? '' : ` \"${component.label}\"`} at (",
		to: "${component.id} \"${component.label}\" at (",
		tests: ["tests/labels.test.ts"]
	},
	{
		name: "a swap has no controls until it is given some",
		file: "src/schema.ts",
		from: "define(['swap'], 'quantum', [count('controls', 0)",
		to: "define(['swap'], 'quantum', [count('controls', 1)",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "a buffer's terminal counts are fixed at one",
		file: "src/schema.ts",
		from: "count('inputs', 1, 1, 1), count('outputs', 1, 1, 1), orientation]);",
		to: "count('inputs', 1), count('outputs', 1, 1, 1), orientation]);",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "a full adder defaults to three inputs",
		file: "src/schema.ts",
		from: "count('inputs', 2, 1, 32, { full: 3 })",
		to: "count('inputs', 2, 1, 32, { full: 2 })",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "a stereotype needs at least one character",
		file: "src/schema.ts",
		from: "text('stereotype', 1, 128)",
		to: "text('stereotype', 0, 128)",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "an IC needs one pin on some side",
		file: "src/schema.ts",
		from: "requiresOneOf: ['left', 'right', 'top', 'bottom'],",
		to: "requiresOneOf: ['left', 'right', 'top'],",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "ports are asked of the parser with the options given",
		file: "src/schema.ts",
		from: "new Map(Object.entries(options)), 1);",
		to: "new Map(), 1);",
		tests: ["tests/schema.test.ts"]
	},
	{
		name: "a ports error carries no line, since there is no document",
		file: "src/schema.ts",
		from: "failure.message.replace(/^Line 1: /, '')",
		to: "failure.message",
		tests: ["tests/schema.test.ts"]
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
