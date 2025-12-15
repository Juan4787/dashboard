<script lang="ts">
	import { page } from '$app/stores';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	const nav = [
		{ label: 'Pacientes', href: '/odonto/pacientes' },
		{ label: 'Configuración', href: '/odonto/configuracion' }
	];

	const isActive = (href: string) => $page.url.pathname.startsWith(href);
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<header class="sticky top-0 z-20 border-b border-neutral-100 bg-white/80 backdrop-blur dark:border-[#1f2b45] dark:bg-[#0f1f36]/90">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-3">
				<img
					src="/logo-mejorado.png"
					alt="Clínica Sabrina"
					class="h-20 w-20"
				/>
			</div>
			<nav class="flex items-center gap-10 text-sm font-semibold">
				<ThemeToggle />
				{#each nav as item}
					<a
						href={item.href}
						class={`group rounded-full px-3 py-2 transition-all duration-200 ${
							isActive(item.href)
								? 'bg-[#7c3aed] text-white shadow-sm'
								: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
						}`}
					>
						<span
							class={`inline-block transition-colors duration-200 ${
								isActive(item.href) ? 'text-white' : 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
							}`}
						>
							{item.label}
						</span>
					</a>
				{/each}
				<a
					href="/logout"
					class="group text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
				>
					<span class="inline-block transition-colors duration-200 group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]">
						Salir
					</span>
				</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-6">
		{@render children()}
	</main>
</div>
