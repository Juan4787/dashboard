<script lang="ts">
	import FollowUpActions from './FollowUpActions.svelte';

	type Item = { id: string; patient_id: string; patient_name: string; message: string | null };
	type Notice = { count: number; single: Item | null };

	let { notice, todayISO } = $props<{ notice: Notice; todayISO: string }>();

	const singleLine = $derived(
		notice.single
			? `${notice.single.patient_name}: ${notice.single.message?.trim() || 'control pendiente'}`
			: ''
	);
</script>

{#if notice.count > 0}
	<div class="mx-auto mb-6 w-full max-w-2xl rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 shadow-lg shadow-amber-950/10">
		{#if notice.count === 1 && notice.single}
			<p class="text-[11px] font-black uppercase tracking-wide text-amber-200/90">Tenés un recordatorio importante</p>
			<p class="mt-1 line-clamp-2 text-base font-bold text-white">{singleLine}</p>
			<div class="mt-3">
				<FollowUpActions item={notice.single} {todayISO} />
			</div>
		{:else}
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p class="text-lg font-black text-white">
					Tenés {notice.count} recordatorios importantes
				</p>
				<a href="/odonto/seguimientos/importantes" class="ux-btn-primary shrink-0 text-center">VER</a>
			</div>
		{/if}
	</div>
{/if}
