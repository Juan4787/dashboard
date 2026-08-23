import netlifyAdapter from '@sveltejs/adapter-netlify';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const isProd = process.env.NODE_ENV === 'production';
// Vercel expone esta variable durante sus builds. En cualquier otro entorno
// conservamos el adaptador de Netlify para que los dos hosts sigan siendo válidos.
const adapter = process.env.VERCEL === '1' ? vercelAdapter() : netlifyAdapter();

const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		env: {
			dir: '../..'
		},
		adapter,
		csp: isProd
			? {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self', 'https://accounts.google.com'],
						'style-src': ['self', 'https://fonts.googleapis.com'],
						'style-src-elem': ['self', 'https://fonts.googleapis.com'],
						'style-src-attr': ['unsafe-inline'],
						'font-src': ['self', 'https://fonts.gstatic.com'],
						'img-src': ['self', 'data:', 'blob:', 'https://*.supabase.co'],
						'connect-src': [
							'self',
							'https://accounts.google.com',
							'https://fonts.googleapis.com',
							'https://fonts.gstatic.com',
							'https://oauth2.googleapis.com',
							'https://www.googleapis.com',
							'https://*.supabase.co',
							'wss://*.supabase.co'
						],
						'frame-src': ['https://accounts.google.com'],
						'base-uri': ['self'],
						// Mercado Pago: el action de suscripción responde al POST del
						// form con un 303 al checkout de MP; los navegadores aplican
						// form-action a toda la cadena de redirects del envío.
						'form-action': [
							'self',
							'https://*.mercadopago.com.ar',
							'https://*.mercadopago.com'
						]
					}
			  }
			: undefined
	}
};

export default config;
