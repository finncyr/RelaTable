// Tiny global toast store (Svelte 5 runes). Usage: toast('Gespeichert').
export type ToastItem = { id: number; msg: string; kind: 'ok' | 'warn' };

let seq = 0;
export const toasts = $state<ToastItem[]>([]);

export function toast(msg: string, kind: 'ok' | 'warn' = 'ok') {
	const id = ++seq;
	toasts.push({ id, msg, kind });
	setTimeout(() => dismiss(id), 3200);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}
