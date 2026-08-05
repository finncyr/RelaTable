<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { storedTheme, applyTheme, initThemeWatcher } from '$lib/theme';
	import { page } from '$app/stores';

	let { children, data } = $props();

	// View Transitions API: animate every client-side navigation (CSS in app.css).
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	onMount(() => {
		// Sync the document class with the owner's saved preference on first load.
		const serverTheme = (data?.user?.themePreference as 'System' | 'Light' | 'Dark') ?? storedTheme();
		applyTheme(serverTheme);
		return initThemeWatcher(() => storedTheme());
	});
</script>

{@render children()}
