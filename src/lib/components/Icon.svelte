<script lang="ts" module>
	export type IconName =
		| 'graph'
		| 'people'
		| 'events'
		| 'map'
		| 'settings'
		| 'logout'
		| 'pin'
		| 'sun'
		| 'moon'
		| 'more'
		| 'search'
		| 'plus'
		| 'back'
		| 'close';
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
		strokeWidth?: number;
		className?: string;
	}

	let { name, size = 20, strokeWidth = 1.8, className = '' }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if name === 'graph'}
		<circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="11" cy="18" r="2.5" />
		<path d="m8.3 6.5 7.2 1M7.4 8.1l2.4 7.5m6.6-5.5-3.8 5.8" />
	{:else if name === 'people'}
		<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="4" />
		<path d="M22 20v-1.5a4 4 0 0 0-3-3.7M16 3.2a4 4 0 0 1 0 7.6" />
	{:else if name === 'events'}
		<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
		<path d="m9 15 2 2 4-4" />
	{:else if name === 'map'}
		<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
	{:else if name === 'logout'}
		<path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
	{:else if name === 'pin'}
		<path d="m15 4 5 5-3 1-4 4 1 4-1 1-4-4-4 4-1-1 4-4-4-4 1-1 4 1 4-4Z" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	{:else if name === 'moon'}
		<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
	{:else if name === 'more'}
		<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'back'}
		<path d="m15 18-6-6 6-6" />
	{:else if name === 'close'}
		<path d="m6 6 12 12M18 6 6 18" />
	{/if}
</svg>
