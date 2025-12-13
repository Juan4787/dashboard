<script lang="ts">
import { createEventDispatcher } from 'svelte';

let { open = false, title = '', children } = $props();

const dispatch = createEventDispatcher<{ close: void }>();
const close = () => dispatch('close');
</script>

{#if open}
	<div
		class="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10 backdrop-blur-sm dark:bg-black/60"
		role="button"
		tabindex="0"
		aria-label="Cerrar modal"
		onclick={(event) => {
			if (event.target === event.currentTarget) {
				close();
			}
		}}
		onkeydown={(event: KeyboardEvent) => {
			if (event.key === 'Escape' || event.key === 'Enter') {
				close();
			}
		}}
	>
		<div class="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-card dark:border dark:border-[#1f3554] dark:bg-[#0f1f36]">
			<div class="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-[#1f3554]">
				<h3 class="text-lg font-semibold text-neutral-900 dark:text-white">{title}</h3>
				<button
					type="button"
					class="grid h-9 w-9 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-[#13243d]"
					onclick={close}
					aria-label="Cerrar"
				>
					<span aria-hidden="true">×</span>
				</button>
			</div>
			<div class="px-6 py-5">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
