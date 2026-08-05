<script lang="ts">
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
	import { NAV_ITEMS, MOBILE_TABS, isActive } from '$lib/nav';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { children, data } = $props();

	let pinned = $state(data.railPinned);
	let hovered = $state(false);
	let focused = $state(false);
	let moreOpen = $state(false);

	const expanded = $derived(pinned || hovered || focused);
	const path = $derived($page.url.pathname);

	async function togglePin() {
		pinned = !pinned;
		await fetch('/api/setting', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: 'railPinned', value: String(pinned) })
		}).catch(() => {});
	}
</script>

<div class="flex h-screen w-screen overflow-hidden bg-bg" style="--mobile-tab-bar-height: 4rem;">
	<!-- Desktop icon rail (SCR-003) -->
	<nav
		class="hidden flex-none flex-col gap-1 border-r border-line bg-rail p-2 transition-[width] duration-200 md:flex {expanded
			? 'w-48 items-stretch'
			: 'w-[3.75rem] items-center'}"
		aria-label="Hauptnavigation"
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}
		onfocusin={() => (focused = true)}
		onfocusout={() => (focused = false)}
	>
		<button
			class="mb-1 flex h-9 items-center gap-2 rounded-lg px-2 text-[11px] text-mut transition-colors hover:bg-card hover:text-ink {expanded
				? 'justify-end'
				: 'justify-center'}"
			onclick={togglePin}
			title={pinned ? 'Rail lösen' : 'Rail anheften'}
			aria-pressed={pinned}
		>
			<Icon name="pin" size={15} />
			{#if expanded}<span>{pinned ? 'gelöst' : 'anheften'}</span>{/if}
		</button>

		{#each NAV_ITEMS as item}
			{@const active = isActive(path, item.match)}
			<a
				href={item.href}
				class="flex h-10 items-center gap-2.5 rounded-lg px-2 transition-colors {active
					? 'bg-accent/10 font-semibold text-accent'
					: 'text-ink hover:bg-card'
				} {expanded ? '' : 'justify-center'}"
				style={active ? 'view-transition-name: active-nav' : ''}
				aria-current={active ? 'page' : undefined}
				aria-label={item.label}
				title={item.label}
			>
				<span class="flex h-7 w-7 flex-none items-center justify-center" aria-hidden="true"><Icon name={item.icon} size={19} /></span>
				{#if expanded}<span class="whitespace-nowrap text-sm">{item.label}</span>{/if}
			</a>
		{/each}

		<div class="flex-1"></div>
		<form method="POST" action="/logout">
			<button
				class="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-mut transition-colors hover:bg-card hover:text-ink {expanded
					? ''
					: 'justify-center'}"
				title="Abmelden"
				aria-label="Abmelden"
			>
				<span class="flex h-7 w-7 flex-none items-center justify-center"><Icon name="logout" size={19} /></span>
				{#if expanded}<span class="whitespace-nowrap text-sm">Abmelden</span>{/if}
			</button>
		</form>
	</nav>

	<!-- Content -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">
		{@render children()}
	</div>

	<!-- Mobile bottom tab bar (SCR-004) -->
	<nav
		class="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
		aria-label="Hauptnavigation mobil"
	>
		{#each MOBILE_TABS as tab}
			{@const active = isActive(path, tab.match)}
			<a
				href={tab.href}
				class="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[10px] leading-none transition-colors {active
					? 'font-semibold text-accent'
					: 'text-mut'}"
				aria-current={active ? 'page' : undefined}
			>
				<span
					class="flex h-8 w-12 items-center justify-center rounded-[1rem] transition-colors {active
						? 'bg-accent/10'
						: ''}"
					style={active ? 'view-transition-name: active-tab' : ''}
				><Icon name={tab.icon} size={20} /></span>
				{tab.label}
			</a>
		{/each}
		<button
			class="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[10px] leading-none {moreOpen
				? 'font-semibold text-accent'
				: 'text-mut'}"
			onclick={() => (moreOpen = true)}
		>
			<span class="flex h-8 w-12 items-center justify-center rounded-[1rem] {moreOpen ? 'bg-accent/10' : ''}"><Icon name="more" size={21} /></span>
			Mehr
		</button>
	</nav>

	<!-- Voice input is only part of the graph workflow. -->
	{#if path === '/graph'}
		<VoiceButton
			narrateAutoApprove={data.narrateAutoApprove}
			narratePragmaticMode={data.narratePragmaticMode}
		/>
	{/if}

	<!-- "Mehr" sheet -->
	{#if moreOpen}
		<div
			class="fixed inset-0 z-40 bg-black/40 md:hidden"
			role="button"
			tabindex="-1"
			aria-label="Schließen"
			onclick={() => (moreOpen = false)}
			onkeydown={(e) => e.key === 'Escape' && (moreOpen = false)}
			transition:fade={{ duration: 180 }}
		></div>
		<div class="sheet-in fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-line bg-card p-4 pb-8 md:hidden">
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-line"></div>
			<a href="/einstellungen" class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 hover:bg-bg" onclick={() => (moreOpen = false)}><Icon name="settings" size={19} /> Einstellungen</a>
			<div class="my-2 border-t border-line"></div>
			<form method="POST" action="/logout"><button class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-warn hover:bg-bg"><Icon name="logout" size={19} /> Abmelden</button></form>
		</div>
	{/if}

	<Toasts />
	<CommandPalette />
</div>
