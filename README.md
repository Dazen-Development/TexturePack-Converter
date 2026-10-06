# Dazen Texture Pack Converter

A browser-based Minecraft resource-pack converter for **Java Edition ↔ Bedrock Edition**, built for GitHub Pages by **Dazen Development**.

Current architecture pair:

- Java Edition: **26.2.x**
- Bedrock Edition: **1.26.50** (reference archive `ResourcePack_v26.50.0`)

## What this first release does

- Java `.zip` input.
- Bedrock `.mcpack` or `.zip` input.
- Drag-and-drop or file picker.
- Local read/upload progress bar.
- Automatic architecture scan before conversion.
- Detects a single wrapper folder in ZIP archives.
- Java → Bedrock and Bedrock → Java direction selector.
- Version selectors prepared for future version pairs.
- In-browser conversion with JSZip; packs are **not uploaded to a server**.
- Version-specific texture path rename table generated from the supplied vanilla reference packs.
- Generates `manifest.json` for Bedrock output and `pack.mcmeta` for Java output.
- Converts `pack.png` ↔ `pack_icon.png`.
- Process console and conversion report.
- Download Bedrock output as `.mcpack` and Java output as `.zip`.

## Scope / limitations

This release is intentionally **texture-focused**. It handles classic PNG texture paths where a safe mapping or same-path conversion is available.

The following may require manual work or a later converter module:

- Java models, blockstates and atlases
- Bedrock entity/model/render-controller JSON
- OptiFine / CIT / CEM
- Shaders
- Font systems
- Java `.png.mcmeta` animation → Bedrock flipbook conversion
- Bedrock TGA → Java PNG conversion
- Complex edition-specific GUI layouts
- Custom 3D models and non-vanilla namespaces

The converter reports skipped files instead of silently claiming they were converted.

## GitHub Pages

This is a static site. No server runtime is required.

1. Push these files to the repository default branch.
2. Open **Settings → Pages** in GitHub.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the default branch (usually `main`) and `/ (root)`.
5. Save.

GitHub Pages will then serve `index.html`.

## Local development

Because the app uses ES modules, run it from a small local HTTP server instead of opening `index.html` directly.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Credits

- Organization: [Dazen Development](https://github.com/Dazen-Development)
- Developer: [Reynier Apurillo (@Dazeeen / Kenzooo)](https://github.com/Dazeeen)

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
