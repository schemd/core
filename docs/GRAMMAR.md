# Grammar and options

The parser accepts one declaration or connection per non-empty line. Input is capped before parsing; component, connection, row, pin, crossing, and SVG-output limits are also enforced.

```text
kind:ID "label" at (x, y) color [key=value flag]
SOURCE.port -> TARGET.port color [route relation signal options]
```

IDs are document-unique. Double quotes currently cannot appear inside labels or quoted option values; backslashes are preserved for the micro-math label grammar. Delimiter escaping remains a tracked language limitation. Colors are built-in tokens (`amber`, `blue`, `cyan`, `purple`, `slate`, `emerald`), validated CSS color literals, or safe host aliases; arbitrary markup and CSS injection are rejected.

Declaration options are family-specific. The shared vocabulary is `type`, `orientation`, `inputs`, `outputs`, `width`, `standard`, `left`, `right`, `top`, `bottom`, `attributes`, `operations`, `stereotype`, `details`, `height`, `parameter`, `phase`, `matrix`, `operator`, `control`, `controls`, `targets`, and `wires`. Unknown, duplicate, malformed, or incompatible options are errors—not ignored metadata.

Connection routes are `line`, `bezier`, and `ortho`. Signal domains are `electrical`, `digital`, `quantum`, and `classical`. Other options include `width`, `net`, `label`, `marker-start`, `marker-end`, `dashed`, and one relation from the UML list. A signal domain can be written as a flag or `signal=...`, but never both.

`net=NAME` gives signal segments one explicit topology identity. Names begin with an ASCII letter, contain only letters, digits, `_`, or `-`, and are at most 64 characters. Segments sharing an exact `component.port` join implicitly, so every branch declared through the same `junction.node` inherits one net. A name may also join geometrically disconnected segments. Every segment in one net must use the same signal domain and width; conflicting names at a shared terminal are errors. UML relations cannot declare nets. Unnamed signal topologies receive deterministic source-ordered `$1`, `$2`, … identities in the AST, source map, and full-mode SVG.

Markers are `none`, `arrow`, `open-arrow`, `dot`, `triangle`, `diamond`, and `diamond-filled`. Relations are `association`, `dependency`, `generalization`, `realization`, `aggregation`, `composition`, `message`, `synchronous`, `asynchronous`, `return`, `control-flow`, `object-flow`, `assembly`, `delegation`, `transition`, `include`, and `extend`.

Counts are bounded integers. `inputs` and `outputs` are 1–32 where configurable. Scalar/bus `width` is 1–256, with bus/register families requiring at least 2. Family defaults and ports are listed in [COMPONENTS.md](./COMPONENTS.md).

## Geometry contract

Physical component bodies may touch at an edge but cannot overlap. UML packages, components, nodes, devices, systems, partitions, fragments, interactions, and regions may intentionally contain children; lifelines may contain activations, executions, and destruction nodes.

All route families are collision checked. Straight and cubic paths cannot penetrate unrelated component bodies, orthogonal paths route around them, and transformed endpoint-marker footprints participate in the same rule. Separate nets may cross only as a strict perpendicular orthogonal crossing, which receives a bridge on the later trace. Collinear overlap, endpoint contact, diagonal or cubic crossing, and bridge clusters too dense to render are errors. Same-net contacts do not receive bridges.
