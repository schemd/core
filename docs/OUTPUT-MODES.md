# SVG output modes

All modes use the same parser, geometry, routes, component ordering, and viewBox.

| Mode | Payload | Intended use |
| --- | --- | --- |
| `default` | Compact accessible static SVG | Immutable documents and exports |
| `embedded-css` | Static SVG plus isolated built-in theme/state CSS | Themed responsive documents |
| `full` | CSS plus selected node, port, wire, source-line, and topology datasets | Editors, probes, simulations, source mapping |

`semanticHooks` is valid with `full` and accepts any subset of `nodes`, `ports`, and `wires`. Full mode exposes interaction targets without scripts; hosts should use delegated listeners on the root SVG. Interactive port controls are not nested inside an SVG `img` role.

With wire hooks enabled, every signal wire exposes its parser-resolved topology as `data-net-id`; named nets retain their author name and unnamed nets use deterministic `$N` IDs. The compilation source map exposes the same value as `SchematicWireSource.netId`. Relation-only UML connectors omit it.

Definitions and hashes are diagram-local. Only used families emit definitions, repeated compatible shapes use `<symbol>`/`<use>`, XML and colors are sanitized, and no mode emits `foreignObject`, external resources, fonts, raster data, or executable content.

Supply a unique `idPrefix` whenever multiple SVGs may share one HTML document. The prefix is validated and does not affect component source IDs.
