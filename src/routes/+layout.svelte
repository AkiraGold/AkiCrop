<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { isTrackpadPinch } from '#lib/utils.js';

	let { children } = $props();

	$effect(() => {
		if (typeof window === 'undefined') return;
		const onWheel = (e: WheelEvent) => {
			if (isTrackpadPinch(e)) e.preventDefault();
		};
		const onGesture = (e: Event) => e.preventDefault();
		window.addEventListener('wheel', onWheel, { passive: false, capture: true });
		document.addEventListener('gesturestart', onGesture, { passive: false });
		document.addEventListener('gesturechange', onGesture, { passive: false });
		document.addEventListener('gestureend', onGesture, { passive: false });
		return () => {
			window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
			document.removeEventListener('gesturestart', onGesture);
			document.removeEventListener('gesturechange', onGesture);
			document.removeEventListener('gestureend', onGesture);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
