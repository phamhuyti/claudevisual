const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

async function main() {
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
