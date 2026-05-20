import { rmSync, cpSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const run = (command, args) => {
	const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

run('pnpm', ['--filter', 'web', 'build']);

if (!existsSync('apps/web/.netlify')) {
	console.error('Expected apps/web/.netlify to exist after the SvelteKit Netlify build.');
	process.exit(1);
}

rmSync('.netlify', { recursive: true, force: true });
cpSync('apps/web/.netlify', '.netlify', { recursive: true });
