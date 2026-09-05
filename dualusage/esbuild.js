const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

function copySidebarCss() {
  const src = path.join(__dirname, "src", "ui", "sidebar", "sidebar.css");
  const destDir = path.join(__dirname, "dist");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, "sidebar.css"));
}

async function main() {
  copySidebarCss();

  const extension = await esbuild.context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    format: "cjs",
  });

  const sidebar = await esbuild.context({
    bundle: true,
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    logLevel: "info",
    entryPoints: ["src/ui/sidebar/webview-main.ts"],
    outfile: "dist/sidebar-main.js",
    format: "iife",
  });

  if (watch) {
    fs.watchFile(path.join(__dirname, "src", "ui", "sidebar", "sidebar.css"), () => {
      try {
        copySidebarCss();
        console.log("copied sidebar.css");
      } catch (err) {
        console.error(err);
      }
    });
    await Promise.all([extension.watch(), sidebar.watch()]);
    console.log("watching…");
  } else {
    await Promise.all([extension.rebuild(), sidebar.rebuild()]);
    await Promise.all([extension.dispose(), sidebar.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
