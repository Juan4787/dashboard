import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const run = (command, args, env = process.env) => {
	const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

// Vercel ejecuta el build desde la raíz del monorepo. El adaptador genera su
// Build Output API dentro de apps/web, por lo que se publica en la ubicación
// que Vercel espera sin mover la raíz ni perder las dependencias workspace.
run('pnpm', ['--filter', 'web', 'build'], { ...process.env, VERCEL: '1' });

const source = 'apps/web/.vercel/output';
const destination = '.vercel/output';

if (!existsSync(source)) {
	console.error('Expected apps/web/.vercel/output after the SvelteKit Vercel build.');
	process.exit(1);
}

// No borrar .vercel completo: puede contener el enlace local creado por la CLI.
rmSync(destination, { recursive: true, force: true });
mkdirSync('.vercel', { recursive: true });
cpSync(source, destination, { recursive: true });
