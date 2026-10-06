# Dazen Texture Pack Converter

A browser-based Minecraft resource-pack converter for **Java Edition ↔ Bedrock Edition**, built as a static web app by **Dazen Development**.

Current architecture pair:

- Java Edition: **26.2.x**
- Bedrock Edition: **1.26.50**

## Current flow

The converter now uses **one source-pack input only**.

- **Java → Bedrock**: upload a Java `.zip`.
- **Bedrock → Java**: upload a Bedrock `.mcpack` or `.zip`.

Changing the conversion direction automatically changes the accepted file type, architecture labels, validation rules, and target format.

## Features

- One direction-aware source input.
- Drag-and-drop or file picker.
- Local file-read progress bar.
- Automatic architecture scan before conversion.
- Java validation using `pack.mcmeta` and `assets/minecraft/`.
- Bedrock validation using `manifest.json` and `textures/`.
- Detects a single wrapper folder inside ZIP archives.
- Version-specific texture path mappings derived from the supplied vanilla reference packs.
- Java `pack.png` ↔ Bedrock `pack_icon.png`.
- Generates Bedrock `manifest.json` and Java `pack.mcmeta`.
- Process console with warnings and skipped-file reporting.
- Dedicated **Conversion Output** section after processing.
- Manual **Download Pack** button instead of forcing an immediate download.
- **View Conversion** results page with visual source → output comparison.
- Results categorized into:
  - Blocks
  - Items
  - Mobs / Entities
  - Fonts / font images
  - GUI
  - Environment
  - Other images
- Searchable comparison viewer with source path, output path, and conversion status.
- Unsupported PNG textures can appear as **Skipped** instead of being presented as successfully converted.
- Conversion preview and output are stored locally in the browser using IndexedDB so the separate preview page can open without uploading the resource pack.
- Up to 600 PNG entries are retained for visual preview to protect browser performance. This does **not** limit how many compatible files are included in the converted archive.
- Optional conversion report inside the output archive.

## Privacy

Conversion is performed in the browser.

The app does not send the user's pack to Dazen Development or to a conversion server. GitHub Pages or another static host only serves the HTML, CSS and JavaScript application files.

The visual result viewer uses the browser's local IndexedDB storage. Recent conversion previews may be removed automatically as newer jobs replace them or if the browser clears site data.

## Scope / limitations

This release remains intentionally **texture-focused**. It handles classic PNG texture paths where a safe mapping or same-path conversion is available.

The following may still require manual work or future converter modules:

- Java models, blockstates and atlases
- Bedrock entity/model/render-controller JSON
- OptiFine / CIT / CEM
- Shaders
- Complete font-system conversion
- Java `.png.mcmeta` animation → Bedrock flipbook conversion
- Bedrock TGA → Java PNG conversion
- Complex edition-specific GUI layouts
- Custom 3D models and non-vanilla namespaces

The converter reports unsupported files instead of silently claiming that everything was converted.

## Static hosting

No server runtime is required.

For GitHub Pages, the repository must meet the Pages visibility requirements of the GitHub plan being used. The site can also be hosted on another static host.

## Local development

Because the app uses ES modules, run it from a local HTTP server instead of double-clicking `index.html`.

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
