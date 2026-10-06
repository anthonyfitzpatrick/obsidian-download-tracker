import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const banner = `/* Generated bundle. Source: https://github.com/anthonyfitzpatrick/obsidian-download-tracker */`;

const prod = process.argv[2] === 'production';

// The install path is personal, so it lives in an untracked file rather than in the repo.
const DIR_FILE = '.dev-plugin-dir';
const installDir = existsSync(DIR_FILE) ? readFileSync(DIR_FILE, 'utf8').trim() : '';
if (!prod && !installDir) console.warn(`No ${DIR_FILE} file, so builds are not copied into a vault.`);

const copyToVault = {
	name: 'copy-to-vault',
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(file, join(installDir, file));
			console.log(`Copied to ${installDir}`);
		});
	},
};

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
	],
	format: 'cjs',
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
	plugins: !prod && installDir ? [copyToVault] : [],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
