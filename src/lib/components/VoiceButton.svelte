<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { fade, scale } from 'svelte/transition';

	type ChatMsg = { role: 'user' | 'assistant'; content: string };
	type ApiMsg = { role: 'user' | 'assistant'; content: string };

	let { narrateAutoApprove = false, narratePragmaticMode = false } = $props<{
		narrateAutoApprove?: boolean;
		narratePragmaticMode?: boolean;
	}>();

	const BARS = 20;
	const SR: any =
		typeof window !== 'undefined' &&
		((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

	let active = $state(false);
	let error = $state('');
	let bars = $state<number[]>(Array(BARS).fill(0));

	type Reason =
		| 'checking'
		| 'no-key'
		| 'invalid-key'
		| 'no-credits'
		| 'error'
		| 'no-groq-key'
		| 'invalid-groq-key'
		| null;
	const MSG: Record<NonNullable<Reason>, string> = {
		checking: 'Sprachdienst wird geprüft…',
		'no-key': 'Kein OpenRouter-API-Key — in den Einstellungen hinterlegen.',
		'invalid-key': 'OpenRouter-API-Key ungültig.',
		'no-credits': 'Keine Credits mehr verfügbar.',
		error: 'Sprachdienst nicht erreichbar.',
		'no-groq-key': 'Kein Groq-API-Key (Desktop-Spracherkennung) — in den Einstellungen hinterlegen.',
		'invalid-groq-key': 'Groq-API-Key ungültig.'
	};
	const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
	let reason = $state<Reason>(null);
	let statusMsg = $state('');
	let popup = $state(false);
	let popupTimer = 0;
	const blocked = $derived(reason !== null);
	let dimmed = $state(false);
	let convoOpen = $state(false);
	let convo = $state<ChatMsg[]>([]);
	let history: ApiMsg[] = [];
	let busy = $state(false);
	let draft = $state('');
	let msgList = $state<HTMLDivElement>();

	async function scrollToBottom() {
		await tick();
		requestAnimationFrame(() => msgList?.scrollTo({ top: msgList.scrollHeight }));
	}

	type VoicePhase = 'idle' | 'recording' | 'processing' | 'updating' | 'done' | 'error';
	let phase = $state<VoicePhase>('idle');
	let doneTimer = 0;
	const PHASE_MSG: Record<VoicePhase, string> = {
		idle: '',
		recording: 'Hört zu…',
		processing: 'Prompt läuft…',
		updating: 'Daten werden aktualisiert…',
		done: 'Antwort bereit',
		error: 'Fehler'
	};
	const compactAutoMode = $derived(narrateAutoApprove && narratePragmaticMode);
	const voiceStatus = $derived(
		reason === 'checking'
			? ''
			: active
				? PHASE_MSG.recording
				: busy
					? PHASE_MSG.processing
					: phase !== 'idle'
						? phase === 'done' && compactAutoMode
							? 'Aktualisiert'
							: PHASE_MSG[phase]
							: ''
	);

	function logClientEvent(event: string, fields: Record<string, unknown> = {}) {
		void fetch('/api/client-log', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				event,
				path: window.location.pathname,
				userAgent: navigator.userAgent,
				speechRecognition: Boolean(SR),
				...fields
			})
		}).catch(() => {
			/* diagnostics must never break the UI */
		});
	}

	onMount(() => {
		const onDim = (event: Event) => {
			const detail = (event as CustomEvent<{ dimmed?: boolean }>).detail;
			dimmed = Boolean(detail?.dimmed);
		};
		window.addEventListener('graph-voice-button-dim', onDim as EventListener);

		// Let the routed page render and restore graph focus before showing the
		// voice backend validation state.
		const timer = window.setTimeout(async () => {
			reason = 'checking';
			try {
				const r = await fetch('/api/voice-status');
				const data = await r.json().catch(() => ({}));
				if (!r.ok) {
					reason = 'error';
				} else if (data.reason) {
					reason = data.reason;
				} else if (!isAndroid && data.groqReason === 'no-key') {
					reason = 'no-groq-key';
				} else if (!isAndroid && data.groqReason === 'invalid-key') {
					reason = 'invalid-groq-key';
				} else {
					reason = null;
				}
				if (data.message) statusMsg = data.message;
			} catch {
				reason = 'error';
			}
		}, 900);
		return () => {
			window.removeEventListener('graph-voice-button-dim', onDim as EventListener);
			window.clearTimeout(timer);
		};
	});

	function stopCapture() {
		active = false;
		bars = Array(BARS).fill(0);
		clearTimeout(srHintTimer);
		if (raf) cancelAnimationFrame(raf);
		try {
			rec?.stop();
		} catch {
			/* schon gestoppt */
		}
		rec = null;
		interimTranscript = '';
		stream?.getTracks().forEach((t) => t.stop());
		void ctx?.close();
		stream = null;
		ctx = null;
	}

	function blockedClick() {
		popup = true;
		clearTimeout(popupTimer);
		popupTimer = window.setTimeout(() => (popup = false), 4000);
	}

	let stream: MediaStream | null = null;
	let ctx: AudioContext | null = null;
	let raf = 0;
	let rec: any = null;
	let srHintTimer = 0;
	let mediaRec: MediaRecorder | null = null;
	let mediaChunks: Blob[] = [];
	let mediaRecMime = '';
	let transcript = $state('');
	let interimTranscript = $state('');
	let lastInterimTranscript = '';

	// Overlay is open while recording or while a conversation is in progress.
	const overlayOpen = $derived(active || convoOpen);

	async function openAndStart() {
		if (blocked) {
			blockedClick();
			return;
		}
		// Offene Konversation (z. B. wartende Bestätigung) wieder anzeigen statt neu aufzunehmen.
		if (convo.length > 0) {
			convoOpen = true;
			void scrollToBottom();
			return;
		}
		await start();
	}

	async function start() {
		error = '';
		transcript = '';
		interimTranscript = '';
		lastInterimTranscript = '';
		phase = 'recording';
		if (!SR) {
			logClientEvent('speech.unsupported');
			error = 'Spracherkennung nicht verfügbar — tippe deine Eingabe.';
			phase = 'error';
			active = true; // show recording overlay with text input
			return;
		}
		// Use synthetic pulse bars; a parallel WebAudio mic stream can starve SpeechRecognition on Android.
		const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
		logClientEvent('speech.visualizer_fallback', { reason: 'sr_active', android: isAndroid });
		active = true;
		let t = 0;
		const tick = () => {
			t += 0.08;
			bars = Array.from({ length: BARS }, (_, i) => 0.15 + 0.12 * Math.sin(t + i * 0.4));
			raf = requestAnimationFrame(tick);
		};
		tick();

		rec = new SR();
		rec.lang = 'de-DE';
		rec.continuous = !isAndroid;
		rec.interimResults = true;
		// ponytail: SR is dead on some Chromium/Linux builds but the mic is only enabled when
		// Groq is configured & valid (voice-status gate), so the MediaRecorder fallback already
		// covers this silently — just log it, no user-facing error.
		srHintTimer = window.setTimeout(() => {
			if (active && !transcript && !interimTranscript) {
				logClientEvent('speech.sr_hint_timeout');
			}
		}, 4000);
		rec.onresult = (e: any) => {
			clearTimeout(srHintTimer);
			// The 4s hint may already have fired before this first real result came in — clear it.
			if (error) error = '';
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				if (e.results[i].isFinal) {
					transcript += e.results[i][0].transcript + ' ';
					lastInterimTranscript = '';
				} else {
					interim += e.results[i][0].transcript;
				}
			}
			interimTranscript = interim;
			if (interim.trim()) lastInterimTranscript = interim;
			logClientEvent('speech.recognition_result', {
				finalChars: transcript.trim().length,
				interimChars: interim.trim().length
			});
			console.log('[SR] result — final:', JSON.stringify(transcript), 'interim:', JSON.stringify(interim));
		};
		rec.onerror = (e: any) => {
			const code = String(e.error ?? 'unknown');
			console.warn('[SR] error:', code, e.message);
			logClientEvent('speech.recognition_error', {
				errorCode: code,
				errorMessage: e.message ? String(e.message) : undefined,
				phase,
				hadTranscript: Boolean(transcript.trim() || interimTranscript.trim())
			});
			if (code === 'no-speech') {
				error = 'Noch nichts verstanden — sprich bitte weiter oder tippe unten.';
				return;
			}
			if (code === 'aborted') return;
			if (code === 'not-allowed') {
				error = 'Kein Mikrofonzugriff — bitte Browser-Berechtigung erlauben.';
			} else if (code === 'service-not-allowed' || code === 'network') {
				// Chromium on Linux without embedded Google key — keep overlay open, fall through to text input
				bars = Array(BARS).fill(0);
				if (raf) { cancelAnimationFrame(raf); raf = 0; }
				try { rec?.stop(); } catch { /* noop */ }
				rec = null;
				interimTranscript = '';
				stream?.getTracks().forEach((t) => t.stop());
				void ctx?.close();
				stream = null; ctx = null;
				// active stays true → overlay stays open
				error = 'Spracherkennung nicht verfügbar — tippe deine Eingabe.';
				phase = 'error';
				return;
			} else if (code === 'audio-capture') {
				error = 'Mikrofon nicht verfügbar — Eingabegerät prüfen.';
			} else if (code === 'language-not-supported') {
				error = 'Deutsch wird von dieser Browser-Spracherkennung nicht unterstützt.';
			} else {
				error = `Spracherkennungsfehler: ${code}`;
			}
			phase = 'error';
			stopCapture();
			convoOpen = true;
			void scrollToBottom();
		};
		rec.onstart = () => {
			logClientEvent('speech.recognition_started');
			console.log('[SR] started');
		};
		rec.onend = () => {
			console.log('[SR] ended, active:', active);
			interimTranscript = '';
			// On mobile, SR auto-stops after silence — restart if still recording
			if (active && rec) {
				try {
					rec.start();
				} catch {
					/* already started */
				}
			}
		};
		try {
			rec.start();
		} catch (e) {
			logClientEvent('speech.start_failed', {
				errorName: e instanceof Error ? e.name : undefined,
				errorMessage: e instanceof Error ? e.message : String(e)
			});
			error = 'Spracherkennung konnte nicht gestartet werden — bitte erneut versuchen oder Text eingeben.';
			phase = 'error';
			stopCapture();
			convoOpen = true;
			void scrollToBottom();
		}

		// Parallel MediaRecorder as Groq-Whisper fallback (desktop only — Android SR works natively)
		if (!isAndroid) {
			navigator.mediaDevices.getUserMedia({ audio: true }).then((mStream) => {
				stream = mStream;
				const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
					? 'audio/webm;codecs=opus'
					: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
						? 'audio/ogg;codecs=opus'
						: '';
				mediaRecMime = mime;
				mediaChunks = [];
				mediaRec = new MediaRecorder(mStream, mime ? { mimeType: mime } : undefined);
				mediaRec.ondataavailable = (e) => { if (e.data.size > 0) mediaChunks.push(e.data); };
				mediaRec.start(1000);
				logClientEvent('speech.mediarecorder_started', { mime });
			}).catch(() => { /* mic access denied or unavailable — SR-only */ });
		}
	}


	function stopMediaRec() {
		try { mediaRec?.stop(); } catch { /* noop */ }
		mediaRec = null;
		mediaChunks = [];
	}

	function cancel() {
		stopMediaRec();
		stopCapture();
		transcript = '';
		interimTranscript = '';
		lastInterimTranscript = '';
		phase = 'idle';
	}

	async function confirm() {
		const text = [transcript, interimTranscript || lastInterimTranscript].join(' ').trim();

		// If SR produced no text but MediaRecorder has audio → try Groq transcription
		if (!text && mediaRec && mediaChunks.length > 0) {
			// Stop MediaRecorder and collect final chunk before creating blob
			const blob = await new Promise<Blob>((resolve) => {
				const chunks = mediaChunks;
				const mime = mediaRecMime;
				mediaRec!.onstop = () => resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
				try { mediaRec!.stop(); } catch { resolve(new Blob(chunks, { type: mime || 'audio/webm' })); }
			});
			mediaRec = null;
			mediaChunks = [];
			stopCapture();
			await transcribeAndSend(blob);
			return;
		}

		stopMediaRec();
		stopCapture();
		if (!text) {
			logClientEvent('speech.empty_confirm', {
				hadFinal: Boolean(transcript.trim()),
				hadInterim: Boolean(interimTranscript.trim() || lastInterimTranscript.trim())
			});
			error = SR
				? 'Nichts verstanden — bitte erneut.'
				: 'Spracherkennung nicht verfügbar — bitte tippen.';
			phase = 'error';
			convoOpen = true;
			void scrollToBottom();
			return;
		}
		await send(text, { compact: compactAutoMode });
	}

	async function transcribeAndSend(blob: Blob) {
		clearTimeout(doneTimer);
		error = '';
		phase = 'processing';
		busy = true;
		if (!compactAutoMode) { convoOpen = true; void scrollToBottom(); }
		const fd = new FormData();
		fd.append('audio', blob, 'audio.webm');
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 60_000);
		try {
			const res = await fetch('/api/transcribe', { method: 'POST', body: fd, signal: ctrl.signal });
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `Fehler ${res.status}`);
			const { text } = await res.json() as { text: string };
			if (!text.trim()) {
				error = 'Nichts verstanden — bitte erneut sprechen oder tippen.';
				phase = 'error';
				convoOpen = true;
				void scrollToBottom();
				return;
			}
			logClientEvent('speech.groq_transcription', { chars: text.length });
			await send(text, { compact: compactAutoMode });
		} catch (e) {
			error = e instanceof Error && e.name === 'AbortError'
				? 'Transkription-Timeout'
				: e instanceof Error ? e.message : 'Transkription fehlgeschlagen';
			phase = 'error';
			convoOpen = true;
			void scrollToBottom();
		} finally {
			window.clearTimeout(timer);
			busy = false;
		}
	}

	async function send(text: string, opts: { compact?: boolean } = {}) {
		const compact = !!opts.compact;
		clearTimeout(doneTimer);
		error = '';
		phase = 'processing';
		convoOpen = !compact;
		const userMessage: ApiMsg = { role: 'user', content: text };
		const nextHistory: ApiMsg[] = compact ? [userMessage] : [...history, userMessage].slice(-16);
		if (compact) {
			convo = [];
			draft = '';
		} else {
			convo = [...convo, { role: 'user', content: text }];
			void scrollToBottom();
		}
		history = nextHistory;
		busy = true;
		if (!compact) void scrollToBottom();
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 150_000);
		try {
			const res = await fetch('/api/narrate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ messages: nextHistory }),
				signal: ctrl.signal
			});
			if (!res.ok)
				throw new Error((await res.json().catch(() => ({})))?.message || `Fehler ${res.status}`);
			const resp = await res.json();
			const reply = resp.reply || '(keine Antwort)';
			if (compact) {
				history = [];
				convo = [];
				convoOpen = false;
			} else {
				const assistantMessage: ApiMsg = { role: 'assistant', content: reply };
				history = [...nextHistory, assistantMessage].slice(-16);
				convo = [...convo, { role: 'assistant', content: reply }];
				void scrollToBottom();
			}
			if (resp.wrote) {
				phase = 'updating';
				await invalidateAll();
				const personIds: unknown = resp.personIds;
				if (Array.isArray(personIds) && personIds.length) {
					const id = personIds[personIds.length - 1];
					try { localStorage.setItem('graph.focus', String(id)); } catch { /* private mode etc. */ }
					await goto(`/graph?focus=${id}`, { noScroll: true, keepFocus: true });
				}
			}
			phase = 'done';
			// Nach erfolgreichem Schreiben ist die Erzählung abgeschlossen — Verlauf
			// verwerfen, sonst zeigt der FAB dauerhaft "Offene Erzählung" an, obwohl
			// die Änderungen längst übernommen wurden.
			const finished = !compact && resp.wrote;
			doneTimer = window.setTimeout(() => {
				phase = 'idle';
				if (finished) {
					convo = [];
					history = [];
					convoOpen = false;
				}
			}, 3000);
		} catch (e) {
			error =
				e instanceof Error && e.name === 'AbortError'
					? 'Zeitüberschreitung (150 s) — Modell zu langsam, in den Einstellungen ein anderes wählen.'
					: e instanceof Error
						? e.message
						: 'Anfrage fehlgeschlagen';
			phase = 'error';
			if (/402|credit|insufficient/i.test(error)) reason = 'no-credits';
			else if (/401|api.?key|unauthor/i.test(error)) reason = 'invalid-key';
			if (compact) {
				convoOpen = false;
			} else {
				void scrollToBottom();
			}
		} finally {
			window.clearTimeout(timer);
			busy = false;
		}
	}

	function submitDraft() {
		const t = draft.trim();
		if (!t || busy) return;
		draft = '';
		send(t);
	}

	// Minimiert nur — Verlauf bleibt erhalten, damit eine offene Rückfrage (z. B.
	// "Soll ich das übernehmen?") über das Mikro-Symbol wieder aufgerufen werden kann.
	function closeConvo() {
		convoOpen = false;
		error = '';
		phase = 'idle';
		clearTimeout(doneTimer);
	}

	// Verwirft die Konversation komplett (neues Thema statt Rückkehr zur alten Rückfrage).
	function discardConvo() {
		convoOpen = false;
		convo = [];
		history = [];
		draft = '';
		error = '';
		phase = 'idle';
		clearTimeout(doneTimer);
	}

	onDestroy(() => {
		clearTimeout(doneTimer);
		clearTimeout(srHintTimer);
		stopMediaRec();
		stopCapture();
		dimmed = false;
	});
</script>

<!-- Global FAB: visible when no overlay is open -->
{#if !overlayOpen}
	<div
		data-testid="voice-fab"
		class="fixed bottom-[70px] right-4 z-40 transition-opacity duration-200 md:bottom-6 md:right-6 {dimmed && !blocked ? 'opacity-35' : 'opacity-100'}"
		transition:scale={{ duration: 200, start: 0.8 }}
	>
		{#if popup && reason}
			<div
				class="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-warn bg-card px-3 py-2 text-[12px] text-warn shadow-lg"
				role="alert"
			>
				{statusMsg || MSG[reason]}
			</div>
		{/if}
		{#if voiceStatus && !popup}
			<div
				class="absolute bottom-full right-0 mb-2 max-w-[220px] rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink shadow-lg"
				role="status"
				aria-live="polite"
			>
				{voiceStatus}
			</div>
		{:else if convo.length > 0 && !popup}
			<div
				class="absolute bottom-full right-0 mb-2 max-w-[220px] rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink shadow-lg"
				role="status"
				aria-live="polite"
			>
				Offene Erzählung — tippen zum Fortsetzen
			</div>
		{/if}
		<button
			type="button"
			onclick={openAndStart}
			aria-label={convo.length > 0 ? 'Erzählung fortsetzen' : 'Mikrofon starten'}
			aria-disabled={blocked}
			title={reason ? (statusMsg || MSG[reason]) : error || (convo.length > 0 ? 'Erzählung fortsetzen' : 'Erzählen')}
			class="relative grid h-14 w-14 place-items-center rounded-full shadow-lg transition-all duration-200
				{blocked
				? 'cursor-not-allowed border border-line bg-card text-mut opacity-50'
				: error
					? 'border border-warn bg-card text-warn'
					: dimmed
						? 'bg-accent text-white active:scale-95'
						: 'bg-accent text-white hover:opacity-90 active:scale-95'}"
		>
			<svg
				width="26"
				height="26"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<rect x="9" y="2" width="6" height="12" rx="3" />
				<path d="M5 10a7 7 0 0 0 14 0" />
				<line x1="12" y1="19" x2="12" y2="22" />
			</svg>
			{#if convo.length > 0}
				<span class="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-bg bg-warn" aria-hidden="true"></span>
			{/if}
		</button>
	</div>
{/if}

<!-- Full-screen overlay: recording or conversation -->
{#if overlayOpen}
	<div
		class="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
	>
		{#if convoOpen}
			<!-- Conversation panel -->
			<div class="flex flex-1 items-center justify-center p-4">
				<div
					class="flex w-full max-w-md flex-col rounded-2xl border border-line bg-card shadow-xl"
					transition:scale={{ duration: 250, start: 0.92 }}
				>
					<div class="flex items-center justify-between border-b border-line px-4 py-3">
						<b class="text-sm">Erzählung</b>
						{#if voiceStatus}
							<span class="rounded-full border border-line px-2 py-0.5 text-[11px] text-mut" role="status" aria-live="polite">
								{voiceStatus}
							</span>
						{/if}
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={discardConvo}
								class="text-[11px] text-mut hover:text-warn"
								aria-label="Verwerfen">Verwerfen</button
							>
							<button
								type="button"
								onclick={closeConvo}
								class="text-mut hover:text-ink"
								title="Minimieren — über das Mikro-Symbol wieder aufrufbar"
								aria-label="Minimieren">✕</button
							>
						</div>
					</div>
					<div
						bind:this={msgList}
						data-testid="voice-convo-messages"
						class="flex max-h-96 flex-col gap-2 overflow-y-auto px-4 py-3 text-sm"
					>
						{#each convo as m}
							<div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
								<span
									class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5
										{m.role === 'user' ? 'bg-accent text-white' : 'bg-bg text-ink'}"
								>{m.content}</span>
							</div>
						{/each}
						{#if busy}
							<div class="flex items-center gap-2 text-xs text-mut" role="status" aria-live="polite">
								<span class="h-2 w-2 rounded-full bg-accent"></span>
								{voiceStatus || 'Prompt läuft…'}
							</div>
						{/if}
						{#if error}
							<div class="text-xs text-warn">{error}</div>
						{/if}
					</div>
					<div class="flex items-center gap-1.5 border-t border-line p-3">
						<input
							bind:value={draft}
							onkeydown={(e) => e.key === 'Enter' && submitDraft()}
							placeholder="Antwort tippen…"
							disabled={busy}
							class="inp btn-sm flex-1"
							aria-label="Antwort"
						/>
						{#if active}
							<button
								type="button"
								onclick={confirm}
								class="grid h-8 w-8 place-items-center rounded-full bg-accent text-white"
								aria-label="Aufnahme senden">✓</button
							>
						{:else}
							<button
								type="button"
								onclick={start}
								class="grid h-8 w-8 place-items-center rounded-full border border-line text-ink hover:bg-bg"
								aria-label="Sprechen"
								title="Sprechen"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="9" y="2" width="6" height="12" rx="3" /><path
										d="M5 10a7 7 0 0 0 14 0"
									/><line x1="12" y1="19" x2="12" y2="22" /></svg
								>
							</button>
						{/if}
						<button
							type="button"
							onclick={submitDraft}
							disabled={busy || !draft.trim()}
							class="btn btn-primary btn-sm"
							aria-label="Senden">Senden</button
						>
					</div>
				</div>
			</div>
		{:else}
			<!-- Recording UI: large mic + level bars + controls -->
			<div class="flex flex-1 flex-col items-center justify-center gap-8">
				<!-- Level visualiser: bars grow upward from baseline -->
				<div class="flex h-16 items-end gap-[3px]">
					{#each bars as b}
						<span
							class="w-1 rounded-full bg-white/70 transition-[height] duration-75"
							style="height:{Math.max(4, b * 64)}px"
						></span>
					{/each}
				</div>

				<!-- Live transcript display -->
				{#if transcript || interimTranscript}
					<div class="max-w-xs rounded-xl bg-black/40 px-4 py-2 text-center text-sm text-white/90">
						{transcript}<span class="text-white/50 italic">{interimTranscript}</span>
					</div>
				{/if}

				<!-- Big mic button: tap = confirm and send -->
				<button
					type="button"
					onclick={confirm}
					class="grid h-20 w-20 place-items-center rounded-full bg-accent text-white shadow-2xl ring-8 ring-accent/25 transition-transform active:scale-95"
					aria-label="Aufnahme bestätigen und senden"
					transition:scale={{ duration: 300, start: 0.5 }}
				>
					<svg
						width="36"
						height="36"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="9" y="2" width="6" height="12" rx="3" />
						<path d="M5 10a7 7 0 0 0 14 0" />
						<line x1="12" y1="19" x2="12" y2="22" />
					</svg>
				</button>

				<p class="text-sm text-white/70">Tippe zum Senden</p>
				{#if voiceStatus}
					<p class="rounded-lg bg-black/30 px-3 py-1.5 text-xs text-white/90" role="status" aria-live="polite">
						{voiceStatus}
					</p>
				{/if}

				{#if error}
					<p class="rounded-lg bg-black/30 px-3 py-1.5 text-xs text-warn">{error}</p>
				{/if}

				<!-- Cancel (✕) and confirm (✓) -->
				<div class="flex gap-6">
					<button
						type="button"
						onclick={cancel}
						class="grid h-12 w-12 place-items-center rounded-full border-2 border-white/30 text-white transition-colors hover:border-white/60 hover:bg-white/10"
						aria-label="Abbrechen"
					>✕</button>
					<button
						type="button"
						onclick={confirm}
						class="grid h-12 w-12 place-items-center rounded-full bg-white text-accent shadow-lg transition-all hover:bg-white/90 active:scale-95"
						aria-label="Bestätigen und senden"
					>✓</button>
				</div>

				<div class="flex w-full max-w-xs gap-2 px-4">
					<input
						bind:value={draft}
						onkeydown={(e) => { if (e.key === 'Enter') { stopCapture(); submitDraft(); } }}
						placeholder="Eingabe tippen…"
						class="inp flex-1 text-sm"
						aria-label="Text eingeben"
					/>
					<button
						type="button"
						onclick={() => { stopCapture(); submitDraft(); }}
						disabled={!draft.trim()}
						class="btn btn-primary btn-sm"
					>Senden</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
