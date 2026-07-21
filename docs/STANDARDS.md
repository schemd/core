# Standards and conventions

`@schemd/core` implements compact, documented visual subsets. It does not claim certification or complete conformance.

- Classical gates default to `standard=ieee`, using familiar ANSI/IEEE contours. `standard=iec` selects the rectangular IEC-style presentation. One gate never mixes both conventions.
- Electrical primitives follow common IEEE/ANSI or IEC schematic practice where the conventions agree; variant names make polarity and device family explicit. The current DSL does not expose a diagram-wide electrical-standard switch.
- Quantum nodes follow common OpenQASM-style circuit notation: wires, boxed unitary gates, solid/open controls, swap crosses, measurement, and distinct classical result channels.
- UML nodes and relation endpoints follow established OMG UML visual conventions for the implemented structural, behavioral, interaction, and state-machine subset.

Marker geometry is diagram-local and scales with the connection stroke contract. Open arrow, triangle, and diamond interiors use `fill="none"`; a zero-width carrier positions each marker while the visible path is trimmed beneath it, so arbitrary host backgrounds remain visible without trace bleed.
