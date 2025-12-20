<section class="space-y-4">
	<header class="flex items-center justify-between">
		<div>
			<p class="text-sm uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Configuración</p>
			<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Preferencias del módulo</h1>
		</div>
	</header>

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- Campos personalizados -->
		<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Campos personalizados</p>
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Ficha del paciente</h2>
					<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
						Los campos se gestionan en Supabase (tabla <code>patients</code>, columna <code>custom_fields</code>). Agregá solo los que uses a diario.
					</p>
				</div>
				<a
					class="rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#0f1f36]"
					href="https://supabase.com/dashboard"
					target="_blank"
					rel="noreferrer"
				>
					Abrir Supabase
				</a>
			</div>
			<div class="mt-4 space-y-2">
				<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Ejemplos recomendados</p>
				<ul class="space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
					<li>• Obra social (texto)</li>
					<li>• Alergias (texto)</li>
					<li>• Medicación (texto)</li>
					<li>• Antecedentes (texto)</li>
					<li>• Campo libre “Notas rápidas” (texto)</li>
				</ul>
			</div>
		</div>

	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- Cuenta -->
		<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
			<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Cuenta</p>
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Seguridad y acceso</h2>
			<ul class="mt-3 space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
				<li>• Cambiá tu contraseña desde Supabase Auth.</li>
				<li>• Para soporte, escribí a soporte@clinic Sabrina.</li>
			</ul>
			<a
				class="mt-3 inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#0f1f36]"
				href="/logout"
			>
				Cerrar sesión
			</a>
		</div>

		<!-- Ayuda -->
		<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
			<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Ayuda rápida</p>
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Guía express</h2>
			<ul class="mt-3 space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
				<li>• Alta rápida: solo nombre/DNI/tel, el resto después.</li>
				<li>• Historial: 1 tap en “+” para nueva entrada.</li>
				<li>• Archivados: se pueden recuperar desde la pestaña “Archivados”.</li>
			</ul>
		</div>
	</div>
</section>
