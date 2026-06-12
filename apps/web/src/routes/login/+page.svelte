<script lang="ts">
	let { form } = $props();
	let showPassword = $state(false);
	let mode = $state<'login' | 'register'>('login');
	const formEmail = $derived(form?.email ?? '');
	let email = $state('');
	let password = $state('');
	let acceptedTerms = $state(false);

	$effect(() => {
		if (formEmail) {
			email = formEmail;
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] px-4 py-10">
	<div class="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur sm:p-8">
		<div class="mb-7 flex flex-col items-center text-center">
			<picture>
				<img src="/logo-cita-suite.png" alt="Cita Suite" class="h-16 w-16 rounded-2xl shadow-lg" width="64" height="64" decoding="async" />
			</picture>
			<h1 class="mt-4 text-2xl font-bold text-white">Cita Suite</h1>
			<p class="mt-1 text-sm text-white/55">
				{mode === 'register' ? 'Creá tu cuenta para empezar.' : 'Ingresá a tu consultorio.'}
			</p>
		</div>

		<div class="mb-6 flex justify-center">
			<div class="ux-pill-nav text-xs font-bold text-white/65">
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${mode === 'login' ? 'bg-[#7c3aed] text-white' : 'hover:text-white'}`}
					onclick={() => (mode = 'login')}
				>
					Ingresar
				</button>
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${mode === 'register' ? 'bg-[#7c3aed] text-white' : 'hover:text-white'}`}
					onclick={() => (mode = 'register')}
				>
					Crear cuenta
				</button>
			</div>
		</div>

		<form method="post" action={mode === 'register' ? '?/register' : '?/login'} class="space-y-5">
			<label class="block">
				<span class="ux-label">Correo electrónico</span>
				<input
					id="email"
					name="email"
					type="email"
					class="ux-input"
					placeholder="tu@correo.com"
					required
					bind:value={email}
					autocomplete="email"
				/>
			</label>

			<label class="block">
				<span class="ux-label">Contraseña</span>
				<div class="relative">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						class="ux-input pr-16"
						placeholder={mode === 'register' ? 'Creá una contraseña segura' : 'Ingresá tu contraseña'}
						required
						bind:value={password}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10"
						onclick={() => (showPassword = !showPassword)}
					>
						{showPassword ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</label>

			{#if form?.message}
				<p class="ux-alert flex items-center gap-2">
					<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
					</svg>
					{form.message}
				</p>
			{/if}

			{#if mode === 'register'}
				<label class="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left text-sm leading-5 text-white/70">
					<input
						name="accepted_terms"
						type="checkbox"
						value="true"
						required
						bind:checked={acceptedTerms}
						class="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 text-[#7c3aed] focus:ring-[#8b5cf6]"
					/>
					<span>
						Leí y acepto los
						<a href="/terminos" class="font-bold text-[#c4b5fd] hover:underline" target="_blank" rel="noreferrer">Términos y condiciones</a>
						y la
						<a href="/privacidad" class="font-bold text-[#c4b5fd] hover:underline" target="_blank" rel="noreferrer">Política de privacidad</a>.
					</span>
				</label>
			{/if}

			<button type="submit" class="ux-btn-primary w-full text-base">
				{mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
			</button>

			{#if mode === 'login'}
				<div class="text-center text-sm text-white/55">
					<a href="/reset" class="font-semibold text-[#c4b5fd] hover:underline">¿Olvidaste tu contraseña?</a>
				</div>
			{:else}
				<div class="text-center text-sm text-white/55">
					<button type="button" class="font-semibold text-[#c4b5fd] hover:underline" onclick={() => (mode = 'login')}>
						¿Ya tenés cuenta? Ingresá
					</button>
				</div>
			{/if}
		</form>
	</div>
</div>
