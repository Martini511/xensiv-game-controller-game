# Assets

Platzhalter-Ordner fuer spaetere 3D-Modelle (GLTF/GLB), Texturen und Sounds.

Dateien hier werden von Vite als statische Imports behandelt:

```js
import modelUrl from "../assets/models/platine.glb?url";
```

Struktur-Vorschlag:

- `models/` – GLTF/GLB-Dateien (z. B. die Platine)
- `textures/` – Texturen
- `audio/` – Sounds
