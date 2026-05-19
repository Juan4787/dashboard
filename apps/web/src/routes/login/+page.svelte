<script lang="ts">
	let { form } = $props();
	let showPassword = $state(false);
	let mode = $state<'login' | 'register'>('login');
	const formEmail = $derived(form?.email ?? '');
	let email = $state('');
	let password = $state('');

	$effect(() => {
		if (formEmail) {
			email = formEmail;
		}
	});
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur dark:border-[#1f3554] dark:bg-[#0f1f36]/90">
		<div class="mb-8 text-center space-y-2">
			<h1 class="text-3xl font-semibold text-white">Acceso a la App</h1>
		</div>

		<div class="mb-6 flex items-center justify-center">
			<div class="flex rounded-full border border-white/10 bg-white/10 p-1 text-xs font-semibold text-white/70">
				<button
					type="button"
					class={`rounded-full px-4 py-2 transition ${mode === 'login' ? 'bg-[#7c3aed] text-white shadow-sm' : 'hover:text-white'}`}
					onclick={() => (mode = 'login')}
				>
					Ingresar
				</button>
				<button
					type="button"
					class={`rounded-full px-4 py-2 transition ${mode === 'register' ? 'bg-[#7c3aed] text-white shadow-sm' : 'hover:text-white'}`}
					onclick={() => (mode = 'register')}
				>
					Crear cuenta
				</button>
			</div>
		</div>

		<form method="post" action={mode === 'register' ? '?/register' : '?/login'} class="space-y-6">
			<div class="space-y-3">
				<label for="email" class="text-sm font-medium text-white">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
					placeholder="Introduce tu email"
					required
					bind:value={email}
					autocomplete="email"
				/>
			</div>

			<div class="space-y-3">
				<label for="password" class="text-sm font-medium text-white">Contraseña</label>
				<div class="relative">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 pr-16 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder={mode === 'register' ? 'Creá una contraseña segura' : 'Introduce tu contraseña'}
						required
						bind:value={password}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:bg-white/10"
						onclick={() => (showPassword = !showPassword)}
					>
						{showPassword ? 'Ocultar' : 'Ver'}
					</button>
				</div>
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
				{mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
			</button>

			{#if mode === 'login'}
				<div class="text-right text-sm text-neutral-200">
					<a href="/reset" class="font-semibold hover:underline">¿Olvidaste tu contraseña?</a>
				</div>
			{:else}
				<div class="text-right text-sm text-neutral-200">
					<button type="button" class="font-semibold hover:underline" onclick={() => (mode = 'login')}>
						¿Ya tenés cuenta? Ingresá
					</button>
				</div>
			{/if}
		</form>
	</div>
</div>
