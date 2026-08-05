import type { IconName } from '$lib/components/Icon.svelte';

// Shared navigation config for desktop rail, mobile tabs and command palette.

export interface NavItem {
	href: string;
	label: string;
	icon: IconName;
	/** match prefix for active state */
	match: string;
}

export const NAV_ITEMS: NavItem[] = [
	{ href: '/graph', label: 'Graph', icon: 'graph', match: '/graph' },
	{ href: '/personen', label: 'Personen', icon: 'people', match: '/personen' },
	{ href: '/ereignisse', label: 'Ereignisse', icon: 'events', match: '/ereignisse' },
	{ href: '/karte', label: 'Karte', icon: 'map', match: '/karte' },
	{ href: '/einstellungen', label: 'Einstellungen', icon: 'settings', match: '/einstellungen' }
];

// Mobile bottom bar: Graph, Personen, Ereignisse, Karte, Mehr (Mehr → settings/theme/logout).
export const MOBILE_TABS: NavItem[] = [
	{ href: '/graph', label: 'Graph', icon: 'graph', match: '/graph' },
	{ href: '/personen', label: 'Personen', icon: 'people', match: '/personen' },
	{ href: '/ereignisse', label: 'Events', icon: 'events', match: '/ereignisse' },
	{ href: '/karte', label: 'Karte', icon: 'map', match: '/karte' }
];

export function isActive(path: string, match: string): boolean {
	return path === match || path.startsWith(match + '/');
}
