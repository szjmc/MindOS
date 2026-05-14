import esbuild from "esbuild";

const isProd = process.argv.includes("--prod");

if (isProd) {
  await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: false,
    treeShaking: true,
    outfile: "main.js"
  });
} else {
  const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: "inline",
    treeShaking: true,
    outfile: "main.js"
  });

  await ctx.watch();
  console.log("Watching for changes...");
}