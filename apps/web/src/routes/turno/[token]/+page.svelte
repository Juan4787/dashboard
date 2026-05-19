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

<main class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-white">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
		<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
			{#if appointment?.business?.logo_url}
				<img src={appointment.business.logo_url} alt={appointment.business.name} class="mb-4 h-14 w-14 rounded-xl object-cover" />
			{/if}
			<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">
				{data.created ? 'Turno reservado' : 'Tu turno'}
			</h1>
			<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">{data.message}</p>
			{#if form?.message}
				<p class={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800 dark:bg-green-500/15 dark:text-green-100' : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-100'}`}>
					{form.message}
				</p>
			{/if}
		</section>

		{#if appointment}
			<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">{appointment.business.name}</h2>
				<dl class="mt-4 grid gap-4 text-sm">
					<div class="rounded-xl bg-neutral-50 p-4 dark:bg-[#0f1f36]">
						<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Servicio</dt>
						<dd class="mt-1 font-semibold">{appointment.service_name_snapshot}</dd>
					</div>
					<div class="rounded-xl bg-neutral-50 p-4 dark:bg-[#0f1f36]">
						<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Profesional</dt>
						<dd class="mt-1 font-semibold">{appointment.professional_name_snapshot}</dd>
					</div>
					<div class="rounded-xl bg-neutral-50 p-4 dark:bg-[#0f1f36]">
						<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Fecha y hora</dt>
						<dd class="mt-1 font-semibold">{formatDateTime(appointment.starts_at)}</dd>
					</div>
					<div class="rounded-xl bg-neutral-50 p-4 dark:bg-[#0f1f36]">
						<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Estado</dt>
						<dd class="mt-1 font-semibold">{appointment.public_status_label}</dd>
					</div>
				</dl>
				{#if appointment.business.cancellation_policy}
					<p class="mt-4 rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						{appointment.business.cancellation_policy}
					</p>
				{/if}
			</section>

			<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Acciones</h2>
				<div class="mt-4 grid gap-3">
					<form method="POST" action="?/confirm">
						<button disabled={!appointment.can_confirm} class={`w-full rounded-xl px-5 py-3 text-sm font-semibold text-white ${appointment.can_confirm ? 'bg-[#7c3aed] hover:bg-[#6d28d9]' : 'bg-neutral-400 opacity-60'}`}>
							Confirmo que voy
						</button>
					</form>
					<form method="POST" action="?/request_reschedule" class="rounded-xl border border-neutral-200 p-4 dark:border-[#1f3554]">
						<label class="space-y-1">
							<span class="text-sm font-semibold">Comentario opcional para reprogramar</span>
							<textarea name="note" rows="2" disabled={!appointment.can_request_reschedule} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]"></textarea>
						</label>
						<button disabled={!appointment.can_request_reschedule} class={`mt-3 w-full rounded-xl px-5 py-3 text-sm font-semibold ${appointment.can_request_reschedule ? 'border border-neutral-300 text-neutral-800 hover:bg-neutral-50 dark:border-[#1f3554] dark:text-white dark:hover:bg-[#0f1f36]' : 'border border-neutral-200 text-neutral-400 opacity-60'}`}>
							Necesito reprogramar
						</button>
					</form>
					<form method="POST" action="?/cancel" class="rounded-xl border border-red-100 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
						<label class="space-y-1">
							<span class="text-sm font-semibold text-red-900 dark:text-red-100">Motivo opcional de cancelación</span>
							<textarea name="note" rows="2" disabled={!appointment.can_cancel} class="w-full rounded-xl border border-red-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-red-500/30 dark:bg-[#0f1f36]"></textarea>
						</label>
						<label class="mt-3 flex items-start gap-3 text-sm font-semibold text-red-900 dark:text-red-100">
							<input type="checkbox" name="confirm_cancel" value="true" required disabled={!appointment.can_cancel} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
							<span>Confirmo que quiero cancelar este turno.</span>
						</label>
						<button disabled={!appointment.can_cancel} class={`mt-3 w-full rounded-xl px-5 py-3 text-sm font-semibold text-white ${appointment.can_cancel ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300 opacity-60'}`}>
							Cancelar turno
						</button>
					</form>
				</div>
				{#if !appointment.can_confirm && !appointment.can_cancel && !appointment.can_request_reschedule}
					<p class="mt-4 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						Este enlace ya no admite acciones online.
					</p>
				{/if}
			</section>
		{:else}
			<section class="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
				No encontramos un turno asociado a este enlace.
			</section>
		{/if}
	</div>
</main>
