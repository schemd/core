# Changelog

All notable changes to `@schemd/core` are recorded here. Dates describe actual npm publication dates; unpublished versions deliberately use `Unreleased`.

## [1.0.2] - 2026-10-18

### Fixed

- **A part placed against a declaration that failed is no longer told that declaration does not exist.** When a declaration's own line failed — an unknown option, say — anything placed relative to it was reported as referencing a part "the document never declares", which sent the author to a line that was fine. It is now left unplaced without a second diagnostic, as 1.0 already did for everything that depends on a failed placement. `resolvePlacements` takes the ids that already failed as an optional fifth argument. Found while writing the 1.0 documentation's diagnostics page.
- **A broken placement no longer hides a mistyped terminal elsewhere.** `diagnoseSchematic` stopped as soon as any relative placement failed, so a connection to a terminal that does not exist went unreported until the placement was fixed. Connections are now checked either way — a terminal's name depends on its part's kind, never on where it sits — and geometry and routing still wait for a document whose declarations are sound.
- **A connection to a junction that its net's copper already runs through follows that copper.** When an earlier wire of the net passed straight through a junction's dot, a later connection to that junction was routed toward a point the copper already touched, and could draw a small detour loop beside the dot. The junction now counts as joined, so the connection is drawn along the existing copper and adds no ink. Found by layout fuzzing over 40,000 random documents; the 270-document corpus draws byte-identically.

### Added

- **`scripts/fuzz.mjs`, a mutation fuzzer for the compiler's contract,** run in CI and by `release:check` as `test:fuzz:contract`. It breaks real documents the way an editor does mid-keystroke and checks every result: `compileSchematic` throws nothing but `SchematicSyntaxError`, `diagnoseSchematic` never throws and keeps every column range inside its line, the two agree on whether a document compiles, and a compiled document is deterministic, balanced, finite, and netlists cleanly. 840,000 cases found no contract violation.

## [1.0.1] - 2026-10-17

No changes from 1.0.0. This version was tagged before the fixes meant for it were merged, so its package is 1.0.0's code under a new version number; those fixes shipped as 1.0.2. Upgrading from 1.0.0 to 1.0.1 changes nothing.

## [1.0.0] - 2026-10-17

1.0 is a rebuild of the compiler's core behind the same language and the same API. The language is read exactly as before — the 0.8 declaration patterns are the front end — and of the corpus's 54 rejections under 0.8, 52 are byte-identical in 1.0. Drawings change, because the router is new, and three corpus documents change outcome; each is listed under _Changed_.

### Changed

- **Wires are routed by net, and a multi-terminal net is always a tree.** Connections that share a terminal are grown as one tree: the first runs terminal to terminal, every later one leaves the nearest copper the net already has, and every junction gets a dot. A junction is held two pitches off any pin, and a tree never meets four ways at one point. `trunk` is still parsed, validated and recorded as `connection.trunk`, but the drawing no longer depends on it — a net without it is drawn the same tree. A connection whose joining end carries a marker keeps its full terminal-to-terminal path, so an arrowhead never lands on a junction.
- **Routing is one lattice search per net, with negotiated congestion.** Wires live on a lattice of channel-pitch lines plus the coordinates that matter — obstacle edges, pins and escape points — and each search builds only its own window. Every net is routed once in an order derived from geometry, never declaration order, with contact between nets forbidden; most documents finish there. A net that cannot be placed that way is placed at a price, and the router negotiates: the nets in contact are torn up and rerouted with the price raised and a history cost on every location contested before (PathFinder, McMurchie & Ebeling 1995). Every cost is an integer, so the result is exact and identical on every engine. `routing.attempts` counts negotiation rounds and `routing.rippedUp` the wires torn up in them; `routingAttempts: 1` forbids contact outright. The per-connection router, its reorder and rip-up rescue, and bundle nudging are gone, so `routing.nudged` is always `false`.
- **Wires are drawn the way a draughtsman would.** A wire leaves its pin along the pin's axis and arrives along the target's, turning beside the obstacle rather than at the pin; it keeps clearance from component text and from every component, its own included, wherever there is room; it never passes through a pin nothing is wired to; and it never backs over its own stub. A pin whose exit runs through its own text leaves straight through it and turns only beyond it.
- **Bridges are drawn on vertical runs.** Where an orthogonal wire's vertical run crosses another net, the vertical run carries the arc; horizontal runs stay straight. An arc beside a neighbouring net's parallel wire shrinks to half the gap rather than bulging into it.
- **Geometry is integer milli-units throughout.** Coordinates are stored and compared as integers, rounding is symmetric about zero, orientation tests fall back to exact BigInt products past 2²⁶, and numbers are formatted from their digits. Public geometry is therefore exact to three decimals — a terminal 0.8 reported at `489.3333333333333` is `489.333` — and no corpus trace has a fractional coordinate (five 0.8 documents did).
- **`reset.out1` addresses the reset's output.** 0.8 resolved it to the input terminal. Every other spelling of every terminal on 175 kinds and variants resolves exactly as in 0.8, checked against a fixture recorded from the 0.8.0 build.
- **A line or Bézier wire through another component's terminal is rejected.** It would read as a connection: `Bézier route passes through R16.in, which it does not connect; use an orthogonal route or move R16.` One corpus document 0.8 compiled is now rejected for this, and one 0.8 rejected for a crossing now reports this instead. A third, which 0.8 rejected because an orthogonal wire crossed a drawn one, now compiles: the orthogonal wire is routed around it.
- **Wires written to a junction part meet at it.** A junction's node was treated like any pin, with a lead pointing left and a ring no branch could enter, so only one wire reached it, the rest tapped that one nearby with dots of their own, and an amplifier's feedback divider drawn through two junctions could not be routed at all. A junction now has no lead: its wires leave the node in any direction, straight, and its dot keeps out every other net. Its designator and label sit up and to the right of the dot, start-aligned, clear of all four exits; `componentTextAnchors` reports that position as `textX`. A junction part is the one place four wires may meet, because the author put it there; a fifth joins its net's copper beside it rather than failing. Whatever is placed relative to a junction lands exactly where it did, because placement still measures from its centred text rows.
- **A wire crossing its own net is dotted.** Two traces of one net that cross are one node, so the crossing carries a junction dot rather than reading as two wires passing; `RoutedConnection.joins` lists the points. A connection both of whose ends are already on its net's tree — a loop, or the same connection written twice — is drawn along the copper the net already has, and copper drawn twice on one row is bridged once.
- **Another net's lead is contact.** A wire may not cross a pin's lead anywhere along it, since a crossing beside a pin reads as wired to it; entering the net's own copper away from the joint is charged as a crossing, so a wire never runs through a pin of its own net to reach the tree; and a bridge stops a whole unit short of a junction on its run, so the dot always sits on copper.
- **Leads that cannot be routed are named.** Two nets whose leads touch: `A.out and B.in sit too close to route apart as separate nets: the wires leaving them would touch. Move one of them away, or join them with a shared net.` A lead running into another body: `C1.out1 sits against C2: the wire leaving it would run straight through C2. Move one of them away.` A lead running into a terminal nothing is wired to: `C2.out1 sits against C1.B, which nothing is wired to: the wire leaving C2.out1 would read as joined to it. Move one of them away, or wire C1.B.` Each was reported as a routing failure, or not at all.
- **Two connectors between the same sides are drawn apart**, and the drawing does not depend on which was written first: connections the router cannot tell apart by geometry are ordered by their endpoints, never by source position.
- **Text is measured, not estimated.** Label widths come from Arial's advance widths, which Helvetica, Liberation Sans and Arimo share, and the SVG names that stack as its default font. The worst deviation from the rendered width across the component vocabulary is 1.5%, from up to 44% under the 0.x per-character cell. Text is compressed with `textLength` only when it would overflow its space and is never stretched; designators and labels carry none. `mathLabelTextWidth` measures the same way, its `cellAdvance` read as a font size of `cellAdvance × 12 / 7`.
- **Every terminal of a digital block has a slot of its own.** 0.8 drew distinct terminals at one point: a flip-flop's `j` and `k`, `q` and `nq`, `preset` and `clear`; a mux's `select` and `enable`; a register's or counter's `clock` and `enable`; a comparator's `gt`, `eq` and `lt`. Data inputs sit on the left, outputs on the right, clock, enable and select below, preset and clear above, and every terminal has a lead drawn to it; a tristate buffer's enable lead now reaches its pin. A register enumerates the `in2`, `in3` and `out2` terminals 0.8 drew but did not list. **Breaking:** a flip-flop accepts only its own variant's letters — `j` on a D flip-flop is rejected, where 0.8 drew it on the first input.
- **Placement reports every broken relation.** Each is reported once, at the column of the reference at fault; each independent cycle is reported once, at its first stuck line; nothing placed against a broken declaration is blamed again. `resolvePlacements` takes an optional reporter and still throws the first problem without one. Placement arithmetic is in integer milli-units, so a relation and its mirror image land exactly opposite each other.

### Added

- **`diagnoseSchematic(source, fence)` reports every problem in a document at once**, in source order, each with its line and, where the compiler knows it, the column range of the token at fault. A declaration that fails does not cascade into the lines that use it, and placement, geometry and routing run only on a document whose declarations are sound. It returns `SchematicSourceDiagnostic[]` — `{ code, message, line?, column?, endColumn?, severity }` — and throws only for arguments that are not a document. `SchematicSyntaxError` carries the same `column`, `endColumn` and `code`; `SCHEMATIC_DIAGNOSTIC_CODES` lists the codes.
- A line rewritten by a sub-circuit parameter carries no column, since its columns would point at text the author never wrote.
- `RoutedConnection.joins`: where an orthogonal trace crosses another trace of its own net away from a junction.
- `\langle`, `\rangle` and `\oplus` in labels, so `|0\rangle` renders as the ket it reads as rather than as the command's text. They are measured like every other symbol.
- `ComponentTextAnchors.textX`: where a component's text rows start when they sit beside it rather than centred above and below it.

### Performance

- **A contended twelve-wire reversal bus compiles in 1.48 ms, from 16.6 ms.** It routes in the first pass. The search bound counts the bends a pin's facing makes unavoidable, which is exact in open space.
- **Compilation stays linear in document size.** A uniform-grid index over obstacles, wires and labels means a search reads only its window: 10,000 components compile in 0.27 s.
- Dense 16×16 routing is slower — 15.2 ms from 4.1 — because every one of its 32 targets sits on the far side of a tightly packed column of parts, and wrapping each one with clearance is real work on a finer lattice. Simple documents cost about 0.38 ms, from 0.22. Warm medians on one machine; run `bun run benchmark` on yours.

### Size

- **42,679 B gzip and 37,170 B brotli-11 for the compile path, 4.5 KiB over 0.8.** The rebuild deleted the old router, its rescue paths and the parallel per-kind switches, and replaced the 0.x declaration patterns' hand-maintained consumers with the patterns themselves under the `d` flag, which report token columns for free. It paid for routing by net, negotiation, the spatial index, exact geometry, draughting rules and the diagnostics model (40,666 B); then 669 B for measured text and complete placement diagnostics, and 1,344 B for the layout defects the property search below found and for junction parts. The budgets rise to 42 KiB gzip and 36.5 KiB brotli-11 for the compile path and 45 KiB and 39 KiB for the package. The size gate now measures brotli-11 beside gzip.

### Verified

- **100% statement, branch, function and line coverage over 654 tests**, including a router suite that proves negotiation converges, a differential test that the declaration front end classifies 40,000 generated lines exactly as the 0.8 patterns did, and the 0.8 port-resolution fixture.
- **A property search over random layouts.** Seeded documents — up to eleven parts of every family, wired at random, sparse and dense — are compiled and every drawing is checked for wires that end off their pin, run through a body or a free pin, touch another net, cross their own net without a dot, or are drawn over each other, for junctions on nothing, and for a drawing that changes when the declarations are shuffled. Each defect it found is fixed with a regression test from the minimised layout, and `tests/layout-properties.test.ts` keeps a fixed sample in the suite. Across 5,000 sparse and 3,000 dense seeds, what remains is the two limitations listed below.
- **99 of 99 mutants are killed.** Seventy-five are new, aimed at the 1.0 core. Each that survived its first run became a test: layouts found by search where a tree would meet four ways, where a rerouted tree would branch from its own torn-up copper, where a wire would run through another net's pin, and where a wire would back over its own stub.
- The corpus is re-recorded for 1.0. Of its 54 rejections under 0.8, 52 keep their exact message and line.

### Known limitations

- **Text is placed without regard to its neighbours.** A label sits at its component's fixed anchor, so on a crowded sheet it can overlap another part or a wire, and a wire that must clear text may take a long way round a label sitting in a narrow channel. Space parts by at least a label's width.
- **Several arrowed wires converging on one pin can meet four ways there.** An arrowhead never lands on a junction, so each arrowed connection keeps its own terminal-to-terminal path; when three or more arrive at one pin they share its final run. Join them at a junction part, or move the arrowheads to the far ends.
- Widths are measured for the Arial stack. A page whose CSS sets a wider face on the SVG will see labels overrun the space measured for them.

## [0.8.0] - 2026-10-16

### Added

- **`trunk` draws a multi-terminal net as a tree.** A net reaching four terminals used to be three wires that each ran back to the shared pin — stacked on one another where the router reused a channel, and meeting at T-junctions with no dot, which a reader cannot tell from a crossing. Mark a connection `[ortho trunk]` and it leaves the nearest copper its net already has instead of its own terminal, with a junction dot where it joins. Every point on a net is the same electrical node, so the netlist, `verifyNetlist`, `describeSchematic` and the source map are unchanged; only the drawing is.
- **Which end joins the net is decided by the source text.** A branch needs exactly one terminal already wired by a connection declared above it; that end becomes a tap and the other is the terminal the branch reaches. So `VIN.positive -> R3.in [ortho trunk]` fans out from VIN's copper, and `R2.out -> J.node [ortho trunk]` fans in to J's. The parser records the answer as `connection.trunk` (`'from'` or `'to'`) and refuses, with the line, a branch with neither or both ends wired, one on a `line`, `bezier` or UML connector, and a marker on the end that joins the net — there is no terminal there for it to sit on.
- **The tree is the sequential Steiner approximation, not an optimal one.** Each branch taps the closest point of the copper placed so far to its own escape point, held two channel pitches off any terminal so its dot cannot crowd the terminal's, and prefers a clean L leaving the trunk perpendicular over the router's midpoint dogleg. The junction is drawn where the branch actually leaves the net: one that sets off along a wire before turning has its dot at the turn. Candidates are tried nearest first with ties in route-then-segment order, so the tree is a function of the document. Under rip-up a branch placed before anything else on its net routes from its terminal, which is a legal drawing of the same connectivity.
- `full` mode stamps `data-wire-trunk="from|to"` on a branch's group, and `parseSchematicSvg` reads it back as `trunk: true` and writes `trunk` into recovered source, which recompiles to the same wires.
- A document containing a branch is never laid out as a bundle: a branch's shape is decided by the copper it taps, which a bundle placed as one set does not have.
- **Sub-circuits: a block written once and placed many times.** `subcircuit NAME [parameters] { … }` holds ordinary declarations; `NAME:ID at (x, y) [name=value]` places a copy. Inside a block, `expose TERMINAL = PART.port` names the terminals the outside may use, and `{{name}}` is replaced by a parameter anywhere on a line — labels, colours, options. Parameters may declare a default, and one declared without a default must be set by every instance. Instances nest; a block that contains itself, directly or through others, is refused and the chain is named.
- **It lowers to declarations the compiler already understands**, the way relative placement does, so no later pass changed. Each inner id is prefixed with its instance and an underscore — `U1` places `RT` as `U1_RT` — absolute coordinates are offset by the instance's position, relative placements are re-pointed at the prefixed ids, and `U1.mid` in a connection or a relation outside resolves through every level of nesting to the terminal `expose mid` named. A test parses an instance and the hand-flattened declarations it stands for and requires the same document.
- Copied declarations keep the line of the definition line that wrote them, so a diagnostic about a body declaration points at the declaration, and `sourceMap` maps every copy of `RT` to the one line that declares it. A body can reach only its own parts: an id inside it is always prefixed, so a reference out of the block names a part that does not exist.
- **Expansion is held to the `sourceCharacters` budget.** An instance is shorthand for the declarations it stands for, and without a ceiling three levels of eight instances would turn fourteen lines into 512 parts — nesting is otherwise an unbounded amplifier. A document that defines no sub-circuit skips the pass after one scan of its lines.
- Twenty-one diagnostics cover what can go wrong in a block: a definition inside another, a name that would shadow a built-in kind, a duplicate or unclosed or never-placed definition, an instance written with a label or colour, an unknown, missing, repeated or valueless parameter, an unclosed quote, an unknown `{{placeholder}}`, `expose` outside a block or repeated, a terminal an instance does not expose (with the ones it does), a relation measured from an instance rather than one of its terminals, an id shared by an instance and a part, and an expansion over budget.
- `parseSchematicSvg` recovers the flattened drawing; it has no way to tell which parts came from a block.

### Performance

- **The sparse router prices each grid edge once per route.** A profile of a thirteen-wire bus put 57% of compile time in `indexedSegmentCollision` and `wireSegmentCost`, and most of those calls asked a question already answered: the search reaches an edge from both of its cells, and from each cell once per arrival direction, while the obstacles and placed wires it is priced against stay fixed for the whole search. The arena now keeps one price per undirected edge under the same generation stamp as its score columns, so a fresh route still costs one integer increment. Reversal buses compile 1.42–1.57× faster: twelve wires in 18.3 ms from 27.5, thirty-two in 61.0 ms from 86.4. Dense 16×16 routing never reaches the sparse search and is unchanged.
- An edge is always priced from its west or north end, so its price cannot depend on which side reached it first. Both predicates are symmetric on an axis-aligned span — each reads only the span's extent, and the contact test's collinear branch reduces to one exact product when either delta is zero — and the change is byte-identical across all 261 corpus documents and eight further reversal-bus and dense-grid stress documents. It costs 127 B gzip.

### Verified

- Seven mutants join the kill gate for trunks: a branch taps only its own net, a junction is held off the terminals of the wire it taps, a junction slides to where the branch leaves the net, a branch tries a clean L before the general search, an L that sets off along copper is passed over, a document with a branch is never laid out as a bundle, and a branch joins the net at the end wired above it. The first and sixth survived the suite as first written — a tap on a foreign net is already illegal by the contact rule, and the first bundle fixture failed for reasons of its own — and were killed by fixtures built to separate them: eight foreign wires nearer than the trunk, which would spend every tap attempt, and a thirteen-wire bus whose branch happens to fit the bundle's shape.
- The pre-existing mutant `a mixed-curve bundle is never nudged` targets the guard trunks extended, and was re-pointed at the new line rather than retired.
- Trunks and sub-circuits are opt-in, and all 261 corpus documents are byte-identical. The corpus grows to 270 with nine documents for them — a fan-out in every output mode, a fan-in, a placed pair and a nested pair of blocks, and three that must be rejected — recorded after both features were added, so no earlier digest moved.
- Six mutants join the kill gate for sub-circuits: copied coordinates are offset by the instance position, nested offsets compose, an instance parameter overrides the default, a sub-circuit cannot contain itself, expansion is held to the source character budget, and an exposed terminal resolves through every level of nesting.
- **Sixty-one of sixty-one mutants are killed.**
- Three mutants join the kill gate for the edge cache: a price must not survive into the next route, an edge must be keyed by its axis as well as its cell, and an edge must be keyed by its west or north cell rather than by whichever cell reached it. A test pins the SVG digests of the eight- and twelve-wire buses recorded from the uncached router.

## [0.7.0] - 2026-08-01

### Added

- **A reversal bus routes at thirty-two wires, up from twelve.** When rip-up spends its whole budget the traces are no longer retried again in a different order — the bundle is laid out as a set. Every trace takes the same five-segment dogleg and they differ only in where each turns: rank decides an outbound column stepping inward from the source, an inbound column stepping inward from the target, and a row through the middle band. Assignment is made for the bundle at once, which is the thing reordering structurally cannot do.
- `routing.nudged` reports whether a document needed that path. False for everything that routed greedily, which is every document that compiled before this release.
- **It is a rescue, not a replacement.** It runs only after the retry budget is exhausted, so a document that compiles today reaches the same routes through the same code — all 261 corpus drawings are byte-identical. It requires a bundle that is entirely orthogonal, and it verifies every trace against the same obstacle and contact predicates the greedy router uses; if any check fails the bundle is abandoned and the original diagnostic stands. `routingAttempts: 1` still withholds it entirely, because a budget of one has nothing to exhaust and that setting is documented as restoring pre-0.5 routing exactly.

### Fixed

- **Corrects a documented claim.** 0.5.0 recorded thirteen wires as "a limit of the channel model rather than of declaration order", on the evidence that twenty thousand declaration orders failed to route one. The measurement was sound; the conclusion was not. Reordering decides which trace chooses first, and in a greedy pass somebody always chooses first, so no permutation reaches a layout in which no trace takes the middle channel — the search was evidence about ordering, not about the model. The same fence at the same twelve-unit pitch holds thirty-two wires. The README and the 0.5.0 entry are corrected in place.

### Performance

- **The SVG writer encodes instead of counting.** `BoundedSvgWriter` measured each fragment with a hand-written scan over every code unit and then stored the fragment again as a string; on a 512-component document that scan alone was 1.23 ms of a 6.29 ms render. Fragments now encode straight into one growable buffer, so measuring and storing are the same operation, and `encodeInto` reports the byte count as a side effect of work already being done. A 512-component figure compiles in 3.52 ms, from 5.52 ms.
- The budget stayed exact and stayed atomic, which is why it was worth doing this way rather than estimating. A chunk that does not fit entirely is detected rather than truncated, and the cursor advances only after the check passes — so a rejected append commits nothing, the property 0.3.2 fixed, now structural instead of maintained by ordering.
- **A rejected append can no longer be rejected wrongly.** The retired counter assumed any high surrogate began a valid pair and charged four bytes; an unpaired one encodes to three, so a document that fits could be refused. The writer now charges what it actually writes.
- `compileSchematic` no longer rescans the finished document to report `metrics.svgBytes`. The writer already counted it.
- **The orthogonal router's fallback search allocates nothing.** The bounded sparse A\* kept a heap of object literals and two `Map`s — tens of thousands of short-lived objects and two hash lookups per neighbour, on the hottest loop in the compiler. It is now three parallel typed arrays with the score columns indexed by state, the four-neighbour expansion unrolled, and one pair of scratch points for the whole search. A twelve-wire contended bus compiles in 29.3 ms, from 33.9 ms.
- The arena is reused across routes **and across rip-up passes**, which is where it matters: a twelve-wire bus takes seven passes, and each one used to rebuild its heap and maps. A generation stamp replaces clearing, so starting a route costs one integer increment.
- **The family predicates answer by hash rather than by scan.** `isClassicalGate`, `isDigitalComponent`, `isQuantumSpecial` and `isUmlComponent` each ran `KINDS.includes(component.kind)`, and the _false_ answer is the expensive one: an electrical component walked all forty-seven UML keywords before being told no. A 512-component profile put the four predicates at roughly 5% of compile time, nearly all of it in that failing scan. Each now tests a set **derived from the same frozen registry it classifies**, so membership cannot drift from the keywords the parser accepts — there is no second list to keep in step. A 512-component figure compiles in 2.69 ms, from 3.19 ms.
- **A bucket query no longer allocates when the cell is empty.** `indexedSegmentCollision` and `wireSegmentCost` read their spatial buckets as `get(cell) ?? []`, so every miss — the common answer on a sparse grid — bought a fresh array and an iterator in order to iterate nothing, in the innermost of three nested loops. Both skip the cell instead. A twelve-wire contended bus compiles in 25.2 ms, from 27.2 ms, and dense 16×16 routing in 4.18 ms, from 4.87 ms.
- Both of the above are byte-identical across all 261 corpus documents and cost 22 B gzip together. The predicate change adds **no new string literals** — the sets are built from the arrays already in the bundle — which is why a measurable speedup was available here at a price Part 4's techniques could not reach.

### Verified

- **A byte-identity corpus is now committed rather than improvised.** 0.3.5 validated three router changes against SHA-256 digests of compiled output, but the harness was a one-off, so every refactor since has had to re-argue the point from goldens. `scripts/corpus.mjs` compiles 261 documents — every component kind alone, every family's variant axis, four orientations of six kinds, every routing strategy and marker, forty seeded grids, relative placement, every output mode, and 51 documents that must be **rejected** — and digests the SVG together with the source map, placements and routing report. Both changes above are byte-identical across all 261, including the eleven- and twelve-wire buses that only compile by rip-up.
- Seven mutants join the kill gate for the writer and the arena: an unvisited router state must cost infinity, the heap must break ties on `g` before `state`, a new route must not inherit the previous route's scores, the heap must grow past the state count, the writer must refuse a chunk that overruns the budget, a rejected append must commit nothing, and the writer must report the size it actually wrote. Seven more join it for the bundle path: a budget of one retry must withhold it, the bundle must be ranked by the row each trace leaves from, each trace must turn on its own column and cross on its own row, a middle row outside its trace must be refused, obstacles must be checked, and a mixed-curve bundle must never be nudged. One more joins it for the family predicates: a set must be **derived from the registry it classifies**, which is the drift a hand-written literal would have risked. **Forty-five of forty-five are killed.**
- **A pre-existing mutant survived once the bundle path existed, and the test was strengthened rather than the mutant retired.** `a failed trace is promoted to the front of the next pass` was killed by a twelve-wire bus that would not compile with promotion broken; with the bundle path in place the same document compiles anyway, hiding the defect. It asserts `routing.nudged === false` now — twelve wires is the widest that reordering alone reaches, so it must get there on promotion and not be rescued. This is the hazard 0.5.0 recorded for rip-up, one layer further down, and it will recur for anything added below this one.
- **One proposed mutant was left out rather than chased.** Removing the crossed-column early-out changes no observable behaviour on any document the suite can build: a bundle narrow enough to cross its own columns is congested enough that the obstacle and occupancy checks reject the folded route a moment later. The guard earns its place by refusing an inside-out drawing directly rather than by accident, but a mutant nothing can distinguish is noise in the gate — the same call 0.6.0 made.
- **Wide buses are proved legal, not merely produced.** The retired ceiling test carried a warning worth keeping: a router that admits illegal edges would "solve" thirteen wires, which is how the defect would have looked like a feature. So the width cases read every segment back out of the compiled SVG and require that no two traces overlap collinearly or meet at a T — at 13, 16, 24 and 32 wires.
- The corpus now digests the **drawing and the evidence separately**. Adding `nudged` to the routing report moved all 261 combined digests while every compiled byte stayed identical, which read as "210 documents changed" and is indistinguishable from a routing regression. Split, the same change reports as no drawings and every evidence, and says what actually happened.
- **One mutant describes a defect this work actually shipped and the corpus caught.** `wireSegmentCost` prices a contact the geometry validator would reject at infinity, and the retired `g >= (gScore.get(state) ?? Number.POSITIVE_INFINITY)` is what refused it. Rewriting that as "an unvisited state is always an improvement" admits the illegal edge, and the router returns overlapping copper. Only congested documents notice, because only they price a contact that high — first-pass routes stayed byte-identical throughout.

### Changed

- `parseRgb` and `parseHsl` share their channel splitting. The two functions accept exactly the same shapes — legacy comma syntax with a fourth alpha channel, modern space syntax with a `/ alpha` suffix — and differed only in what the three channels must then be. Twelve identical lines were written out twice, so a fix to one spelling could miss the other; the difference is now passed in rather than duplicated around. Byte-identical, and size-neutral.
- The router arena allocates its columns on first use instead of in a constructor, and sizes its heap on demand rather than guessing from the grid. Behaviour is unchanged; it is 38 B smaller.

### Measured and not adopted

- **A packed glyph tape makes the bundle larger.** Nineteen static component vectors were re-encoded into an 85-symbol alphabet with coordinates as single characters, decoded by one interpreter, producing byte-identical output. It measured 20% smaller minified and **3% larger gzipped**: a packed tape is high-entropy and the templates it replaced compressed about 3.7:1. Dense packing wins in memory and loses on the wire.
- **A verbatim glyph table did not pay either, on this code.** Keeping the path data as low-entropy text and deleting only the per-variant functions and switch arms measured 23.5 B gzip per glyph against 33.6 B in a standalone prototype — but applied to the real `diode`, `transistor` and `ground` families it added 55 B. The prototype's baseline did not share substructure; `diodeShape` already hoists the junction path into a local and reuses it seven times, so the table de-duplicates worse than the code it would replace. Reverted.
- **Hoisting repeated string literals makes the bundle larger.** 2,525 literals across the compiler are only 916 distinct, and hoisting the most repeated ones into constants removes up to 3,044 B minified — while **adding 31 to 308 B gzipped**, the penalty growing with the number hoisted. Gzip already collapses repeats optimally; each new identifier is entropy it has to carry.
- **Family partitioning returns far less than projected.** Destructively stripping UML, quantum and digital from a scratch tree — the ceiling any plugin architecture could reach — recovers 2,273 B gzip (6.6%), not the 17% extrapolated from source-byte attribution. That estimate over-counted because it measured commented source, and JSDoc does not ship. The work is a registry threaded through the parser, layout and renderer plus a public entry per family, it only benefits hosts that opt into a narrow entry, and the default entry every existing host uses would grow. Not attempted on that evidence.
- **The bundle is at a gzip-efficiency floor.** Four independent techniques were measured and all three that reduced minified bytes increased gzipped bytes. The transferable rule: on this package, optimising for minified size is optimising against the metric that ships.
- **The compiler budget rises to 35 KiB from 34.** The arena accounts for 413 B, the writer 171 B and bundle nudging about 380 B; 40 B came back from the two deduplications above. Nudging cannot tree-shake out of the compile path — it is reached from the router, so every document that routes carries it — and it is what takes a reversal bus from twelve wires to thirty-two. Recorded here and paid for by a capability, in the same terms 0.5 used when relative placement moved the budget from 32. The package budget is unmoved at 37 KiB, with 138 B to spare.

## [0.6.0] - 2026-07-31

### Added

- **`snapshotSchematic` — a text digest of a diagram's geometry**, at `@schemd/core/snapshot`. Every component rectangle and every trace vertex, rounded to the three decimals the SVG writer emits, in source order, behind a `schemd-snapshot 1` version line. Committed as a fixture, a routing change now shows up in a pull request as the handful of coordinates that moved rather than as a red blob in an image diff. It does not replace the Chromium goldens: nothing here can tell you an arrowhead went missing, which is why `tests/visual` keeps the cases that need a renderer.
- **`parseSchematicSvg` — reading a compiled diagram back into declarations**, at `@schemd/core/decompile`. `full` mode already stamps each node group with its id, kind, label, line and orientation, positions it with a `translate` and paints it with a colour token; each wire group carries its endpoints, net, signal domain and bus width. This reads that back and writes canonical DSL. It is a bounded scanner over the attribute set the renderer writes, not an XML parser — the only inputs that need to work are documents this compiler produced.
- Recovery reports **what it could not get back**, in `lost`. Family options such as `type=` are not stamped anywhere a scanner can read — they survive only as prose inside an `aria-label` — so a recovered resistor is a plain resistor even if it was declared as a thermistor. There is deliberately no `fidelity: 'exact'` companion: every document with a component loses something, and a flag that can only hold one value tells a caller nothing.
- A group missing anything `full` mode always writes is **skipped rather than guessed at**. Inventing a label, a source line, or a straight-line curve for markup that was edited after the fact would put a fabricated declaration into recovered source.

### Verified

- The digest is checked against the drawing, not just against itself: the suite parses each component's `translate` and each trace's `d` back out of the compiled SVG and requires them to match the digest. A digest that drifted from what was drawn would be worse than none.
- Recovery is pinned by three round-trip properties — recovered source recompiles to the same topology, to the same placement, and is itself a fixed point — plus a fuzz property over randomized documents. That last one is an end-to-end assertion over the parser and the renderer at once: it fails if the renderer ever stamps a wire with an endpoint it did not draw, which no golden would notice.
- Six mutants join the kill gate: the digest must use the writer's precision, must report a stated orientation, must read a curve from the path that was drawn, must write a CSS colour without the token sigil, must reject a colour the parser does not define, and must skip a group missing its attributes. Thirty of thirty are killed.
- **One proposed mutant was removed rather than chased.** It swapped the digest's route-cache lookup for a fresh route — but both paths must produce identical output, and that agreement is the property the suite already asserts. It described an implementation detail, not a behaviour, and a mutant nothing can distinguish is noise in the gate.

## [0.5.0] - 2026-07-30

### Added

- **Relative placement.** A declaration can state where it sits instead of computing it: `resistor:R1 "1 kΩ" right-of VIN by 190 #amber`. Six relations — `right-of`, `left-of`, `above`, `below`, `aligned-x with`, `aligned-y with` — each taking a component or one of its terminals, and the four directions taking an optional `by` distance. `at (x, y)` is untouched, the two forms mix freely, and a document that uses only coordinates compiles to the bytes it always did.
- Directions measure from the referenced **body**, so `by 190` is 190 units of clear space between facing edges. An axis no relation sets is inherited from the first reference, so `right-of A` means beside A and level with it; an alignment overrides that.
- **It is a lowering pass, not a layout engine.** Relations resolve to one `at (x, y)` before the AST is finished, so the netlist, design rules, source map, and renderer never learn relative placement exists. Pinned as a property: a relative document and the absolute one it resolves to compile to **byte-identical SVG**.
- Resolution is one topological sort and one pass of arithmetic. Forward references work; a cycle is an error naming its members in order.
- `compileSchematic` returns `placements` — what each relation resolved to, with port aliases folded to canonical terminals, sorted by source line, empty when unused. Also at `@schemd/core/placement`.
- `compileSchematic` returns `routing` — `attempts` (rip-up retries, zero for a first-pass route), `rippedUp`, and `congestion` per routing-hash cell with `SCHEMATIC_CONGESTION_CELL_SIZE` describing the grid. Read out of the hash the router already filled.
- New `limits` fields: `placementDepth` (64) caps a reference chain, `routingAttempts` (12) caps routing passes. `routingAttempts: 1` restores pre-0.5 routing exactly.
- `routeSchematicConnections` and `validateSchematicGeometry` return routes _and_ the report. `routeConnections` and `validateDocumentGeometry` keep their signatures.

### Changed

- **Routing retries around contention rather than giving up at the first trace that will not fit.** The first pass is still the greedy source-order route, so anything that already compiled takes the path it always did. When a trace fails, what has been laid is torn up and tried again with that trace first and the rest ordered shortest-span-first.
- A reversal bus now routes at **twelve wires, up from ten**.
- **Thirteen is where it stops, and that is a limit of the channel model rather than of declaration order.** Widening the fence changes nothing, and twenty thousand random orders were searched at that width without finding one that routes. Pinned by a test so a future channel-model change has a target. **Corrected in 0.7.0:** the measurement was right and the conclusion was wrong. Twenty thousand orders cannot reach a layout in which no trace takes the middle channel, because in a greedy pass somebody always chooses first — so the search was evidence about ordering, not about the model. The same fence at the same pitch holds thirty-two wires.
- The gzip budgets rise to 34 KiB and 37 KiB, from 32 and 35. Relative placement cannot tree-shake out of the compile path — it is a language feature, so every document that parses carries it. Recorded rather than absorbed.

### Verified

- Ten mutants join the kill gate, one per load-bearing property. Twenty-four of twenty-four are killed.
- **A pre-existing mutant survived once rip-up existed, and we strengthened the test rather than retiring the mutant.** `terminal approaches are reserved before any wire is placed` was killed in 0.4.0 by a reversal-bus fixture that could not compile without the reservation; with retries in place the same fixture now compiles anyway, hiding the defect. It asserts `routing.attempts === 0` now — a bus that size is an ordinary figure and must not need a retry. This is the hazard the feature introduces generally: rip-up can paper over a router defect that used to fail loudly.
- Determinism is asserted rather than argued: a congested document compiles to one distinct output over 250 runs and reports the same routing over 50. What in-process repetition cannot check is a different process on a different platform, which CI covers by compiling on Linux the goldens written on macOS.
- The fuzz suite gains random placement graphs — forward, backward, self, and cyclic references — and asserts each one either resolves with finite coordinates or is rejected with a line-accurate diagnostic. Never a hang, never an unhandled throw.
- A congested-routing case joins the benchmark with its own ceiling. Every existing case routes on the first pass and would have stayed green while the retry path grew arbitrarily expensive.

### Performance

- Clean documents are unaffected, measured rather than assumed: the dense 16×16 routing benchmark is unchanged, because a first-pass route runs the code it ran before rip-up existed. The twelve-wire contended bus, which no source order can route at all, compiles in about 31 ms.

## [0.4.0] - 07/26/2026

### Fixed

- Every connection that declares a closed endpoint marker paints one. SVG resolves `marker-start` at the first vertex of a _path element_ and `marker-end` at its last — not once per subpath — so the compound trace that `default` and `embedded-css` output emit showed a single arrowhead however many wires shared a batch. Three `[arrow]` connections in one colour produced three lines and one arrow. Connections carrying `arrow`, `dot`, or `diamond-filled` now keep a path to themselves; unmarked traces still compound, and open markers still travel on their own carrier. Every marker fixture in the suite happened to give each wire a distinct colour, which put every wire in a batch of its own and hid the defect from the goldens.
- A reversal bus routes. The router scored reuse of an occupied channel as expensive-but-legal while `routeConnections` rejected it outright, so it could return a route it had already proved would be thrown out; a four-wire crossbar failed from the third wire on, with no workaround, since crossing traces must be orthogonal. A contact the contact validator rejects now costs the router infinity through the same predicate the validator uses, every trace reserves its terminal approach before any wire is placed, and a blocked channel offers a lane a pitch to either side. A reversal bus of ten wires compiles where three used to.
- Port aliases address one terminal everywhere. `SchematicEndpoint.port` has always been documented as canonical, but the parser never normalized it, so topology resolution, contact validation, the netlist and the design rules each keyed on whichever spelling the author typed. `R1.out -> A.in` beside `R1.r -> B.in` was rejected as two nets colliding at a point they shared, while the same diagram spelled `R1.out` twice compiled; `V1.out -> P1.in` escaped the `shorted-supply` rule that `V1.positive -> P1.in` triggered. The parser now rewrites both endpoints to the terminal they resolve to.
- Integrated-circuit pins serialize at the documented precision. Pin stubs and labels interpolated raw JavaScript numbers while every other vector went through the three-decimal writer, so a pin count that divides badly emitted seventeen significant digits — and a drawn stub end that disagreed with the routed port point below the third decimal.
- A terminal can no longer be wired to itself. `R1.in -> R1.in` compiled to `d="M 158 200 H 158"`: a wire that paints nothing, carries a label nobody can see, and adds a one-terminal net. Aliases made it easy to write by accident, since `emitter` and `source` are one lead on a MOSFET.

### Added

- **`limits`: an optional per-compilation resource budget.** `components`, `connections`, `sourceCharacters`, `wireCrossings` and `svgOutputBytes` may each be set on the compile options; every omitted field keeps its default, so passing nothing behaves exactly as before, and `Infinity` states no limit explicitly. This restores the cheap early rejection the retired counts used to provide, under the control of the host that knows whether the source is trustworthy: a budget rejects a document at the declaration that crosses it, before any routing or rendering.
- The budget is resolved once per compilation and handed to both passes, so an accessor cannot be generous to the parser and mean to the renderer — the same defence the fence's bounds and title already had. `compileSchematic` now snapshots bounds for the same reason.
- A misspelled field is an error rather than a silent no-op. A limit a host believes it set and did not is worse than no limit at all.

### Removed

- **A document is no longer capped at a component or connection count.** `MAX_SCHEMATIC_COMPONENTS` and `MAX_SCHEMATIC_CONNECTIONS` are gone, along with their entries in `SCHEMATIC_LIMITS` — a diagram may declare as many of either as it can place. Removing the counts alone would have changed nothing a user could see, because three other ceilings stood behind them: a 4,096-unit canvas that could not hold a thousand parts however many the parser allowed, a 131,072-character source cap that ran out near three thousand declarations, and a 2 MiB output cap. The canvas now runs to 1,048,576 units a side, one call reads up to 16,777,216 characters, and the writer emits up to 256 MiB. What remains bounds allocation, not diagram size. **Breaking for anyone importing the two constants or reading `SCHEMATIC_LIMITS.components`.**
- Scaling was measured rather than assumed: 64,000 components with 32,000 connections compile in about a second, at a flat 16 µs per component from 8,000 up. 11,200 components with 800 obstacle-dodging orthogonal traces take 130 ms. A performance gate now compares per-component cost at 1,000 and 10,000 components, so a quadratic term cannot reappear behind the retired ceiling.
- **Hosts compiling untrusted source should set a `limits` budget and a timeout.** The old counts doubled as a cheap early rejection; the defaults that replaced them sit far past any readable diagram, and no byte ceiling stops a small document from being expensive to route.

### Changed

- An unroutable orthogonal connection names both endpoints and three things that free a channel, in place of the bare `No collision-free orthogonal route exists.` The router now refuses contacts the validator would reject, so this is the diagnostic such a trace reaches.
- Canvas and title validation live in one place each instead of three near-identical copies across the fence parser, the runtime parser boundary and the renderer. `Render title must be a non-empty string of at most 512 characters.` is now `Render titles cannot be empty.` / `Render titles cannot exceed 512 characters.`, matching the parser's wording.
- The two size budgets rise to 32 KiB and 35 KiB gzip, from 31 KiB and 34 KiB. The configurable budget, port canonicalization and the routing fixes are real additions; the gate caught the growth, the two deduplications above paid part of it back, and the rest is recorded here rather than absorbed silently.
- The routing spatial hash addresses cells with a 2^26 column stride. The old 8,192 stride was only collision-free because bounds stopped at 4,096 units; two traces on a larger canvas would have hashed into one bucket and been compared as though they touched.
- `BoundedSvgWriter` takes an optional byte ceiling, defaulting to the compiler's. Verifying the boundary no longer means allocating 256 MiB to reach it.
- `canonicalPortName` is exported. Hosts that resolve author-written port names — link targets, hover cards, netlist overlays — need the same answer the compiler uses.

### Verified

- A regression suite states each defect and pins the property that makes it impossible, rather than the output that happened to change. Where the old behaviour was _asserted by the suite_ — a compound path carrying one arrowhead for two wires, a transistor lead wired to itself — the assertion is now its inverse.
- Seven mutants join the kill gate: a rejected contact must cost the router infinity, terminal approaches must be reserved before routing, a blocked channel must offer a lane aside, a closed marker must keep its trace out of a compound path, a supplied budget must be enforced rather than accepted, a misspelled budget field must fail, and one budget must govern the whole compilation. Fourteen of fourteen are killed.
- Two Chromium goldens cover the blind spot the existing four shared: four same-colour wires that each declare a closed marker, and a four-wire reversal bus.

### Performance

- Cubic Bézier obstacle testing no longer allocates four mapped arrays and four spreads per subdivision, on a function that halves the curve until its hull is a quarter-unit across. Bézier-heavy documents compile roughly 60% faster.
- Wire-contact testing allocates nothing per call, and the universal contact pass stamps candidates instead of allocating a `Set` for every span in the document. Dense orthogonal routing pays about 13% more than 0.3.8 overall: the router now prices spans it previously emitted blind, and has more places to put a wire.

## [0.3.8] - 07/26/2026

### Changed

- Geometry diagnostics say how to fix the diagram, not only what is wrong with it. An overlap now reports the amount and a coordinate that clears it — `R2 overlaps R1 by 44 units horizontally; move R2 to x >= 284, or use a UML container` — expressed in the `at (x, y)` origin the author types rather than the derived body rectangle. The advice follows the axis the author already used to separate the pair, so two parts side by side move apart sideways instead of being stacked because that happened to be eight units cheaper.
- Out-of-bounds diagnostics name the offending coordinate and the range it must fall in. A body that escapes the canvas after layout reports the overhang and an origin that would contain it, and notes that widening the fence is also an answer.

### Documented

- The README carries a standing statement of limitations and operational risks. `verifyNetlist` performs structural linting over a flat connectivity model — not electrical, timing, analog, or functional verification — and a clean result does not mean a circuit is correct. Routing is deterministic but bounded. The model is flat and capped at 512 components. Coverage percentages describe the exercised source, not the published package or every runtime.
- The 0.3.4 and 0.3.6 entries below are corrected in place: both announced a subpath the package export map did not expose, and the claim stood for three releases.

### Verified

- Every geometry diagnostic is asserted twice: once for the text it produces, and once by applying its own advice to the rejected document and compiling the result. Advice that fails to resolve the error fails the suite.

## [0.3.7] - 07/25/2026

### Fixed

- `@schemd/core/netlist` and `@schemd/core/describe` are importable. Both modules shipped in the tarball with no entry in the package `exports` map, so `import '@schemd/core/netlist'` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` while `dist/netlist.js` sat there unused — the netlist subpath since it was announced in 0.3.4, the describe subpath since 0.3.6. Nothing caught either, because every test imports from `src`, where subpaths do not exist.

### Verified

- A packaging test now decides, in one place, which source modules are public: every one of them must have a subpath, every subpath must resolve to the module it names, and no subpath may point at a module that is not there. Removing an entry fails the suite.

## [0.3.6] - 07/25/2026

### Added

- Diagrams can describe themselves. `describeSchematic` and `describeNetlist` derive a deterministic account of a document from its connectivity — scale and signal domain in one sentence fit for an `alt` attribute, an inventory grouped by kind, and one sentence per net naming the terminals it ties. Labels are flattened through the same `mathLabelText` the renderer uses, so `V_{in}` is spoken as `Vin` and `1 k\Omega` as `1 kΩ`. The description states only what the netlist proves: it does not name circuit archetypes, because recognising an intent the source never declared produces a confident wrong label, which is worse for a screen-reader user than an accurate structural one.
- The module is deliberately absent from the package entry, so neither size budget moves and a host that only compiles carries no prose generation. **Correction (0.3.7):** the module was intended to be reachable as `@schemd/core/describe`, but the required package export was missing until 0.3.7. Consumers of 0.3.6 cannot import that subpath.

### Verified

- Description output is covered to the project's 100% statement, branch, function, and line thresholds, including documents that declare nothing, a single component, labels that only repeat their identifier, and nouns whose plural is irregular.
- Both size budgets are unmoved from 0.3.5, because the entry point does not reach the new module.

## [0.3.5] - 07/25/2026

### Changed

- The router's spatial hash addresses both axes. Cells were keyed on x alone, so a single column held every obstacle stacked along it and a short segment paid the participation predicate and a slab test once per row — the quadratic term in routing a tall document. Obstacle and wire cells are now keyed on column and row, with a y-span rejection ahead of the exact predicates. Dense 16x16 routing drops from 7.7 ms to 4.1 ms, and a 512-component chain — one connection per component, the shape that provoked the old behaviour — from 40.4 ms to 16.3 ms. Output is byte-identical.
- Router lane candidates are gathered without intermediate arrays. Each list was built by spreading a two-element array per obstacle into a set; obstacle bounds are now added to the set directly. De-duplication still precedes the sort, because a grid repeats the same few coordinates on every row and collapsing runs after sorting proved markedly slower on exactly those documents.
- The slab test's first early-out is gone. The axis-aligned cases return before it, so both deltas are non-zero and no NaN can short-circuit; the clips are monotone, so an empty x interval stays empty and the second early-out already returns the same answer.

### Verified

- Output equivalence is checked against 173 documents — every diagram in the published documentation plus seeded random grids, including the 53 that compile to a diagnostic — by comparing SHA-256 digests of the compiled SVG before and after. All three changes are byte-identical to 0.3.4.
- Coverage, the targeted mutation gate, and the Chromium goldens all hold at their release thresholds. Removing the early-out kept branch coverage at 100% rather than stranding a branch the new filters made unreachable.

## [0.3.4] - 07/25/2026

### Added

- Connectivity is now a first-class artifact. `buildNetlist` returns the nodes, nets, and edges behind a validated document, `verifyNetlist` runs deterministic design rules over that model, and `inspectSchematic` does both in one call. Seven rules ship: shorted supply rails, conflicting bus widths, mixed signal domains, unconnected components, duplicate connections, contended digital drivers, and disconnected subcircuits. Diagnostics carry a stable code, a severity, the subjects involved, and the source line wherever a declaration owns the fault.
- `SCHEMATIC_RULES` publishes the rule catalogue — code, severity, and summary — so hosts can document or filter checks without hard-coding strings. **Correction (0.3.7):** the module was intended to be reachable as `@schemd/core/netlist`, but the required package export was missing until 0.3.7. Consumers of 0.3.4 through 0.3.6 cannot import that subpath.

### Changed

- Orthogonal routing no longer re-answers the same question. Obstacle participation is resolved once per route rather than once per segment query, obstacles spanning several buckets are examined once, and the innermost slab test allocates nothing. Dense 16x16 routing drops from 10.4 ms to 7.5 ms with byte-identical output.
- Every component emitted two label elements carrying identical paint. With a stylesheet present that paint now lives in the stylesheet; without one it travels on a single inherited group. Text lengths round through the shared number formatter, so `textLength="17.849999999999998"` is gone. A 512-component diagram falls from 279,243 to 246,987 bytes, a repeated instance from 541 to 478 bytes, and the Chromium goldens are unchanged.

### Verified

- Netlist extraction and every rule are covered to the project's 100% statement, branch, function, and line thresholds, including documents whose edges name components that were never declared.

## [0.3.3] - 07/21/2026

### Changed

- `cnot` is now an intrinsic two-track controlled-X with continuous control and target rails. Canonical `in1`/`out1` and `in2`/`out2` ports compose directly with quantum wires; legacy `in`, `out`, `control`, and `target` endpoint spellings remain valid.

### Verified

- A Chromium golden locks the two-rail CNOT geometry and its reversed horizontal orientation.

## [0.3.2] - 07/20/2026

### Added

- Signal connections now resolve to first-class net topology. Exact shared terminals and junction branches join implicitly, `net=NAME` joins disconnected segments explicitly, unnamed nets receive deterministic `$N` identities, and every net enforces one signal-domain/width contract.
- Straight, cubic Bézier, and orthogonal routes now share one collision policy across component bodies, transformed endpoint markers, and topology-aware wire contacts. Separate nets may meet only at bridgeable perpendicular orthogonal crossings.
- Physical-body overlap detection rejects accidental node collisions while preserving edge contact, UML semantic containment, and lifeline activation/execution/destruction overlays. The validator uses an x-ordered, lazily expired y-bucket sweep and includes a 240-body adversarial regression.
- Chromium visual regression gates now pin net/junction/bridge geometry plus line, Bézier, marker, container, activation, and destruction output in committed, font-independent goldens.
- Orthogonal routing now builds one document-level x-bucket index and reuses it for every obstacle query. Source-ordered routes add their flattened wire segments and connector-label rectangles to the same index: same-net reuse is free, strict crossings are cheap, and unrelated collinear channel reuse is strongly discouraged.
- Deterministic bounded property fuzzing exercises 60 randomized parallel-net documents and 24 randomized crossing meshes. A dependency-free mutation gate isolates seven high-risk net, routing, overlap, and marker mutants in a temporary tree and requires a 100% kill score.
- A third Chromium golden renders every open marker family over a checkerboard host background, making opaque interiors, hidden carrier leakage, and endpoint-trace bleed pixel-visible.

### Changed

- Full-mode wire groups expose `data-net-id`, and `SchematicWireSource` carries the same parser-resolved identity for host simulations and probes.
- Same-net crossings remain continuous without bridge arcs. Separate-net collinear overlap, endpoint contact, non-orthogonal crossing, and subpixel bridge clusters now fail with source-line diagnostics instead of producing ambiguous copper or malformed scallops.
- Mixed-curve wire contact checks use bounded spatial buckets; all-orthogonal documents retain the specialized crossing pass and its bridge ownership order.
- Open arrow, triangle, and diamond markers no longer assume a white or theme-surface fill. A zero-width semantic carrier places the marker while the visible trace is inset beneath its genuinely transparent interior, including in interactive hover states.
- Bridge control points now remain in traversal order, so the final routed point is always the actual target endpoint rather than a bridge extremum.
- The component type guards and the SVG number formatter now have exactly one implementation each: the parser and renderer import layout's canonical guards, `svgNumber` is an alias of `formatNumber` (proven byte-identical across 2M sampled values), and the renderer's 24 repeated text-paint and 8 `lengthAdjust` attribute literals are shared fragments. Output is byte-identical.

### Fixed

- The public parser now validates and snapshots JavaScript-supplied source, bounds, and title values before parsing or routing, preventing raw `TypeError`s and geometry changes from volatile accessors.
- The documented legacy `schematic` fence identifier works again; recognition no longer rejects the alias before its compatibility grammar can run.
- `schematicSourceMap` now enforces the same parser-provenance boundary as the renderer instead of trusting forged mutable documents.
- The bounded SVG writer commits its byte count atomically, so a rejected multibyte append does not corrupt subsequent in-budget writes.
- Full-mode component accessibility labels now expose rendered Unicode micro-math text instead of raw `_`, brace, and backslash syntax.
- Grammar documentation no longer claims unsupported delimiter escaping.

### Verified

- Compiler bundle: 101,672 B minified, 30,348 B gzip — 372 B below the 30,720 B gate.
- Coverage: 100% statements, branches, functions, and lines across 143 unit, stress, and property tests; 7/7 targeted mutants killed; 3 Chromium visual goldens.
- Across three isolated Node.js 26.4.0 / Apple Silicon runs, the median warm run measured 0.249 ms for the representative compile, 5.727 ms at the 512-component ceiling, and 10.705 ms for the occupancy-aware dense 16×16 crossing fixture.
- Runtime dependencies: zero.

## [0.3.1] - 07/20/2026

### Fixed

- Orthogonal routing no longer fails diagrams whose components sit closer than twice the 12-unit clearance margin. The post-routing guard now rejects only physical body clips; escape stubs may legitimately pass through a neighbor's clearance ring, so densely packed parallel wires route as straight traces instead of throwing `Orthogonal route intersects … after routing.`
- Empty `qgate` detail rows (`parameter=""`, `phase=""`, `matrix=""`) no longer reserve blank text space: layout and renderer now agree that empty details are absent, so such gates keep the canonical shared quantum shell.
- `embedded-css` output no longer emits keyboard-focusable component and wire groups beneath its `role="img"` root, which flattened them for assistive technology while leaving unlabeled tab stops. Internal `tabindex`/ARIA semantics are now exclusive to `full` mode, and every `full`-mode root is `role="group"` regardless of which semantic hooks are enabled.

### Changed

- `renderSchematic` skips the redundant geometry revalidation pass when the parser's route cache proves the same frozen document already validated against identical bounds, and computes the AST-serializing signature hash only when no `idPrefix` is supplied. Rendered output is byte-identical; hosts that pass `idPrefix` (such as compile endpoints) no longer pay an `O(document)` serialization per render.

### Verified release-candidate measurements

- Compiler bundle: 90,294 B minified, 26,479 B gzip — 4,241 B below the 30,720 B gate and 33 B smaller than 0.3.0.
- Coverage: 100% statements, branches, functions, and lines across 123 tests, including new regressions for sub-clearance routing, single-track barriers, and empty quantum detail rows.
- Runtime dependencies: zero. No public API, grammar, or geometry contracts changed; no migration is required.

## [0.3.0] - 07/19/2026

### Added

- Exact quarter-turn component orientation through `orientation=right|down|left|up`, including rotated ports, outward normals, AABBs, text extents, obstacle routing, and four-turn identity.
- Electrical sources, native junctions/test points/connectors, power symbols, switch and protection families, amplifiers, resonators, meters, loads, expanded passive/diode/transistor variants, and side-aware IC orientation.
- Digital buffers, logic states, clocks, latches/flip-flops, mux/demux blocks, encoders, decoders, registers, counters, half/full adders, comparators, and bus primitives.
- Named and parameterized quantum gates, preparation/reset/measurement, control and swap structures, generalized controlled gates, barriers/delays, and classical result nodes.
- First-class UML structure, deployment, activity, interaction, and state-machine primitives plus synchronous, asynchronous, return, control-flow, object-flow, assembly, and delegation relations.
- Public vocabulary registries and discriminated AST contracts for every new family, signal domain, output mode, semantic hook, and UML relation.

### Changed

- `qgate` now uses the same high-fidelity shell, typography, sizing discipline, orientation path, and semantic metadata quality as `hadamard`, while retaining optional `parameter`, `phase`, and `matrix` detail rows.
- Orthogonal routing consumes rotated component obstacles and terminates at exact rotated semantic ports.
- Repeated canonical geometry is amortized through diagram-local `<symbol>`/`<use>` reuse; unused families emit no definitions.
- The hard compiler budget is now exactly 30,720 B gzip and fails at 30,721 B.

### Compatibility and migration

- Existing syntax without orientation remains valid; omitted orientation is byte-for-byte equivalent to `orientation=right` where compatibility is promised.
- Existing component kinds, public entry points, port aliases, `hadamard`, `cnot`, `qgate`, IC, diode/transistor, logic, and UML documents remain supported.
- New public AST members are additive. TypeScript consumers with exhaustive switches over `SchematicComponent['kind']` must add the 0.3.0 discriminants.
- See [the 0.2.x migration guide](./docs/MIGRATION-0.3.md) for exact changes.

### Verified release-candidate measurements

- Compiler grew from 59,363 B minified / 18,181 B gzip in 0.2.1 to 90,714 B minified / 26,398 B gzip in 0.3.0. The candidate retains 4,322 B below the 30,720 B gate.
- Coverage: 100% statements, branches, functions, and lines.
- Runtime dependencies: zero.
- On Node.js 26.4.0 / Apple Silicon, the Phase 5 warm medians were 0.202 ms for the representative RC compile, 6.583 ms for 512 rotated components, and 2.982 ms for the dense 16×16 routing fixture. Their SVG outputs were 6,019 B, 279,243 B, and 44,604 B respectively.
- The repeated-symbol fixture emitted 1,353 B for one resistor and 35,463 B for 64 mixed-orientation instances: 541.429 B per additional labeled instance after the shared symbol definition. Re-run `bun run benchmark` on the release commit for machine-specific latency confirmation.

### Known limits

- Quarter-turn orientation is intentionally rejected for rotationally symmetric UML/electrical nodes where it would have no semantic effect.
- Standards options implement documented visual subsets; this package does not claim IEEE, IEC, OpenQASM, or OMG certification.
- Text sizing remains deterministic and SSR-safe rather than font-engine exact. Hosts using materially different fonts should preserve the supplied SVG typography or allocate additional label space.

## [0.2.1]

- Last 0.2.x release. Historical documentation remains at [the official 0.2.1 route](https://schemd.johnowolabiidogun.dev/docs/0.2.1/overview).
