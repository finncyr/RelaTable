/**
 * Diagnostic spec: zeigt warum SpeechRecognition auf Desktop nicht funktioniert.
 * Läuft ohne SR-Mock — nutzt echtes Browser-SR (das auf Playwright-Chromium fehlschlägt
 * genau wie auf Desktop-Linux ohne Google-Keys).
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

const clientLogs: unknown[] = [];

test.describe('Voice Desktop Diagnose', () => {
	test.beforeEach(async ({ page }) => {
		// Sammle alle /api/client-log Events (logClientEvent() im VoiceButton)
		await page.route('/api/client-log', async (route) => {
			try { clientLogs.push(route.request().postDataJSON()); } catch { /* noop */ }
			await route.fulfill({ json: { ok: true } });
		});

		// Schalte Voice-Backend frei (kein OpenRouter-Key nötig)
		await page.route('/api/voice-status', (r) => r.fulfill({ json: { reason: null } }));

		await login(page);
	});

	test.afterEach(() => {
		clientLogs.length = 0;
	});

	test('SR-Verfügbarkeit und Fehlercode auf Desktop-Chromium', async ({ page }) => {
		await page.goto('/graph');

		// Prüfe ob SpeechRecognition im Browser vorhanden ist
		const srAvailable = await page.evaluate(
			() => !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition)
		);
		console.log('[DIAG] SpeechRecognition verfügbar:', srAvailable);

		// FAB warten & klicken
		const fab = page.getByRole('button', { name: 'Mikrofon starten' });
		await expect(fab).not.toHaveClass(/opacity-50/, { timeout: 5000 });
		await fab.click();

		// 3 Sekunden warten — SR sollte in dieser Zeit entweder starten oder Fehler werfen
		await page.waitForTimeout(3000);

		// Welche UI ist sichtbar?
		const recordingOverlayVisible = await page.evaluate(() =>
			!!document.querySelector('[aria-label="Aufnahme bestätigen und senden"]')
		);
		const textInputVisible = await page.evaluate(() =>
			!!document.querySelector('[aria-label="Text eingeben"]')
		);
		const convoVisible = await page.evaluate(() =>
			!!document.querySelector('[aria-label="Antwort"]')
		);
		const errorText = await page.evaluate(() => {
			const el = document.querySelector('.text-warn');
			return el?.textContent?.trim() ?? null;
		});

		console.log('[DIAG] SR vorhanden:', srAvailable);
		console.log('[DIAG] Recording-Overlay sichtbar:', recordingOverlayVisible);
		console.log('[DIAG] Textfeld (Recording) sichtbar:', textInputVisible);
		console.log('[DIAG] Konversations-Panel sichtbar:', convoVisible);
		console.log('[DIAG] Fehlertext im UI:', errorText);
		console.log('[DIAG] client-log Events:', JSON.stringify(clientLogs, null, 2));

		// Konsolenmeldungen
		const consoleMsgs = await page.evaluate(() => (window as any).__diagConsoleLogs ?? []);
		console.log('[DIAG] Console-Logs:', consoleMsgs);

		// Nach meinem Fix: Wenn SR fehlschlägt → Textfeld im Recording-Overlay sichtbar
		if (!srAvailable) {
			expect(textInputVisible).toBe(true);
			console.log('[DIAG] ERGEBNIS: SR nicht verfügbar → Textfeld sofort sichtbar ✓');
		} else {
			// SR vorhanden aber wahrscheinlich service-not-allowed auf Linux
			// Nach Fix: Recording-Overlay bleibt offen mit Textfeld
			console.log('[DIAG] ERGEBNIS: SR vorhanden — warte auf Fehler-Fallback');
			if (recordingOverlayVisible && textInputVisible) {
				console.log('[DIAG] Fix greift: Textfeld im Recording-Overlay sichtbar ✓');
			} else if (convoVisible) {
				console.log('[DIAG] Alt-Verhalten: Konversations-Panel geöffnet');
			} else {
				console.log('[DIAG] Unbekannter Zustand');
			}
		}
	});

	test('SR-Fehler "service-not-allowed" simuliert → Textfeld sichtbar (Fix-Verifikation)', async ({ page }) => {
		// Simuliert genau was auf Linux-Desktop passiert: SR vorhanden aber wirft service-not-allowed
		await page.addInitScript(() => {
			class FailingSpeechRecognition {
				lang = '';
				continuous = false;
				interimResults = false;
				onerror?: (e: unknown) => void;
				onstart?: () => void;
				onend?: () => void;
				start() {
					this.onstart?.();
					// Simuliert Chromium auf Linux ohne Google-Keys
					setTimeout(() => {
						this.onerror?.({ error: 'service-not-allowed', message: '' });
						this.onend?.();
					}, 100);
				}
				stop() { this.onend?.(); }
			}
			(window as any).SpeechRecognition = FailingSpeechRecognition;
			(window as any).webkitSpeechRecognition = FailingSpeechRecognition;
		});

		await page.goto('/graph');
		const fab = page.getByRole('button', { name: 'Mikrofon starten' });
		await expect(fab).not.toHaveClass(/opacity-50/, { timeout: 5000 });
		await fab.click();

		// Nach SR-Fehler: Recording-Overlay mit Textfeld sichtbar (Fix)
		await expect(page.getByRole('textbox', { name: 'Text eingeben' })).toBeVisible({ timeout: 2000 });
		await expect(page.getByText('Spracherkennung nicht verfügbar')).toBeVisible();

		// Konversations-Panel sollte NICHT geöffnet worden sein
		await expect(page.getByRole('textbox', { name: 'Antwort' })).toHaveCount(0);

		// Textfeld nutzbar: Nachricht tippen und senden
		await page.route('/api/narrate', (r) => r.fulfill({ json: { reply: 'OK', wrote: false } }));
		await page.getByRole('textbox', { name: 'Text eingeben' }).fill('Test-Nachricht');
		await page.getByRole('button', { name: 'Senden', exact: true }).click();

		console.log('[DIAG] service-not-allowed Fix: Textfeld sichtbar und nutzbar ✓');
	});

	test('kein SR (Firefox-Szenario) → Textfeld sofort sichtbar', async ({ page }) => {
		// Entfernt SR komplett — simuliert Firefox
		await page.addInitScript(() => {
			delete (window as any).SpeechRecognition;
			delete (window as any).webkitSpeechRecognition;
		});

		await page.goto('/graph');
		const fab = page.getByRole('button', { name: 'Mikrofon starten' });
		await expect(fab).not.toHaveClass(/opacity-50/, { timeout: 5000 });
		await fab.click();

		// Sofort: Textfeld sichtbar, kein Warten auf SR-Timeout
		await expect(page.getByRole('textbox', { name: 'Text eingeben' })).toBeVisible({ timeout: 1000 });
		await expect(page.getByText('Spracherkennung nicht verfügbar')).toBeVisible();

		console.log('[DIAG] Kein-SR Fix: Textfeld sofort sichtbar ✓');
	});
});
