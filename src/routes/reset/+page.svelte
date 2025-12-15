<script lang="ts">
	let { form } = $props();
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur dark:border-[#1f3554] dark:bg-[#0f1f36]/90">
		<div class="mb-6 text-center space-y-3">
			<h1 class="text-3xl font-semibold text-white">Recuperar contraseña</h1>
			<p class="text-sm text-neutral-200">Ingresá tu email y te enviaremos un enlace para restablecer tu clave.</p>
		</div>

		{#if form?.success}
			<div class="space-y-4">
				<p class="flex items-center gap-2 rounded-xl bg-green-500/15 px-4 py-3 text-sm font-semibold text-green-100">
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
					</svg>
					Si el email corresponde a un usuario, enviamos un enlace de recuperación.
				</p>
				<a
					href="/login"
					class="inline-flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				>
					Volver a ingresar
				</a>
			</div>
		{:else}
			<form method="post" class="space-y-6">
				<div class="space-y-3">
					<label for="email" class="text-sm font-medium text-white">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder="Introduce tu email"
						required
						value={form?.email ?? ''}
						autocomplete="email"
					/>
				</div>

				{#if form?.message}
					<p class="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
						</svg>
						{form.message}
					</p>
				{/if}

				<button
					type="submit"
					class="flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				>
					Enviar enlace
				</button>

				<div class="text-center text-sm text-neutral-300">
					<a href="/login" class="hover:underline">Volver al login</a>
				</div>
			</form>
		{/if}
	</div>
</div>
