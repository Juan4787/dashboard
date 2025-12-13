<script lang="ts">
	let { form } = $props();
</script>

<div class="min-h-screen bg-gradient-to-br from-neutral-25 via-white to-primary-50 flex items-center justify-center px-4 dark:from-[#0b1626] dark:via-[#0f1f36] dark:to-[#0c1b2f]">
	<div class="grid w-full max-w-5xl grid-cols-1 gap-6 overflow-hidden rounded-3xl bg-white shadow-card sm:grid-cols-2 dark:bg-[#122641] dark:border dark:border-[#1f3554]">
		<div class="relative hidden bg-[radial-gradient(circle_at_top_left,_#1f7bff_0,_#0b60e6_35%,_#0d346e_100%)] px-10 py-12 text-white sm:flex sm:flex-col sm:justify-between">
			<div class="space-y-4">
				<p class="rounded-full bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80">
					App mínima, dos módulos
				</p>
				<h1 class="text-3xl font-semibold leading-tight">
					Sabrina (Odontología) y Marido (Administrativo) en un solo acceso.
				</h1>
				<p class="text-sm text-white/80">Entrás, elegimos tu módulo y listo.</p>
			</div>
			<div class="space-y-2 text-sm text-white/80">
				<p>Reglas clave:</p>
				<ul class="list-disc space-y-1 pl-4">
					<li>Separación total de datos.</li>
					<li>Búsqueda siempre arriba.</li>
					<li>Altas rápidas en 1 click.</li>
				</ul>
			</div>
		</div>

		<div class="flex flex-col justify-center px-8 py-10 sm:px-10">
			<div class="mb-8 space-y-2">
				<p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">Acceso</p>
				<h2 class="text-2xl font-semibold text-neutral-900 dark:text-white">Ingresá con tu usuario</h2>
				<p class="text-sm text-neutral-600 dark:text-neutral-300">Email + contraseña de Supabase. Te llevamos directo a tu módulo.</p>
			</div>
			<form method="post" class="space-y-5">
				<div class="space-y-2">
					<label for="email" class="text-sm font-medium text-neutral-800">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-900 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white"
						placeholder="tuemail@ejemplo.com"
						required
						value={form?.email ?? ''}
						autocomplete="email"
					/>
				</div>

				<div class="space-y-2">
					<label for="password" class="text-sm font-medium text-neutral-800">Contraseña</label>
					<input
						id="password"
						name="password"
						type="password"
						class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-900 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white"
						placeholder="••••••••"
						required
						autocomplete="current-password"
					/>
				</div>

				{#if form?.message}
					<p class="text-sm font-medium text-red-600">{form.message}</p>
				{/if}

				<button
					type="submit"
					class="flex w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-3 text-white transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
				>
					Ingresar
				</button>
			</form>

			<div class="mt-6 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200">
				<p class="font-semibold text-neutral-800 dark:text-white">Tip rápido</p>
				<p>Solo dos usuarios: Sabrina (Odontología) y el Administrador (ANSES). Si el email no coincide, el acceso falla.</p>
			</div>
		</div>
	</div>
</div>
