# Grammar and options

The parser accepts one declaration or connection per non-empty line. Input is capped before parsing; component, connection, row, pin, crossing, and SVG-output limits are also enforced.

```text
kind:ID "label" at (x, y) color [key=value flag]
SOURCE.port -> TARGET.port color [route relation signal options]
```

IDs are document-unique. Labels and quoted option values use backslash escaping. Colors are built-in tokens (`amber`, `blue`, `cyan`, `purple`, `slate`, `emerald`), validated CSS color literals, or safe host aliases; arbitrary markup and CSS injection are rejected.

Declaration options are family-specific. The shared vocabulary is `type`, `orientation`, `inputs`, `outputs`, `width`, `standard`, `left`, `right`, `top`, `bottom`, `attributes`, `operations`, `stereotype`, `details`, `height`, `parameter`, `phase`, `matrix`, `operator`, `control`, `controls`, `targets`, and `wires`. Unknown, duplicate, malformed, or incompatible options are errors—not ignored metadata.

Connection routes are `line`, `bezier`, and `ortho`. Signal domains are `electrical`, `digital`, `quantum`, and `classical`. Other options include `width`, `label`, `marker-start`, `marker-end`, `dashed`, and one relation from the UML list. A signal domain can be written as a flag or `signal=...`, but never both.

Markers are `none`, `arrow`, `open-arrow`, `dot`, `triangle`, `diamond`, and `diamond-filled`. Relations are `association`, `dependency`, `generalization`, `realization`, `aggregation`, `composition`, `message`, `synchronous`, `asynchronous`, `return`, `control-flow`, `object-flow`, `assembly`, `delegation`, `transition`, `include`, and `extend`.

Counts are bounded integers. `inputs` and `outputs` are 1–32 where configurable. Scalar/bus `width` is 1–256, with bus/register families requiring at least 2. Family defaults and ports are listed in [COMPONENTS.md](./COMPONENTS.md).
