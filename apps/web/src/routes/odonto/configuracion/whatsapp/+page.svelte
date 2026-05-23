<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';

	const DEFAULT_REMINDER_TEMPLATE_BODY = `Hola {{1}}, te recordamos tu turno en {{2}} el {{3}} a las {{4}}.

Podés confirmar, cancelar o pedir reprogramación acá:
{{5}}`;

	let { data, form } = $props<{
		data: {
			demo: boolean;
			context: any;
			account: any;
			template: any;
			lastEvent: any;
			webhookUrl: string;
			hasJobSecret: boolean;
			hasVerifyToken: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const canManage = $derived(Boolean(data.context?.canManage));
	const siteUrl = $derived(typeof window === 'undefined' ? '' : window.location.origin);
	const webhookUrl = $derived(`${siteUrl}${data.webhookUrl}`);

	const statusLabel: Record<string, string> = {
		pending: 'Pendiente',
		active: 'Activo',
		paused: 'Pausado',
		error: 'Con error',
		draft: 'Borrador',
		approved: 'Aprobado',
		rejected: 'Rechazado'
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">WhatsApp</p>
		<h1 class="ux-title mt-4">Mensajes automáticos</h1>
		<p class="ux-subtitle">Conexión oficial, respuesta automática y recordatorios de turnos.</p>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<div class="grid gap-4 lg:grid-cols-3">
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Cuenta</p>
			<p class="mt-2 text-2xl font-bold text-white">{statusLabel[data.account?.status] ?? 'Sin conectar'}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Template</p>
			<p class="mt-2 text-2xl font-bold text-white">{statusLabel[data.template?.status] ?? 'Sin cargar'}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Último evento</p>
			<p class="mt-2 text-2xl font-bold text-white">{data.lastEvent ? 'Recibido' : 'Sin eventos'}</p>
		</div>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="ux-section-title">Prueba interna</h2>
				<p class="mt-2 text-sm text-white/55">Activa una cuenta simulada para probar recordatorios sin Meta.</p>
			</div>
			<form method="post" action="?/create_mock_setup">
				<button class="ux-btn-primary" disabled={!canManage || data.demo}>Activar prueba</button>
			</form>
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<form method="post" action="?/save_account" class="ux-card space-y-4">
			<input type="hidden" name="id" value={data.account?.id ?? ''} />
			<h2 class="ux-section-title">Cuenta de WhatsApp</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<label>
					<span class="ux-label">Proveedor</span>
					<select name="provider" class="ux-select" disabled={!canManage}>
						<option value="mock" selected={(data.account?.provider ?? 'mock') === 'mock'}>Prueba interna</option>
						<option value="meta_cloud" selected={data.account?.provider === 'meta_cloud'}>Meta Cloud API</option>
						<option value="bsp" selected={data.account?.provider === 'bsp'}>Proveedor externo</option>
					</select>
				</label>
				<label>
					<span class="ux-label">Estado</span>
					<select name="status" class="ux-select" disabled={!canManage}>
						<option value="pending" selected={(data.account?.status ?? 'pending') === 'pending'}>Pendiente</option>
						<option value="active" selected={data.account?.status === 'active'}>Activo</option>
						<option value="paused" selected={data.account?.status === 'paused'}>Pausado</option>
						<option value="error" selected={data.account?.status === 'error'}>Con error</option>
					</select>
				</label>
				<label>
					<span class="ux-label">Número visible (opcional)</span>
					<input name="phone_number" class="ux-input" value={data.account?.phone_number ?? ''} disabled={!canManage} />
				</label>
				<label>
					<span class="ux-label">Identificador del número (opcional)</span>
					<input name="phone_number_id" class="ux-input" value={data.account?.phone_number_id ?? ''} disabled={!canManage} />
				</label>
				<label>
					<span class="ux-label">Cuenta comercial (opcional)</span>
					<input name="waba_id" class="ux-input" value={data.account?.waba_id ?? ''} disabled={!canManage} />
				</label>
				<label>
					<span class="ux-label">Nombre visible (opcional)</span>
					<input name="display_name" class="ux-input" value={data.account?.display_name ?? ''} disabled={!canManage} />
				</label>
				<label class="sm:col-span-2">
					<span class="ux-label">Nombre del secreto del token (opcional)</span>
					<input name="access_token_secret_name" class="ux-input" value={data.account?.access_token_secret_name ?? ''} placeholder="WHATSAPP_ACCESS_TOKEN" disabled={!canManage} />
				</label>
			</div>
			<div class="flex flex-wrap gap-3">
				<label class="ux-soft-card flex items-center gap-3 px-4 py-3">
					<input type="checkbox" name="bot_enabled" value="true" checked={data.account?.bot_enabled ?? true} disabled={!canManage} class="accent-[#7c3aed]" />
					<span class="text-sm font-bold text-white">Responder consultas</span>
				</label>
				<label class="ux-soft-card flex items-center gap-3 px-4 py-3">
					<input type="checkbox" name="reminders_enabled" value="true" checked={data.account?.reminders_enabled ?? true} disabled={!canManage} class="accent-[#7c3aed]" />
					<span class="text-sm font-bold text-white">Enviar recordatorios</span>
				</label>
			</div>
			<button class="ux-btn-primary w-full" disabled={!canManage || data.demo}>Guardar cuenta</button>
		</form>

		<form method="post" action="?/save_template" class="ux-card space-y-4">
			<input type="hidden" name="id" value={data.template?.id ?? ''} />
			<input type="hidden" name="provider" value={data.account?.provider ?? 'mock'} />
			<h2 class="ux-section-title">Template de recordatorio</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<label>
					<span class="ux-label">Idioma</span>
					<input name="language" class="ux-input" value={data.template?.language ?? 'es_AR'} disabled={!canManage} />
				</label>
				<label>
					<span class="ux-label">Estado</span>
					<select name="status" class="ux-select" disabled={!canManage}>
						<option value="draft" selected={(data.template?.status ?? 'draft') === 'draft'}>Borrador</option>
						<option value="pending" selected={data.template?.status === 'pending'}>Pendiente</option>
						<option value="approved" selected={data.template?.status === 'approved'}>Aprobado</option>
						<option value="rejected" selected={data.template?.status === 'rejected'}>Rechazado</option>
						<option value="paused" selected={data.template?.status === 'paused'}>Pausado</option>
					</select>
				</label>
				<label class="sm:col-span-2">
					<span class="ux-label">Identificador externo (opcional)</span>
					<input name="provider_template_id" class="ux-input" value={data.template?.provider_template_id ?? ''} disabled={!canManage} />
				</label>
				<label class="sm:col-span-2">
					<span class="ux-label">Mensaje</span>
					<textarea name="body" rows="7" class="ux-textarea" disabled={!canManage}>{data.template?.body ?? DEFAULT_REMINDER_TEMPLATE_BODY}</textarea>
				</label>
				<label class="sm:col-span-2">
					<span class="ux-label">Motivo de rechazo (opcional)</span>
					<input name="rejection_reason" class="ux-input" value={data.template?.rejection_reason ?? ''} disabled={!canManage} />
				</label>
			</div>
			<button class="ux-btn-primary w-full" disabled={!canManage || data.demo}>Guardar template</button>
		</form>
	</div>

	<div class="ux-card">
		<h2 class="ux-section-title">Estado técnico</h2>
		<div class="mt-4 grid gap-3 md:grid-cols-3">
			<div class="ux-soft-card p-4">
				<p class="text-sm text-white/55">Webhook</p>
				<p class="mt-2 break-all text-sm font-bold text-white">{webhookUrl || data.webhookUrl}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm text-white/55">Verificación</p>
				<p class="mt-2 text-sm font-bold text-white">{data.hasVerifyToken ? 'Configurada' : 'Falta token'}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm text-white/55">Jobs</p>
				<p class="mt-2 text-sm font-bold text-white">{data.hasJobSecret ? 'Protegidos' : 'Falta secreto'}</p>
			</div>
		</div>
	</div>
</section>
