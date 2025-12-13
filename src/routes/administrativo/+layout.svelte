<script lang="ts">
	import { page } from '$app/stores';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	const nav = [
		{ label: 'Expedientes', href: '/administrativo/expedientes' },
		{ label: 'Configuración', href: '/administrativo/configuracion' }
	];
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<header class="sticky top-0 z-20 border-b border-neutral-100 bg-white/80 backdrop-blur dark:border-[#1f2b45] dark:bg-[#0f1f36]/90">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-3">
				<p class="text-base font-semibold text-neutral-900 dark:text-white">Administrativo · ANSES</p>
			</div>
			<nav class="flex items-center gap-10 text-sm font-semibold">
				<ThemeToggle />
				{#each nav as item}
					<a
						href={item.href}
						class={`group rounded-full px-3 py-2 transition-all duration-200 ${
							$page.url.pathname.startsWith(item.href)
								? 'bg-[#7c3aed] text-white shadow-sm'
								: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
						}`}
					>
						{#each item.label.split('') as char, i}
							<span
								class="inline-block transition-colors duration-200 group-hover:text-[#7c3aed] group-[.bg\\[\\#7c3aed\\]]:text-white dark:group-hover:text-[#c084fc]"
								style={`transition-delay:${i * 18}ms`}
							>
								{char}
							</span>
						{/each}
					</a>
				{/each}
				<a
					href="/logout"
					class="group text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
				>
					{#each 'Salir'.split('') as char, i}
						<span
							class="inline-block transition-colors duration-200 group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]"
							style={`transition-delay:${i * 18}ms`}
						>
							{char}
						</span>
					{/each}
				</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-6">
		{@render children()}
	</main>
</div>
