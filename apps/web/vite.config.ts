import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	envDir: '../..',
	plugins: [sveltekit()],
	test: {
		exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**', 'build/**']
	}
});
