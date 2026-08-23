import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const run = (command, args, env = process.env) => {
	const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

// El proyecto de Vercel tiene apps/web como Root Directory. Volvemos a la raíz
// del monorepo para instalar y compilar sus dependencias workspace, mientras el
// adaptador escribe el Build Output API donde Vercel lo espera: apps/web/.vercel.
run('pnpm', ['--filter', 'web', 'build'], { ...process.env, VERCEL: '1' });

const output = 'apps/web/.vercel/output';

if (!existsSync(output)) {
	console.error('Expected apps/web/.vercel/output after the SvelteKit Vercel build.');
	process.exit(1);
}
