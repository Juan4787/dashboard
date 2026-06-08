<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle = '',
		actions,
		badge
	}: {
		title: string;
		subtitle?: string;
		actions?: Snippet;
		badge?: Snippet;
	} = $props();
</script>

<div class="ux-hero">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-3">
				<h1 class="ux-title">{title}</h1>
				{#if badge}{@render badge()}{/if}
			</div>
			{#if subtitle}<p class="ux-subtitle">{subtitle}</p>{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>
		{/if}
	</div>
</div>
