import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const isProd = process.env.NODE_ENV === 'production';

const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		csp: isProd
			? {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self', 'https://accounts.google.com'],
						'style-src': ['self', 'https://fonts.googleapis.com'],
						'font-src': ['self', 'https://fonts.gstatic.com'],
						'img-src': ['self', 'data:', 'blob:'],
						'connect-src': [
							'self',
							'https://accounts.google.com',
							'https://fonts.googleapis.com',
							'https://fonts.gstatic.com',
							'https://oauth2.googleapis.com',
							'https://www.googleapis.com',
							'https://*.supabase.co'
						],
						'frame-src': ['https://drive.google.com', 'https://accounts.google.com'],
						'base-uri': ['self'],
						'form-action': ['self']
					}
			  }
			: undefined
	}
};

export default config;
