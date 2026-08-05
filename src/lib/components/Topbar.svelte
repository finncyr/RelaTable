<script lang="ts">
	import { onMount } from 'svelte';
	import { applyThemeWithReveal, type Theme } from '$lib/theme';
	import Icon from '$lib/components/Icon.svelte';

	interface Props {
		title: string;
		subtitle?: string;
		back?: { href: string; label: string };
		children?: import('svelte').Snippet;
	}
	let { title, subtitle, back, children }: Props = $props();

	let dark = $state(false);
	onMount(() => {
		const sync = (event: Event | undefined) => {
			const detail = (event as CustomEvent<{ dark: boolean }> | undefined)?.detail;
			dark = detail?.dark ?? document.documentElement.classList.contains('dark');
		};
		sync(undefined);
		window.addEventListener('relatable:theme-change', sync);
		return () => window.removeEventListener('relatable:theme-change', sync);
	});

	function toggleTheme(e: MouseEvent) {
		dark = !dark;
		const t: Theme = dark ? 'Dark' : 'Light';
		applyThemeWithReveal(t, e.clientX, e.clientY);
		fetch('/api/setting', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: 'themePreference', value: t })
		}).catch(() => {});
	}
</script>

<header class="flex min-h-14 flex-none items-center gap-2 border-b border-line bg-card px-3 sm:gap-2.5 sm:px-4 md:min-h-[3.25rem]">
	{#if back}
		<a href={back.href} class="icon-btn -ml-1 gap-1 sm:w-auto sm:px-2" aria-label={back.label} title={back.label}>
			<Icon name="back" size={18} />
			<span class="hidden text-xs sm:inline">{back.label}</span>
		</a>
	{/if}
	<div class="min-w-0">
		<b class="block truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</b>
		{#if subtitle}<span class="hidden text-xs text-mut sm:inline">{subtitle}</span>{/if}
	</div>
	<span class="flex-1"></span>
	{#if children}<div class="flex min-w-0 items-center gap-1.5 sm:gap-2">{@render children()}</div>{/if}
	<button
		class="icon-btn flex-none"
		onclick={toggleTheme}
		title={dark ? 'Helles Design' : 'Dunkles Design'}
		aria-label={dark ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
	><Icon name={dark ? 'sun' : 'moon'} size={18} /></button>
</header>
