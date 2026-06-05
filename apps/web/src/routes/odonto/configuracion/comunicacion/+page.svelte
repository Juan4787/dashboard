<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';

	let { data, form } = $props<{
		data: {
			demo: boolean;
			context: any;
			account: any;
			lastEvent: any;
			bookingPath: string;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const canManage = $derived(Boolean(data.context?.capabilities?.canConfigureCommunication));
	const replyEnabled = $derived(Boolean(data.account?.bot_enabled && data.account?.status === 'active'));
	const siteUrl = $derived(typeof window === 'undefined' ? '' : window.location.origin);
	const bookingUrl = $derived(`${siteUrl}${data.bookingPath}`);
	let copied = $state(false);

	const copyBookingUrl = async () => {
		if (!bookingUrl) return;
		await navigator.clipboard.writeText(bookingUrl);
		copied = true;
		window.setTimeout(() => (copied = false), 1800);
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración</p>
		<div class="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Comunicación</h1>
				<p class="ux-subtitle">Configurá la respuesta automática que recibe el paciente.</p>
			</div>
			<span class={replyEnabled ? 'ux-badge ux-badge-success' : 'ux-badge'}>
				{replyEnabled ? 'Activa' : 'Inactiva'}
			</span>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<div class="ux-card">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
			<div class="max-w-2xl">
				<h2 class="ux-section-title">Respuesta automática por WhatsApp</h2>
				<p class="mt-2 text-sm text-white/55">
					Cuando alguien escribe por WhatsApp, recibe el enlace para reservar turno.
				</p>
			</div>
		</div>

		<form method="POST" action="?/save_reply" class="mt-6 grid gap-5">
			<input type="hidden" name="account_id" value={data.account?.id ?? ''} />
			<div class="grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label">Estado</span>
					<select name="reply_enabled" class="ux-select" disabled={!canManage || data.demo}>
						<option value="true" selected={replyEnabled}>Activa</option>
						<option value="false" selected={!replyEnabled}>Inactiva</option>
					</select>
				</label>
				<label>
					<span class="ux-label">Nombre visible (opcional)</span>
					<input
						name="display_name"
						class="ux-input"
						value={data.account?.display_name ?? data.context?.business?.name ?? ''}
						disabled={!canManage || data.demo}
					/>
				</label>
				<label class="md:col-span-2">
					<span class="ux-label">Teléfono de WhatsApp (opcional)</span>
					<input
						name="phone_number"
						class="ux-input"
						value={data.account?.phone_number ?? ''}
						placeholder="+54 9 ..."
						disabled={!canManage || data.demo}
					/>
				</label>
			</div>
			<button class="ux-btn-primary w-full sm:w-fit" disabled={!canManage || data.demo}>Guardar comunicación</button>
		</form>
	</div>

	<div class="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
		<div class="ux-card">
			<h2 class="ux-section-title">Link de reserva</h2>
			<p class="mt-2 text-sm text-white/55">Tus pacientes reservan desde este enlace.</p>
			<div class="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
				<p class="min-w-0 flex-1 break-all text-sm font-bold text-white">{bookingUrl || data.bookingPath}</p>
				<div class="flex gap-2">
					<button type="button" class="ux-btn-secondary" onclick={copyBookingUrl}>
						{copied ? 'Copiado' : 'Copiar'}
					</button>
					<a href={data.bookingPath} target="_blank" rel="noreferrer" class="ux-btn-secondary">Abrir</a>
				</div>
			</div>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Mensaje que recibirá</h2>
			<div class="mt-5 rounded-3xl border border-white/10 bg-[#0b1626] p-5">
				<p class="text-sm leading-6 text-white/82">
					Hola. Podés reservar tu turno desde este link:
				</p>
				<p class="mt-3 break-all text-sm font-bold text-[#c4b5fd]">{bookingUrl || data.bookingPath}</p>
			</div>
			{#if data.lastEvent}
				<p class="mt-4 text-xs font-bold text-white/45">
					Última actividad: {new Date(data.lastEvent.received_at).toLocaleString('es-AR')}
				</p>
			{/if}
		</div>
	</div>
</section>
