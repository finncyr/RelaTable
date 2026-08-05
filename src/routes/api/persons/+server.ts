import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { personImageSrc } from '$lib/util';
import type { RequestHandler } from './$types';

// Lightweight person index for the command palette (Ctrl+K).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'unauthenticated');
	const persons = await db.person.findMany({
		where: { ownerId: locals.user.id },
		select: {
			id: true,
			name: true,
			profileImagePath: true,
			profileImageUrl: true,
			location: { select: { city: true } },
			aliases: { select: { alias: true } }
		},
		orderBy: { name: 'asc' }
	});
	return json(
		persons.map((p) => ({
			id: p.id,
			name: p.name,
			city: p.location?.city ?? null,
			image: personImageSrc(p),
			aliases: p.aliases.map((a) => a.alias)
		}))
	);
};
