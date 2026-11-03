const MAX_PREVIEW_SIZE = 2048;

export function getDownscaledDimensions(
	source: ImageBitmap | HTMLImageElement,
	maxSize: number = MAX_PREVIEW_SIZE
): { width: number; height: number } {
	const w = source.width;
	const h = source.height;
	const longest = Math.max(w, h);
	if (longest <= maxSize) return { width: w, height: h };
	const scale = maxSize / longest;
	return {
		width: Math.round(w * scale),
		height: Math.round(h * scale)
	};
}

/** Downscale for preview (max 2048 longest side). Use original blob for export. */
export async function downscaleForPreview(
	source: ImageBitmap | HTMLImageElement
): Promise<ImageBitmap> {
	const { width, height } = getDownscaledDimensions(source);
	if (source.width === width && source.height === height) {
		return source instanceof ImageBitmap ? source : await createImageBitmap(source);
	}
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(source, 0, 0, width, height);
	return createImageBitmap(canvas);
}

/** Average color of the four image edges as hex. */
export function calculateAverageEdgeColor(
	image: ImageBitmap | HTMLImageElement,
	sampleWidth: number = 20
): string {
	const w = image.width;
	const h = image.height;
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(image, 0, 0);
	const band = Math.min(sampleWidth, Math.floor(Math.min(w, h) / 4));
	let r = 0,
		g = 0,
		b = 0,
		count = 0;

	try {
		if (h > 0) {
			const top = ctx.getImageData(0, 0, w, Math.min(band, h));
			for (let i = 0; i < top.data.length; i += 4) {
				r += top.data[i];
				g += top.data[i + 1];
				b += top.data[i + 2];
				count++;
			}
		}
		if (h > band) {
			const bottom = ctx.getImageData(0, h - band, w, band);
			for (let i = 0; i < bottom.data.length; i += 4) {
				r += bottom.data[i];
				g += bottom.data[i + 1];
				b += bottom.data[i + 2];
				count++;
			}
		}
		if (w > 0) {
			const left = ctx.getImageData(0, 0, Math.min(band, w), h);
			for (let i = 0; i < left.data.length; i += 4) {
				r += left.data[i];
				g += left.data[i + 1];
				b += left.data[i + 2];
				count++;
			}
		}
		if (w > band) {
			const right = ctx.getImageData(w - band, 0, band, h);
			for (let i = 0; i < right.data.length; i += 4) {
				r += right.data[i];
				g += right.data[i + 1];
				b += right.data[i + 2];
				count++;
			}
		}
	} catch {
		return '#808080';
	}

	if (count === 0) return '#808080';
	r = Math.round(r / count);
	g = Math.round(g / count);
	b = Math.round(b / count);
	return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn(...args), ms);
	};
}

export function isTrackpadPinch(e: WheelEvent): boolean {
	return e.ctrlKey || e.metaKey;
}

export function isLikelyMouseWheel(e: WheelEvent): boolean {
	if (e.deltaMode !== 0) return true;
	return Math.abs(e.deltaX) < 1 && Math.abs(e.deltaY) >= 40;
}

export function trackpadPinchFactor(e: WheelEvent): number {
	return Math.exp(-e.deltaY * 0.0055);
}

export const MOUSE_WHEEL_ZOOM_STEP = 1.07;

export function wheelZoomFactor(e: WheelEvent): number {
	if (isTrackpadPinch(e)) return trackpadPinchFactor(e);
	if (isLikelyMouseWheel(e)) {
		return e.deltaY > 0 ? 1 / MOUSE_WHEEL_ZOOM_STEP : MOUSE_WHEEL_ZOOM_STEP;
	}
	const dy = Math.max(-40, Math.min(40, e.deltaY));
	return Math.exp(-dy * 0.004);
}

export function panAfterZoomToward(
	panX: number,
	panY: number,
	zoomFrom: number,
	zoomTo: number,
	viewX: number,
	viewY: number
): { panX: number; panY: number } {
	if (zoomFrom <= 0 || Math.abs(zoomTo - zoomFrom) < 1e-9) return { panX, panY };
	const r = zoomTo / zoomFrom;
	return {
		panX: viewX * (1 - r) + panX * r,
		panY: viewY * (1 - r) + panY * r
	};
}

export function createSmoothZoom(options: {
	get: () => number;
	set: (value: number) => void;
	onFrame?: () => void;
	ease?: number;
}) {
	let target = options.get();
	let raf = 0;
	const ease = options.ease ?? 0.2;

	function tick() {
		raf = 0;
		const cur = options.get();
		const diff = target - cur;
		if (Math.abs(diff) < 0.0015) {
			if (cur !== target) {
				options.set(target);
				options.onFrame?.();
			}
			return;
		}
		options.set(cur + diff * ease);
		options.onFrame?.();
		raf = requestAnimationFrame(tick);
	}

	return {
		getTarget: () => target,
		setTarget(value: number, immediate = false) {
			target = value;
			if (immediate) {
				if (raf) {
					cancelAnimationFrame(raf);
					raf = 0;
				}
				options.set(value);
				options.onFrame?.();
				return;
			}
			const cur = options.get();
			if (Math.abs(target - cur) >= 0.0015) {
				options.set(cur + (target - cur) * ease);
				options.onFrame?.();
			}
			if (!raf) raf = requestAnimationFrame(tick);
		},
		syncFromDisplay() {
			target = options.get();
		},
		stop() {
			if (raf) {
				cancelAnimationFrame(raf);
				raf = 0;
			}
			target = options.get();
		}
	};
}
