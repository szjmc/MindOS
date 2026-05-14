import esbuild from 'esbuild';
import process from 'node:process';

const isProd = process.argv.includes('--prod');

const opts = {
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

if (isProd) {
  esbuild.build(opts).catch(() => process.exit(1));
} else {
  esbuild.context(opts).then((ctx) => {
    ctx.watch();
    console.log('Watching...');
  }).catch(() => process.exit(1));
}