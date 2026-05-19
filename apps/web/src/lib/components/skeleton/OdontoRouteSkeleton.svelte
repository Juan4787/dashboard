<script lang="ts">
	import SkeletonBlock from '$lib/components/skeleton/SkeletonBlock.svelte';

	type SkeletonKind = 'patients' | 'patientDetail' | 'config' | 'master';

	let { kind = 'patients' } = $props<{ kind?: SkeletonKind }>();

	const patientRows = Array.from({ length: 6 }, (_, i) => i);
	const timelineRows = Array.from({ length: 4 }, (_, i) => i);
	const emailRows = Array.from({ length: 5 }, (_, i) => i);
</script>

<div class="flex flex-col gap-6" role="status" aria-live="polite">
	<span class="sr-only">Cargando contenido</span>

	{#if kind === 'patients'}
		<section class="flex flex-col gap-4">
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div class="space-y-2">
					<SkeletonBlock class="h-8 w-44" rounded="md" />
					<SkeletonBlock class="h-4 w-72 max-w-[80vw]" rounded="md" />
				</div>
				<SkeletonBlock class="h-11 w-36" rounded="full" />
			</div>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
				<SkeletonBlock class="h-12 w-full" rounded="lg" />
				<div class="hidden md:flex items-center gap-3">
					<SkeletonBlock class="h-4 w-20" rounded="md" />
					<SkeletonBlock class="h-4 w-24" rounded="md" />
				</div>
			</div>

			<div class="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
				<div class="hidden md:grid grid-cols-[2fr_1.4fr_1fr_1fr] gap-4 border-b border-neutral-200 bg-neutral-100 p-4 dark:border-white/10 dark:bg-white/5">
					<SkeletonBlock class="h-4 w-32" rounded="md" />
					<SkeletonBlock class="h-4 w-28" rounded="md" />
					<SkeletonBlock class="h-4 w-24" rounded="md" />
					<SkeletonBlock class="ml-auto h-4 w-20" rounded="md" />
				</div>
				<div class="p-4 md:p-0">
					{#each patientRows as row}
						<div class="grid grid-cols-1 gap-4 border-b border-neutral-100 py-4 md:grid-cols-[2fr_1.4fr_1fr_1fr] md:px-6 md:py-5 dark:border-white/10">
							<div class="flex items-center gap-3">
								<SkeletonBlock class="h-10 w-10 shrink-0" rounded="full" />
								<div class="space-y-2">
									<SkeletonBlock class="h-4 w-40 max-w-[45vw]" rounded="md" />
									<SkeletonBlock class="h-3 w-24" rounded="md" />
								</div>
							</div>
							<SkeletonBlock class="h-4 w-36 md:mt-3" rounded="md" />
							<SkeletonBlock class="h-4 w-24 md:mt-3" rounded="md" />
							<div class="md:ml-auto">
								<SkeletonBlock class="h-9 w-28" rounded="full" />
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{:else if kind === 'patientDetail'}
		<section class="flex flex-col gap-6">
			<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-2">
						<SkeletonBlock class="h-9 w-64 max-w-[70vw]" rounded="md" />
						<SkeletonBlock class="h-4 w-40" rounded="md" />
					</div>
					<SkeletonBlock class="h-10 w-10 shrink-0" rounded="full" />
				</div>
				<div class="mt-4 flex flex-wrap gap-2">
					<SkeletonBlock class="h-10 w-24" rounded="full" />
					<SkeletonBlock class="h-10 w-24" rounded="full" />
					<SkeletonBlock class="h-10 w-24" rounded="full" />
					<SkeletonBlock class="h-10 w-28" rounded="full" />
				</div>
				<div class="mt-4 flex flex-wrap gap-2">
					<SkeletonBlock class="h-9 w-44" rounded="full" />
					<SkeletonBlock class="h-9 w-40" rounded="full" />
				</div>
			</div>

			<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
				<div class="mb-4 flex flex-col gap-3 sm:flex-row">
					<SkeletonBlock class="h-11 w-full" rounded="full" />
					<SkeletonBlock class="h-11 w-full" rounded="full" />
				</div>
				<div class="space-y-3">
					{#each timelineRows as row}
						<div class="rounded-xl border border-neutral-100 p-4 dark:border-[#1f3554]">
							<div class="flex items-center gap-2">
								<SkeletonBlock class="h-7 w-24" rounded="full" />
								<SkeletonBlock class="h-5 w-48 max-w-[50vw]" rounded="md" />
								<SkeletonBlock class="ml-auto h-8 w-16" rounded="full" />
							</div>
							<SkeletonBlock class="mt-3 h-4 w-52 max-w-[60vw]" rounded="md" />
							<SkeletonBlock class="mt-2 h-4 w-36 max-w-[45vw]" rounded="md" />
						</div>
					{/each}
				</div>
			</div>
		</section>
	{:else if kind === 'config'}
		<section class="flex flex-col gap-6">
			<div class="rounded-2xl border border-neutral-100 bg-white/90 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<SkeletonBlock class="h-4 w-36" rounded="md" />
				<SkeletonBlock class="mt-3 h-8 w-48" rounded="md" />
				<SkeletonBlock class="mt-3 h-4 w-80 max-w-[80vw]" rounded="md" />
			</div>
			<div class="rounded-2xl border border-neutral-100 bg-white/90 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div class="space-y-2">
						<SkeletonBlock class="h-7 w-72 max-w-[70vw]" rounded="md" />
						<SkeletonBlock class="h-4 w-64 max-w-[65vw]" rounded="md" />
					</div>
					<SkeletonBlock class="h-10 w-48" rounded="full" />
				</div>
				<SkeletonBlock class="mt-5 h-16 w-full" rounded="lg" />
				<SkeletonBlock class="mt-4 h-4 w-72 max-w-[70vw]" rounded="md" />
				<SkeletonBlock class="mt-3 h-4 w-44" rounded="md" />
			</div>
		</section>
	{:else}
		<section class="flex flex-col gap-6">
			<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<SkeletonBlock class="h-8 w-44" rounded="md" />
				<SkeletonBlock class="mt-3 h-4 w-80 max-w-[75vw]" rounded="md" />
			</div>
			<div class="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
				<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
					<SkeletonBlock class="h-7 w-52" rounded="md" />
					<SkeletonBlock class="mt-2 h-4 w-72 max-w-[85vw]" rounded="md" />
					<div class="mt-6 space-y-4">
						<SkeletonBlock class="h-11 w-full" rounded="lg" />
						<SkeletonBlock class="h-11 w-full" rounded="lg" />
						<SkeletonBlock class="h-4 w-40" rounded="md" />
						<SkeletonBlock class="h-11 w-full" rounded="lg" />
					</div>
				</div>
				<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
					<div class="flex items-center justify-between">
						<SkeletonBlock class="h-7 w-48" rounded="md" />
						<SkeletonBlock class="h-7 w-24" rounded="full" />
					</div>
					<div class="mt-5 space-y-3">
						{#each emailRows as row}
							<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
								<SkeletonBlock class="h-4 w-56 max-w-[55vw]" rounded="md" />
								<SkeletonBlock class="mt-2 h-5 w-24" rounded="full" />
								<div class="mt-3 flex gap-2">
									<SkeletonBlock class="h-8 w-24" rounded="full" />
									<SkeletonBlock class="h-8 w-20" rounded="full" />
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>
	{/if}
</div>
