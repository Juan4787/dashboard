<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	let { data, form } = $props<{
		data: {
			appointment: any;
			message: string;
			created: boolean;
			suggestedAction: string;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const appointment = $derived(data.appointment);
</script>

<main class="min-h-screen bg-[#06111f] px-4 py-6 text-white sm:py-10">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
		<section class="ux-hero">
			{#if appointment?.business?.logo_url}
				<img src={appointment.business.logo_url} alt={appointment.business.name} class="mb-5 h-16 w-16 rounded-2xl object-cover" />
			{/if}
			<p class="ux-badge">{data.created ? 'Reserva creada' : 'Turno'}</p>
			<h1 class="ux-title mt-4">{data.created ? 'Turno reservado' : 'Tu turno'}</h1>
			<p class="ux-subtitle">{data.message}</p>
			{#if form?.message}
				<p class={form.success ? 'ux-alert ux-alert-success mt-5' : 'ux-alert mt-5'}>{form.message}</p>
			{/if}
		</section>

		{#if appointment}
			<section class="ux-card">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 class="text-2xl font-bold text-white">{appointment.business.name}</h2>
						<p class="mt-1 text-sm text-white/55">{appointment.public_status_label}</p>
					</div>
					<span class="ux-badge">{appointment.public_status_label}</span>
				</div>

				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">Servicio</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.service_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">Profesional</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.professional_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5 sm:col-span-2">
						<p class="text-sm font-bold text-white/55">Fecha y hora</p>
						<p class="mt-2 text-lg font-bold text-white">{formatDateTime(appointment.starts_at)}</p>
					</div>
				</div>

				{#if appointment.business.cancellation_policy}
					<p class="ux-empty mt-5">{appointment.business.cancellation_policy}</p>
				{/if}
			</section>

			<section class="ux-card">
				<h2 class="ux-section-title">Acciones</h2>
				<div class="mt-5 grid gap-3">
					<form method="POST" action="?/confirm">
						<button disabled={!appointment.can_confirm} class="ux-btn-primary w-full">Confirmo que voy</button>
					</form>
					<details class="rounded-2xl border border-white/10 bg-white/[0.035]">
						<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-white">Necesito reprogramar</summary>
						<form method="POST" action="?/request_reschedule" class="border-t border-white/10 p-5">
							<label>
								<span class="ux-label">Comentario opcional</span>
								<textarea name="note" rows="2" disabled={!appointment.can_request_reschedule} class="ux-textarea"></textarea>
							</label>
							<button disabled={!appointment.can_request_reschedule} class="ux-btn-secondary mt-4 w-full">
								Enviar pedido
							</button>
						</form>
					</details>
					<details class="rounded-2xl border border-red-400/20 bg-red-500/10">
						<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-red-100">Cancelar turno</summary>
						<form method="POST" action="?/cancel" class="border-t border-red-400/20 p-5">
							<label>
								<span class="ux-label">Motivo opcional</span>
								<textarea name="note" rows="2" disabled={!appointment.can_cancel} class="ux-textarea"></textarea>
							</label>
							<label class="mt-4 flex items-start gap-3 text-sm font-bold text-red-100">
								<input type="checkbox" name="confirm_cancel" value="true" required disabled={!appointment.can_cancel} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
								<span>Confirmo que quiero cancelar este turno.</span>
							</label>
							<button disabled={!appointment.can_cancel} class="ux-btn-danger mt-4 w-full">Cancelar turno</button>
						</form>
					</details>
				</div>
				{#if !appointment.can_confirm && !appointment.can_cancel && !appointment.can_request_reschedule}
					<p class="ux-empty mt-5">Este enlace ya no admite acciones online.</p>
				{/if}
			</section>
		{:else}
			<section class="ux-card">No encontramos un turno asociado a este enlace.</section>
		{/if}
	</div>
</main>
