import esbuild from 'esbuild';
import process from 'node:process';

const isProd = process.argv.includes('--prod');

const jsOpts = {
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  treeShaking: true,
  outfile: 'main.js',
  sourcemap: !isProd,
};

const cssOpts = {
  entryPoints: ['styles/index.css'],
  bundle: true,
  outfile: 'styles.css',
  loader: {
    '.css': 'css',
  },
};

async function build() {
  try {
    await esbuild.build(jsOpts);
    await esbuild.build(cssOpts);
    console.log('Build complete!');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

async function watch() {
  const [jsCtx, cssCtx] = await Promise.all([
    esbuild.context(jsOpts),
    esbuild.context(cssOpts),
  ]);

  await Promise.all([jsCtx.watch(), cssCtx.watch()]);
  console.log('Watching...');
}

if (isProd) {
  build();
} else {
  watch();
}