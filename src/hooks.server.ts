import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	// Some hosts/iOS need this for navigator.share
	response.headers.set('Permissions-Policy', 'web-share=(self)');
	return response;
};
