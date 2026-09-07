# Editable PowerPoint export

This exporter uses the rendered DOM, an intermediate representation, and PowerPoint objects. The image-based `--format pptx` exporter stays separate.

## Tests

Build the workspace packages before testing the distributed browser walker:

```sh
pnpm --filter @slidev/types --filter @slidev/parser --filter @slidev/cli run build
pnpm exec vitest run packages/slidev/node/commands/pptx
```

Set `SLIDEV_TEST_CHROMIUM` to a Chromium executable to include the browser tests. These tests check native SVG annotation geometry and screenshot isolation with real browser layout.

Use the generic fixture for a complete CLI test:

```sh
node packages/slidev/bin/slidev.mjs export packages/slidev/node/commands/pptx/fixtures/native.md --format pptx-editable --pptx-strict --with-clicks --output /tmp/native-clicks.pptx
```

The file must have three slides. Each slide must contain a native gradient and a custom path. It must not contain picture objects or image backgrounds. With `--with-clicks false`, it must have one slide with all three text states. Speaker notes must remain present.

## Remaining native support

Strict mode is a fallback policy, not a guarantee of complete CSS or SVG support. Keep these follow-up items open:

- Add radial and layered gradients. Test background positioning, border offsets, alpha, and clipping.
- Add SVG arc commands, rounded rectangles, text, paint servers, and references. Preserve masks and stroke effects or report them as unsupported.
- Add scaled and rotated HTML containers. Apply the same transform to text metrics, borders, and geometry.
- Add CSS filters and pseudo-elements that currently require a picture or cannot be placed.
- Check rendered output in Microsoft PowerPoint. XML tests and LibreOffice rendering do not prove identical output there.

For each item, add a generic browser fixture and inspect the generated XML. Compare the browser image with a rendered PowerPoint file. Do not add private client decks or assets to this repository.
