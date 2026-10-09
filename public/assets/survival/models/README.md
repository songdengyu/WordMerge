# WordMerge low-poly building models

Generated from this project's blueprints; these are not extracted from Gossip.

Regenerate from the repository root:

```powershell
node scripts/export-building-models.mjs
```

Nine OBJ files share `materials.mtl`. Coordinates use tile units, Z up, local origin, rotation 0. Groups retain part / segment IDs. Floors, thick walls, closed doors and roof wedges contain actual XYZ vertices and polygon faces. Shared internal faces are removed. Import the OBJ with the material library beside it in Blender or another modeling tool.

The runtime generates the same geometry from the actual building state, excluding broken or unbuilt segments, then projects it into Pixi's fixed isometric view. Doors regenerate around their hinge during opening / closing. OBJ files are inspectable authoring artifacts, not an additional runtime download.

Exports contain geometry and flat material colors. Window details, existing cabin surface textures, furniture sprites and hinge animation remain scene presentation and are not embedded in these OBJ files.
