# Dazen Texture Pack Converter

A browser-based Minecraft resource-pack converter for **Java Edition ↔ Bedrock Edition**, built by **Dazen Development**.

The converter is designed around real pack structures instead of treating every resource pack as vanilla-only. It supports standard Java/Bedrock packs plus source/resource layouts used by **ItemsAdder**, **Nexo**, and **Oraxen**.

## Current architecture pair

- Java Edition: **26.2.x**
- Bedrock Edition: **1.26.50**

The version selector/UI is structured so more mapping profiles can be added later.

## Conversion flow

There is only **one source input**.

- **Java → Bedrock**: upload a Java `.zip`.
- **Bedrock → Java**: upload a Bedrock `.mcpack` or `.zip`.

Changing the direction changes the accepted file type, architecture scan, mapping rules, and target output.

## Java source formats

The scanner accepts:

1. Normal generated Java resource packs:
   - `pack.mcmeta`
   - `assets/<namespace>/...`

2. ItemsAdder source/vendor bundles:
   - `contents/<namespace>/configs/*.yml`
   - `contents/<namespace>/resourcepack/assets/...`
   - direct `contents/<namespace>/textures/...` layouts used by font-image packs
   - alternate `data/items_packs/<namespace>/*.yml` + `data/resource_pack/assets/...` architecture
   - simple root `configs/ + textures/` vendor layouts

3. Nexo source/vendor bundles:
   - `Nexo/items/*.yml`
   - `Nexo/glyphs/*.yml`
   - `Nexo/pack/assets/...`

4. Oraxen source/vendor bundles:
   - `Oraxen/items/*.yml`
   - `Oraxen/glyphs/*.yml`
   - `Oraxen/pack/assets/...`
   - Oraxen shortcut layouts such as `Oraxen/pack/models/...` and `Oraxen/pack/textures/...`

When one vendor archive contains ItemsAdder, Nexo, and Oraxen as alternative distributions of the same content, the converter chooses one primary source variant rather than triple-converting the same items.

## Custom item conversion

### Java → Bedrock

The custom-item module understands both legacy and modern Java item systems.

It scans:

- Pre-1.21.4 model overrides using `custom_model_data`
- Modern `assets/<namespace>/items/*.json` definitions
- `range_dispatch`
- `condition`
- `select`
- namespaced forms such as `minecraft:model`, `minecraft:condition`, and `minecraft:range_dispatch`
- ItemsAdder item metadata
- Nexo item metadata
- Oraxen item metadata

For compatible items it generates:

- Bedrock item PNGs under `textures/items/dazen/`
- `textures/item_texture.json`
- Geyser custom-item mappings in `dazen/geyser_custom_mappings.json`
- `dazen/GEYSER_SETUP.txt`
- unresolved-item report when server-side IDs cannot be inferred safely

The UI also exposes a separate **Geyser Mappings** download button when valid mappings were generated.

### Geyser mapping modes

The converter emits Geyser custom mapping format v2:

- `type: "legacy"` for known CustomModelData values
- `type: "definition"` for known modern ItemModel identifiers

The converter never invents CustomModelData values, plugin-generated item IDs, or predicates when they are absent from the source.

### 3D Java item models

3D Java models are detected.

This browser build currently uses the resolved item/icon texture as a Bedrock icon/held fallback and reports the item as a **3D fallback**. Exact held-model conversion is intentionally not claimed yet because a faithful Bedrock representation requires geometry/attachables/animations and, in some cases, a separately rendered inventory icon.

## Bedrock → Java custom items

The converter parses `textures/item_texture.json` and:

- creates `assets/dazen/textures/item/*.png`
- creates Java generated item models
- creates modern Java item definitions
- restores embedded Dazen/Geyser CMD or ItemModel mappings when available
- reconstructs legacy CMD `range_dispatch` files when enough mapping metadata exists

It also generates integration helpers for all three supported Java content plugins:

### ItemsAdder

The converter generates both known source layouts:

```text
integrations/ItemsAdder/
├── contents/dazen_converted/
│   ├── configs/
│   └── resourcepack/assets/dazen/
└── data/
    ├── items_packs/dazen_converted/
    └── resource_pack/assets/dazen/
```

The `data/` layout matches vendor packs that keep YAML in `data/items_packs/<namespace>/` and resource files under `data/resource_pack/assets/`.

### Nexo

```text
integrations/Nexo/
├── items/
├── glyphs/
└── pack/assets/dazen/
```

### Oraxen

```text
integrations/Oraxen/
├── items/
├── glyphs/
└── pack/
    ├── assets/dazen/
    └── textures/dazen/
```

These are generated helper structures and should still be tested against the exact plugin/server version in use.

## Font images / glyph conversion

### Bedrock glyph addressing

Bedrock glyph pages use a direct hexadecimal mapping:

- Unicode `U+E800` → `font/glyph_E8.png` → cell `00`
- Unicode `U+E801` → `font/glyph_E8.png` → cell `01`
- Unicode `U+E80F` → `font/glyph_E8.png` → cell `0F`
- Unicode `U+E810` → `font/glyph_E8.png` → cell `10`
- Unicode `U+E8FF` → `font/glyph_E8.png` → cell `FF`

In other words, for `U+PPSS`:

- `PP` chooses `glyph_PP.png`
- `SS` is the hexadecimal slot inside the 16×16 page
- the first slot digit is the row and the second is the column

The viewer renders the full 16×16 page with `00`–`FF` labels so placement can be audited visually.

The converter chooses the glyph-cell pixel size per page from the largest Java glyph, using a power-of-two cell size. It preserves the original glyph pixels instead of scaling them when they already fit. A page with an 80px-wide rank image therefore uses a 128px cell and a 2048×2048 atlas, matching common production packs.

### Character diagnostics

Every mapped glyph result shows:

- the actual private-use character
- Unicode code point such as `U+E800`
- Bedrock page such as `glyph_E8.png`
- slot such as `00`
- a **Copy** button for the actual character

If a rank/font/emoji PNG exists but is not referenced by the Java font JSON (or a plugin source config omits its generated Unicode), the converter does not guess silently. It suggests a free private-use character, shows the resulting Bedrock page/slot, and provides copyable examples for:

- Java `assets/<namespace>/font/*.json`
- ItemsAdder `font_images` with explicit `symbol`
- Nexo glyph YAML with explicit `char`
- Oraxen glyph YAML with explicit `char`

Suggestions are also written to `dazen/font-character-suggestions.json`.

### Java → Bedrock

The converter reads Java bitmap font providers from `assets/<namespace>/font/*.json`.

Private-use glyphs in the supported Bedrock custom-glyph range are placed into Bedrock glyph atlas pages. For automatically suggested characters, the converter prefers unused code points from `E8xx` through `F8xx`, then `E2xx` through `E7xx`, avoiding characters already present in the scanned Java pack:

```text
font/glyph_E0.png
font/glyph_E1.png
...
font/glyph_F8.png
```

Each atlas uses the Bedrock 16×16 glyph grid.

ItemsAdder/Nexo/Oraxen source glyph configs are also inspected. If an explicit Unicode character is present, it can be mapped. If the plugin normally auto-assigns the character and the source YAML does not contain it, the entry is reported as unresolved instead of guessing a codepoint.

### Bedrock → Java

Bedrock `font/glyph_E0.png`–`glyph_F8.png` pages are scanned for non-transparent cells.

The converter:

- extracts non-empty glyph cells
- crops each cell to its visible alpha bounds instead of exporting the entire square slot
- preserves the Unicode/page/slot relationship
- generates Java bitmap textures
- generates `assets/minecraft/font/default.json`
- generates ItemsAdder font-image helper configs
- generates Nexo glyph helper configs
- generates Oraxen glyph helper configs

## Visual comparison and correction editor

After conversion, the **Conversion Output** panel contains:

- Download Pack
- Geyser Mappings (when available)
- View / Edit Conversion
- custom-item count
- converted font-glyph count
- mapped/compatible/skipped counts

The comparison viewer categorizes output into:

- Blocks
- Items
- Mobs / Entities
- Fonts
- GUI
- Environment
- Other Images

Editable rows open a dedicated mapping editor. Font results also include a non-editable **full glyph page** preview with a `00`–`FF` grid overlay, so you can verify that every Java character landed in the intended Bedrock slot.

### Four-corner editor

The editor lets the user:

- drag the texture to move it
- drag any of four corner points to resize it
- optionally lock aspect ratio
- edit X / Y / Width / Height numerically
- center or reset the image
- save the correction

Saving is not cosmetic. The browser reopens the generated ZIP/MCPACK, replaces the actual target PNG (or the relevant Bedrock glyph atlas cell), regenerates the output archive, and saves the updated conversion job locally.

The next download therefore contains the corrected image.

## Privacy

All conversion is performed in the browser.

The app does not upload the user's pack to a Dazen server. The static host only serves the HTML/CSS/JavaScript application.

Conversion previews and edited output archives are stored locally using IndexedDB so the separate preview/editor pages can access them.

## Important limitations

The converter intentionally reports uncertain mappings instead of silently fabricating them.

Current limitations include:

- full Java 3D model → Bedrock attachable/geometry conversion
- arbitrary multi-texture/animated Blockbench item models
- complete Java `.png.mcmeta` animation → Bedrock flipbook conversion
- Bedrock TGA → Java PNG conversion
- shaders
- OptiFine/CIT/CEM
- complex edition-specific GUI layouts
- plugin-assigned CMD/item IDs that are generated at runtime and absent from source files
- ItemsAdder/Nexo/Oraxen glyph codepoints that are auto-assigned and absent from source configs

For the most reliable plugin conversion, use the **generated Java resource pack** when available because it contains the final ItemModel/CMD/font mappings produced by the plugin.

## Local development

Because the app uses ES modules, serve it over HTTP:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Credits

- Organization: [Dazen Development](https://github.com/Dazen-Development)
- Developer: [Reynier Apurillo (@Dazeeen / Kenzooo)](https://github.com/Dazeeen)

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
