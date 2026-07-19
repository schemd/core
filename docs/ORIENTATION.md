# Orientation and geometry

Direction-sensitive components accept `orientation=right|down|left|up`; `right` is the canonical default. Logical port names do not change. A resistor's `in` port is still `in` after rotation even when it physically faces downward or left.

The compiler stores one canonical shape and maps it with exact integer quarter turns:

```text
right: ( x,  y)    down: (-y,  x)
left:  (-x, -y)    up:   ( y, -x)
```

The same transform is applied to vector geometry, port coordinates, outward port normals, body extents, obstacle AABBs, and wire endpoints. Width/height extents swap on odd turns. Text is positioned from rotated extents but remains upright; labels are never counter-rotated glyph by glyph.

Omitting orientation produces the legacy right-facing bytes. Four clockwise turns are the identity, inverse turns recover exact local points, normalized coordinates never emit negative zero, and the router sees the rotated AABB rather than the unrotated body.

Rotationally symmetric nodes such as `junction` reject the option. This prevents meaningless syntax from entering the AST and avoids promising orientation semantics where no directional ports exist.
