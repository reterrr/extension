import { build, context } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watching = process.argv.includes("--watch");

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "browser",
  target: "firefox140",
  format: "iife",
  outdir: dist,
  entryNames: "[name]",
  logLevel: "info",
};

const configs = [
  {
    ...common,
    entryPoints: {
      background: "src/background/index.ts",
      content: "src/content/index.ts",
      "pdf-reader": "src/pdf-reader/bootstrap.ts",
    },
  },
  {
    ...common,
    jsx: "automatic",
    entryPoints: {
      sidepanel: "src/sidepanel/main.tsx",
      popup: "src/popup/main.tsx",
      options: "src/options/main.tsx",
    },
  },
  {
    ...common,
    entryPoints: {
      core: "src/shared/domain/core.js",
      picker: "src/content/picker.ts",
      "selector-highlights": "src/content/selector-highlights.ts",
    },
  },
];

async function writeStaticFiles() {
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, "public"), dist, { recursive: true });
  await cp(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  await cp(
    resolve(root, "src/sidepanel/styles.css"),
    resolve(dist, "sidepanel.css"),
  );
  await cp(
    resolve(root, "src/pdf-reader/styles.css"),
    resolve(dist, "pdf-reader.css"),
  );
  await cp(resolve(root, "src/shared/ui.css"), resolve(dist, "ui.css"));
  await cp(
    resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
    resolve(dist, "pdf.worker.mjs"),
  );

  const pages = {
    sidepanel: ["Burbot workspace", "sidepanel.css"],
    popup: ["Burbot", "ui.css"],
    options: ["Burbot options", "ui.css"],
    "pdf-reader": ["Burbot PDF Reader", "pdf-reader.css"],
  };

  for (const [name, [title, stylesheet]] of Object.entries(pages)) {
    await writeFile(
      resolve(dist, `${name}.html`),
      `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width,initial-scale=1" />\n  <title>${title}</title>\n  <link rel="stylesheet" href="${stylesheet}" />\n</head>\n<body>\n  <div id="root"></div>\n  <script defer src="${name}.js"></script>\n</body>\n</html>\n`,
      "utf8",
    );
  }
}

await rm(dist, { recursive: true, force: true });
await writeStaticFiles();

if (watching) {
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching extension sources. Static files are copied at startup.");
} else {
  await Promise.all(configs.map((config) => build(config)));
}
