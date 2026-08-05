<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly, fade } from 'svelte/transition';
	import { toasts, dismiss } from '$lib/toast.svelte';
</script>

{#if toasts.length}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-tab-bar-height,4rem)+0.75rem)] z-[900] flex flex-col items-center gap-2 md:bottom-6"
		role="status"
		aria-live="polite"
	>
		{#each toasts as t (t.id)}
			<button
				class="pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-2 text-[13px] shadow-lg backdrop-blur-md {t.kind === 'warn'
					? 'border-warn/50 bg-card/95 text-warn'
					: 'border-line bg-card/95 text-ink'}"
				onclick={() => dismiss(t.id)}
				in:fly={{ y: 16, duration: 300 }}
				out:fade={{ duration: 180 }}
				animate:flip={{ duration: 200 }}
				title="Schließen"
			>
				{#if t.kind === 'ok'}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--c-ok))" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path class="check-draw" d="M4 12.5 9.5 18 20 6.5" />
					</svg>
				{:else}
					<span aria-hidden="true">⚠</span>
				{/if}
				{t.msg}
			</button>
		{/each}
	</div>
{/if}
