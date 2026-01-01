<svelte:head>
	<title>Politica de privacidad</title>
</svelte:head>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<main class="mx-auto max-w-3xl px-4 py-10">
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-8">
			<a
				href="/login"
				class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline"
			>
				Volver al ingreso
			</a>
			<h1 class="mt-2 text-2xl font-semibold">Politica de privacidad</h1>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
				Ultima actualizacion: 2025-12-31
			</p>

			<section class="mt-6 space-y-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
				<p>
					Esta politica describe como se recopila, usa y protege la informacion dentro de la app
					"Base de datos odontologia holistica". Si no estas de acuerdo, no uses el servicio.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Datos que recopilamos</h2>
				<ul class="mt-2 list-disc space-y-2 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
					<li>Datos de cuenta: email y credenciales de acceso gestionadas por Supabase.</li>
					<li>Datos de pacientes cargados por el usuario (nombre, DNI, telefono, etc.).</li>
					<li>Historial clinico y notas registradas por el usuario.</li>
					<li>
						Metadatos de radiografias (nombre de archivo, fecha, tipo, tamano, id de archivo).
						Las radiografias se almacenan en Google Drive del usuario.
					</li>
					<li>Datos tecnicos minimos para el funcionamiento (cookies de sesion y preferencias de tema).</li>
				</ul>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Como usamos los datos</h2>
				<ul class="mt-2 list-disc space-y-2 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
					<li>Proveer el servicio de gestion de pacientes y consultas.</li>
					<li>Asociar radiografias a pacientes y mostrar el visor de Drive.</li>
					<li>Mejorar estabilidad y soporte tecnico.</li>
				</ul>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Google Drive</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					La app solicita permisos para crear y guardar archivos en tu Google Drive usando el
					alcance <span class="font-semibold">drive.file</span>. No accede a tu Drive completo.
					Podes revocar el acceso en cualquier momento desde tu cuenta de Google.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Proveedores y almacenamiento</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Los datos de la app se almacenan en Supabase. Los archivos de radiografias se almacenan
					en Google Drive del usuario. El hosting puede operar en terceros (por ejemplo, Vercel).
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Seguridad</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Aplicamos medidas razonables de seguridad (control de acceso, RLS en la base de datos y
					transmision segura). Aun asi, ningun sistema es 100% infalible.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Retencion y eliminacion</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Los datos se conservan mientras la cuenta este activa. Al eliminar registros desde la
					app, se elimina la referencia en la base de datos. Los archivos en Google Drive son
					controlados por el usuario y no se eliminan automaticamente.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Responsabilidad del usuario</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					El usuario es responsable de contar con el consentimiento y base legal necesarios para
					cargar datos de pacientes. La app es una herramienta de gestion y no reemplaza el
					cumplimiento normativo aplicable.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Contacto</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Para consultas sobre privacidad escribi a:
					<span class="font-semibold">juanpabloaltamira@protonmail.com</span>
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Cambios</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Podemos actualizar esta politica. Publicaremos cualquier cambio en esta misma pagina.
				</p>
			</section>
		</div>
	</main>
</div>
