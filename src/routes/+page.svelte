<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { TEMPLATES, type TemplateId, type BorderType } from '#lib/types.js';
	import { downscaleForPreview, debounce } from '#lib/utils.js';
	import { getCanvasDimensions, renderCanvas } from '#lib/renderer.js';
	import {
		MAX_PREVIEW,
		CAROUSEL_DEFAULT_RATIO,
		STACK_PREVIEW_MAX,
		EXPORT_STACK_WIDTH,
		CAROUSEL_STRIP_PADDING,
		CAROUSEL_STRIP_GAP,
		ASPECT_POPUP_ROWS,
		ASPECT_POPUP_THUMB_SIZE,
		EXPORT_RESOLUTION_PRESETS,
		type AppMode
	} from '#lib/constants.js';
	import { Topbar, ExportPreview, AspectRatioPopup, NarrowImageWarning, StackView, CarouselView, CropView, Sidebar } from '#lib/components/index.js';

	// searchParams unavailable during prerender
	const appMode = $derived.by(() => {
		if (typeof window === 'undefined') return 'crop' as AppMode;
		const mode = page.url.searchParams.get('mode');
		if (mode === 'carousel') return 'carousel' as AppMode;
		if (mode === 'stack') return 'stack' as AppMode;
		return 'crop' as AppMode;
	});

	let canvasWrapEl = $state<HTMLDivElement | null>(null);
	let containerSize = $state({ width: 0, height: 0 });
	let previewImage = $state<ImageBitmap | null>(null);
	let originalBlob = $state<Blob | null>(null);
	let originalWidth = $state(0);
	let originalHeight = $state(0);
	let cropSelectedTemplateId = $state<TemplateId>('1:1');
	let carouselSelectedTemplateId = $state<TemplateId>('4:5');
	let stackSelectedTemplateId = $state<TemplateId>('1:1');
	let customRatioW = $state(16);
	let customRatioH = $state(9);
	let borderType = $state<BorderType>('auto');
	let padding = $state(0);
	let blurStrength = $state(25);
	let solidColor = $state('#3b63fb');
	let loading = $state(false);
	let importProgress = $state<{ current: number; total: number } | null>(null);
	let exportLoading = $state(false);

	let exportPreviewOpen = $state(false);
	let exportPreviewPanels = $state<{ url: string; blob: Blob }[]>([]);
	let exportPreviewKind = $state<'carousel' | 'stack' | 'crop' | null>(null);
	let exportPreviewFormat = $state<'image/png' | 'image/jpeg'>('image/png');
	let exportPreviewRegenerating = $state(false);
	let exportRegenerationVersion = $state(0);

	let aspectRatioPopupOpen = $state(false);
	let aspectPopupContentEl = $state<HTMLDivElement | null>(null);
	let aspectPopupPendingTemplateId = $state<TemplateId | null>(null);
	let aspectPopupFocusOnce = $state(false);
	let fillMode = $state<'contain' | 'cover'>('contain');

	let exportFormat = $state<'image/png' | 'image/jpeg'>('image/png');
	let exportQuality = $state(0.92);
	let exportResolutionId = $state('original');
	const exportMaxSize = $derived.by(() => {
		const preset = EXPORT_RESOLUTION_PRESETS.find((p) => p.id === exportResolutionId);
		return preset?.maxSize ?? null;
	});
	const exportFileExt = $derived(exportFormat === 'image/jpeg' ? 'jpg' : 'png');
	const exportMimeType = $derived(exportFormat);

	/** Set on the client — SSR has no navigator.share, and a $derived would stick at false. */
	let canUseShare = $state(false);

	const SHARE_PROBE_PNG = Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
		0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
	]);

	function detectCanShareFiles(): boolean {
		if (typeof window === 'undefined' || !window.isSecureContext) return false;
		if (typeof navigator.share !== 'function') return false;
		const probe = new File([SHARE_PROBE_PNG], 'akicrop.png', { type: 'image/png' });
		if (typeof navigator.canShare === 'function') {
			try {
				return navigator.canShare({ files: [probe] });
			} catch {
				return false;
			}
		}
		// Older iOS Safari: share() exists, canShare() does not — file share still works.
		return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
	}

	$effect(() => {
		canUseShare = detectCanShareFiles();
	});

	const sidebarHasImage = $derived.by(() => {
		if (appMode === 'crop') return !!previewImage;
		if (appMode === 'stack') return stackImages.length > 0;
		return !!carouselImage;
	});

	const aspectPopupImage = $derived.by(() => {
		if (appMode === 'crop') return previewImage;
		if (appMode === 'carousel') return carouselImage;
		if (appMode === 'stack' && stackImages.length > 0) return stackImages[0].preview;
		return previewImage || carouselImage;
	});

	let carouselImage = $state<ImageBitmap | null>(null);
	let carouselOriginalBlob = $state<Blob | null>(null);
	let carouselOriginalWidth = $state(0);
	let carouselOriginalHeight = $state(0);
	let carouselPanelCountOverride = $state<number | null>(null); // null = auto
	let carouselError = $state<string | null>(null);
	let carouselZoom = $state(100);
	let carouselNarrowImageWarning = $state(false);

	type StackImage = { blob: Blob; preview: ImageBitmap };
	let stackImages = $state<StackImage[]>([]);
	const currentTemplateId = $derived.by(() =>
		appMode === 'crop' ? cropSelectedTemplateId : appMode === 'carousel' ? carouselSelectedTemplateId : stackSelectedTemplateId
	);
	const template = $derived(TEMPLATES.find((t) => t.id === currentTemplateId)!);

	function getTemplateRatioFor(id: TemplateId): number {
		const t = TEMPLATES.find((x) => x.id === id);
		if (!t || t.id === 'original') return 0;
		if (t.id === 'custom') {
			const w = Math.max(0.1, customRatioW);
			const h = Math.max(0.1, customRatioH);
			return w / h;
		}
		return t.ratio;
	}

	const cropTemplateRatio = $derived.by(() => getTemplateRatioFor(cropSelectedTemplateId) || 0);
	const carouselTemplateRatio = $derived.by(() => {
		const r = getTemplateRatioFor(carouselSelectedTemplateId);
		return r > 0 ? r : CAROUSEL_DEFAULT_RATIO;
	});
	const stackTemplateRatio = $derived.by(() => getTemplateRatioFor(stackSelectedTemplateId) || 0);

	const carouselPanelRatio = $derived(carouselTemplateRatio);

	// Auto panels = floor(full-fit) - 1, clamped to 2..20
	const carouselPanelCountAuto = $derived.by(() => {
		if (!carouselImage) return 2;
		const w = carouselImage.width;
		const h = carouselImage.height;
		const r = carouselPanelRatio;
		const fit = Math.ceil(w / h * (1 / r));
		return Math.max(2, Math.min(20, fit - 1));
	});
	const carouselPanelCount = $derived.by(() => {
		const auto = carouselPanelCountAuto;
		if (carouselPanelCountOverride != null) return Math.max(2, Math.min(auto, carouselPanelCountOverride));
		return auto;
	});
	const carouselPanelDims = $derived.by(() => {
		const n = carouselPanelCount;
		if (n < 1) return { width: 0, height: 0 };
		const cw = containerSize.width;
		if (cw <= 0) return { width: 0, height: 0 };
		const availableWidth = cw - 2 * CAROUSEL_STRIP_PADDING - (n - 1) * CAROUSEL_STRIP_GAP;
		if (availableWidth <= 0) return { width: 0, height: 0 };
		const panelWidth = Math.floor(availableWidth / n);
		const panelHeight = Math.round(panelWidth / carouselPanelRatio);
		return { width: panelWidth, height: panelHeight };
	});

	const carouselZoomMin = 100;
	const carouselZoomMax = $derived.by(() => {
		if (!carouselImage || carouselPanelCount < 1) return 200;
		const dims = carouselPanelDims;
		const innerW = dims.width - 2 * padding;
		const innerH = dims.height - 2 * padding;
		if (innerW <= 0 || innerH <= 0) return 200;
		const w = carouselImage.width;
		const h = carouselImage.height;
		const n = carouselPanelCount;
		// Zoom where slice fills padded panel; nudge slightly past to avoid edge sliver
		const fillZoom = 100 * w * innerH / (n * h * innerW);
		const nudge = Math.max(0.3, fillZoom * 0.005);
		return Math.round(Math.max(100, Math.min(400, fillZoom + nudge)));
	});

	const basePreviewDims = $derived(
		previewImage
			? getCanvasDimensions(
					previewImage.width,
					previewImage.height,
					cropTemplateRatio,
					MAX_PREVIEW
				)
			: { width: 0, height: 0 }
	);
	const previewDims = $derived.by(() => {
		const base = basePreviewDims;
		if (base.width <= 0 || base.height <= 0) return base;
		const { width: cw, height: ch } = containerSize;
		if (cw <= 0 || ch <= 0) return base;
		const scale = Math.min(cw / base.width, ch / base.height, 1);
		return {
			width: Math.round(base.width * scale),
			height: Math.round(base.height * scale)
		};
	});

	$effect(() => {
		const max = carouselZoomMax;
		const min = carouselZoomMin;
		if (carouselZoom > max) carouselZoom = max;
		if (carouselZoom < min) carouselZoom = min;
	});

	$effect(() => {
		const auto = carouselPanelCountAuto;
		if (carouselPanelCountOverride != null) {
			if (carouselPanelCountOverride > auto) carouselPanelCountOverride = auto;
			if (carouselPanelCountOverride < 2) carouselPanelCountOverride = 2;
		}
	});

	// Carousel panels are slices — Original aspect is meaningless
	$effect(() => {
		if (carouselSelectedTemplateId === 'original') {
			carouselSelectedTemplateId = '4:5';
		}
	});

	$effect(() => {
		const el = canvasWrapEl;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const { width, height } = entries[0]?.contentRect ?? { width: 0, height: 0 };
			containerSize = { width: Math.floor(width), height: Math.floor(height) };
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	async function decodeImageFile(file: File): Promise<{ blob: Blob; bitmap: ImageBitmap } | null> {
		if (!file.type.startsWith('image/')) return null;
		const blob = await file.arrayBuffer().then((b) => new Blob([b], { type: file.type }));
		const bitmap = await createImageBitmap(blob);
		return { blob, bitmap };
	}

	async function handleFile(file: File) {
		if (!file.type.startsWith('image/')) return;
		if (appMode === 'stack') {
			await importStackFiles([file]);
			return;
		}
		loading = true;
		importProgress = { current: 0, total: 1 };
		if (appMode === 'carousel') carouselError = null;
		try {
			const decoded = await decodeImageFile(file);
			if (!decoded) return;
			const { blob, bitmap } = decoded;
			importProgress = { current: 1, total: 1 };
			if (appMode === 'crop') {
				originalBlob = blob;
				originalWidth = bitmap.width;
				originalHeight = bitmap.height;
				previewImage = await downscaleForPreview(bitmap);
				if (bitmap !== previewImage) bitmap.close();
				aspectRatioPopupOpen = true;
			} else {
				carouselOriginalBlob = blob;
				carouselOriginalWidth = bitmap.width;
				carouselOriginalHeight = bitmap.height;
				carouselImage = await downscaleForPreview(bitmap);
				if (bitmap !== carouselImage) bitmap.close();
				if (carouselOriginalWidth / carouselOriginalHeight < 8 / 5) {
					carouselNarrowImageWarning = true;
				}
			}
		} catch (e) {
			if (appMode === 'carousel') {
				carouselError = e instanceof Error ? e.message : 'Failed to load image';
			}
		} finally {
			loading = false;
			importProgress = null;
		}
	}

	async function importStackFiles(files: File[]) {
		const images = files.filter((f) => f.type.startsWith('image/'));
		if (!images.length) return;
		loading = true;
		importProgress = { current: 0, total: images.length };
		const startingEmpty = stackImages.length === 0;
		try {
			for (let i = 0; i < images.length; i++) {
				try {
					const decoded = await decodeImageFile(images[i]);
					if (!decoded) {
						importProgress = { current: i + 1, total: images.length };
						continue;
					}
					const { blob, bitmap } = decoded;
					const preview = await downscaleForPreview(bitmap);
					if (bitmap !== preview) bitmap.close();
					stackImages = [...stackImages, { blob, preview }];
				} catch (err) {
					console.error('Failed to import image:', err);
				}
				importProgress = { current: i + 1, total: images.length };
			}
			if (startingEmpty && stackImages.length > 0) aspectRatioPopupOpen = true;
		} finally {
			loading = false;
			importProgress = null;
		}
	}

	function handleStackFiles(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		if (!files.length) return;
		void importStackFiles(files);
	}

	function removeStackImage(index: number) {
		stackImages = stackImages.filter((_, i) => i !== index);
	}

	function clearStack() {
		stackImages = [];
	}

	function clearCropImage() {
		previewImage = null;
		originalBlob = null;
		originalWidth = 0;
		originalHeight = 0;
	}

	function clearCarouselImage() {
		carouselImage = null;
		carouselOriginalBlob = null;
		carouselOriginalWidth = 0;
		carouselOriginalHeight = 0;
		carouselNarrowImageWarning = false;
		carouselError = null;
	}

	function reorderStack(from: number, to: number) {
		if (from === to || from < 0 || to < 0 || from >= stackImages.length || to >= stackImages.length) return;
		const arr = [...stackImages];
		const [item] = arr.splice(from, 1);
		arr.splice(to, 0, item);
		stackImages = arr;
	}

	function dismissCarouselNarrowWarning() {
		carouselNarrowImageWarning = false;
	}

	function switchToCropModeWithCarouselImage() {
		if (!carouselImage || !carouselOriginalBlob) return;
		originalBlob = carouselOriginalBlob;
		originalWidth = carouselOriginalWidth;
		originalHeight = carouselOriginalHeight;
		previewImage = carouselImage;
		carouselImage = null;
		carouselOriginalBlob = null;
		carouselNarrowImageWarning = false;
		goto('?mode=crop');
	}

	function onInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) handleFile(file);
		input.value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		const list = e.dataTransfer?.files;
		if (!list?.length) return;
		if (appMode === 'stack') {
			void importStackFiles(Array.from(list));
			return;
		}
		void handleFile(list[0]);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	async function generateStackPanels(): Promise<{ url: string; blob: Blob }[]> {
		if (!stackImages.length) return [];
		const cellWidth = EXPORT_STACK_WIDTH;
		const firstPreviewDims = getCanvasDimensions(
			stackImages[0].preview.width,
			stackImages[0].preview.height,
			stackTemplateRatio,
			STACK_PREVIEW_MAX
		);
		const scale = firstPreviewDims.width > 0 ? cellWidth / firstPreviewDims.width : 1;
		const exportPadding = Math.round(padding * scale);
		const mime = exportFormat === 'image/jpeg' ? 'image/jpeg' : 'image/png';
		const quality = exportFormat === 'image/jpeg' ? exportQuality : 1;
		const panels: { url: string; blob: Blob }[] = [];
		for (const item of stackImages) {
			const bitmap = await createImageBitmap(item.blob);
			const r = stackTemplateRatio > 0 ? stackTemplateRatio : bitmap.width / bitmap.height;
			const w = cellWidth;
			const h = Math.round(cellWidth / r);
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			renderCanvas(c, {
				image: bitmap,
				templateRatio: r,
				padding: exportPadding,
				borderType,
				blurStrength,
				solidColor,
				width: w,
				height: h,
				fillMode
			});
			bitmap.close();
			const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, quality));
			if (blob) panels.push({ url: URL.createObjectURL(blob), blob });
		}
		return panels;
	}

	async function generateCarouselPanels(): Promise<{ url: string; blob: Blob }[]> {
		if (!carouselOriginalBlob || !carouselImage || carouselPanelCount < 1) return [];
		const bitmap = await createImageBitmap(carouselOriginalBlob);
		const w = bitmap.width;
		const h = bitmap.height;
		const n = carouselPanelCount;
		const zoomFactor = carouselZoom / 100;
		const viewWidth = zoomFactor <= 1 ? w : Math.max(0.001, w / zoomFactor);
		const viewLeft = zoomFactor <= 1 ? 0 : (w - viewWidth) / 2;
		const sliceW = viewWidth / n;
		const panels: { url: string; blob: Blob }[] = [];
		const panelRatio = carouselTemplateRatio;
		const exportDims = getCanvasDimensions(sliceW, h, panelRatio, exportMaxSize ?? undefined);
		const scale = exportDims.width / carouselPanelDims.width;
		const exportPadding = Math.round(padding * scale);
		const mime = exportFormat === 'image/jpeg' ? 'image/jpeg' : 'image/png';
		const quality = exportFormat === 'image/jpeg' ? exportQuality : 1;
		for (let i = 0; i < n; i++) {
			const sx = viewLeft + i * sliceW;
			const sliceAspect = sliceW / h;
			const fillMode = sliceAspect >= panelRatio ? 'contain' : 'cover';
			const c = document.createElement('canvas');
			c.width = exportDims.width;
			c.height = exportDims.height;
			renderCanvas(c, {
				image: bitmap,
				templateRatio: panelRatio,
				padding: exportPadding,
				borderType,
				blurStrength,
				solidColor,
				width: exportDims.width,
				height: exportDims.height,
				sourceRect: { sx, sy: 0, sw: sliceW, sh: h },
				fillMode,
				zoom: 1
			});
			const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, quality));
			if (blob) panels.push({ url: URL.createObjectURL(blob), blob });
		}
		bitmap.close();
		return panels;
	}

	async function generateCropPanels(): Promise<{ url: string; blob: Blob }[]> {
		if (!originalBlob || !previewImage) return [];
		const bitmap = await createImageBitmap(originalBlob);
		const ratio = cropTemplateRatio > 0 ? cropTemplateRatio : bitmap.width / bitmap.height;
		const dims = getCanvasDimensions(
			bitmap.width,
			bitmap.height,
			ratio,
			exportMaxSize ?? undefined
		);
		const scale = dims.width / previewDims.width;
		const exportPadding = Math.round(padding * scale);
		const exportCanvas = document.createElement('canvas');
		exportCanvas.width = dims.width;
		exportCanvas.height = dims.height;
		renderCanvas(exportCanvas, {
			image: bitmap,
			templateRatio: ratio,
			padding: exportPadding,
			borderType,
			blurStrength,
			solidColor,
			width: dims.width,
			height: dims.height
		});
		bitmap.close();
		const mime = exportFormat === 'image/jpeg' ? 'image/jpeg' : 'image/png';
		const quality = exportFormat === 'image/jpeg' ? exportQuality : 1;
		const blob = await new Promise<Blob | null>((res) => exportCanvas.toBlob(res, mime, quality));
		if (!blob) return [];
		return [{ url: URL.createObjectURL(blob), blob }];
	}

	async function regenerateExportPanels() {
		if (exportPreviewKind !== 'stack' && exportPreviewKind !== 'carousel' && exportPreviewKind !== 'crop')
			return;
		exportPreviewPanels.forEach((p) => URL.revokeObjectURL(p.url));
		exportPreviewRegenerating = true;
		const version = ++exportRegenerationVersion;
		try {
			const panels =
				exportPreviewKind === 'stack'
					? await generateStackPanels()
					: exportPreviewKind === 'carousel'
						? await generateCarouselPanels()
						: await generateCropPanels();
			if (version !== exportRegenerationVersion) {
				panels.forEach((p) => URL.revokeObjectURL(p.url));
				return;
			}
			exportPreviewPanels = panels;
			exportPreviewFormat = exportFormat;
		} catch (e) {
			if (version === exportRegenerationVersion) console.error('Regenerate export failed:', e);
		} finally {
			if (version === exportRegenerationVersion) exportPreviewRegenerating = false;
		}
	}

	async function download() {
		if (appMode === 'stack') {
			if (!stackImages.length) return;
			exportLoading = true;
			try {
				const panels = await generateStackPanels();
				exportPreviewKind = 'stack';
				exportPreviewPanels = panels;
				exportPreviewFormat = exportFormat;
				exportPreviewOpen = true;
			} catch (e) {
				console.error('Stack export failed:', e);
			}
			exportLoading = false;
			return;
		}
		if (appMode === 'carousel') {
			if (!carouselOriginalBlob || !carouselImage || carouselPanelCount < 1) return;
			exportLoading = true;
			try {
				const panels = await generateCarouselPanels();
				exportPreviewKind = 'carousel';
				exportPreviewPanels = panels;
				exportPreviewFormat = exportFormat;
				exportPreviewOpen = true;
			} catch (e) {
				console.error('Carousel export failed:', e);
			}
			exportLoading = false;
			return;
		}
		if (!originalBlob || !previewImage) return;
		exportLoading = true;
		try {
			const panels = await generateCropPanels();
			exportPreviewKind = 'crop';
			exportPreviewPanels = panels;
			exportPreviewFormat = exportFormat;
			exportPreviewOpen = true;
		} catch (e) {
			console.error('Crop export failed:', e);
		}
		exportLoading = false;
	}

	function closeExportPreview() {
		exportPreviewPanels.forEach((p) => URL.revokeObjectURL(p.url));
		exportPreviewPanels = [];
		exportPreviewOpen = false;
		exportPreviewKind = null;
	}

	function exportFilenamePrefix() {
		if (exportPreviewKind === 'stack') return 'akicrop-stack';
		if (exportPreviewKind === 'carousel') return 'akicrop-panel';
		return 'akicrop';
	}

	function canShareFileList(files: File[]): boolean {
		if (typeof window === 'undefined' || !window.isSecureContext) return false;
		if (typeof navigator.share !== 'function') return false;
		if (typeof navigator.canShare === 'function') {
			try {
				return navigator.canShare({ files });
			} catch {
				return false;
			}
		}
		return canUseShare;
	}

	function downloadExportPreviewPanels() {
		const prefix = exportFilenamePrefix();
		const ext = exportPreviewFormat === 'image/jpeg' ? 'jpg' : 'png';
		const delay = 300;
		exportPreviewPanels.forEach((p, i) => {
			const name =
				exportPreviewPanels.length === 1 ? `${prefix}.${ext}` : `${prefix}-${i + 1}.${ext}`;
			setTimeout(() => triggerDownloadFallback(p.blob, name), i * delay);
		});
	}

	async function shareExportPreviewPanels() {
		const prefix = exportFilenamePrefix();
		const ext = exportPreviewFormat === 'image/jpeg' ? 'jpg' : 'png';
		const mime = exportPreviewFormat;
		const files = exportPreviewPanels.map(
			(p, i) =>
				new File(
					[p.blob],
					exportPreviewPanels.length === 1 ? `${prefix}.${ext}` : `${prefix}-${i + 1}.${ext}`,
					{ type: mime }
				)
		);
		try {
			if (!canShareFileList(files)) {
				throw new Error('Share is not supported in this browser.');
			}
			await navigator.share({ files, title: 'AkiCrop', text: 'Exported image' });
		} catch (e) {
			const err = e as Error;
			if (err.name === 'AbortError') return;
			alert('Share failed: ' + (err.message || String(e)));
		}
	}

	async function shareExportPreviewPanel(panel: { url: string; blob: Blob }, index: number) {
		try {
			const ext = exportPreviewFormat === 'image/jpeg' ? 'jpg' : 'png';
			const prefix = exportFilenamePrefix();
			const file = new File(
				[panel.blob],
				exportPreviewPanels.length === 1 ? `${prefix}.${ext}` : `${prefix}-${index + 1}.${ext}`,
				{ type: exportPreviewFormat }
			);
			if (!canShareFileList([file])) return;
			await navigator.share({ files: [file], title: 'AkiCrop', text: 'Exported image' });
		} catch (e) {
			if ((e as Error).name !== 'AbortError') alert('Share failed: ' + ((e as Error).message || String(e)));
		}
	}


	function triggerDownloadFallback(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.getElementById('download-link') as HTMLAnchorElement;
		if (a) {
			a.href = url;
			a.download = filename;
			a.click();
		} else {
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.rel = 'noopener';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
		setTimeout(() => URL.revokeObjectURL(url), 500);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (exportPreviewOpen) {
				closeExportPreview();
				return;
			}
			if (aspectRatioPopupOpen) {
				closeAspectPopup();
				return;
			}
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			download();
		}
	}

	function getRatioForTemplateId(id: TemplateId): number {
		if (id === 'original') return 0;
		if (id === 'custom') {
			const w = Math.max(0.1, customRatioW);
			const h = Math.max(0.1, customRatioH);
			return w / h;
		}
		const t = TEMPLATES.find((x) => x.id === id);
		return t ? t.ratio : 1;
	}

	function setTemplate(id: TemplateId) {
		if (appMode === 'crop') cropSelectedTemplateId = id;
		else if (appMode === 'carousel') carouselSelectedTemplateId = id;
		else stackSelectedTemplateId = id;
	}

	function openAspectPopup() {
		aspectPopupPendingTemplateId = currentTemplateId;
		const values = getPresetRatioValues(currentTemplateId);
		if (values) {
			customRatioW = values.w;
			customRatioH = values.h;
		} else if (currentTemplateId === 'original') {
			const img = aspectPopupImage;
			if (img) {
				customRatioW = img.width;
				customRatioH = img.height;
			}
		}
		aspectPopupFocusOnce = true;
		aspectRatioPopupOpen = true;
	}

	function closeAspectPopup() {
		aspectRatioPopupOpen = false;
		aspectPopupPendingTemplateId = null;
	}

	function getPresetRatioValues(id: TemplateId): { w: number; h: number } | null {
		const map: Record<string, { w: number; h: number }> = {
			'1:1': { w: 1, h: 1 },
			'4:5': { w: 4, h: 5 },
			'9:16': { w: 9, h: 16 },
			'16:9': { w: 16, h: 9 },
			'1.91:1': { w: 1.91, h: 1 },
			'3:2': { w: 3, h: 2 },
			'2:3': { w: 2, h: 3 }
		};
		return map[id] ?? null;
	}

	function getTemplateFromCustomRatio(): TemplateId {
		const w = Math.max(0.1, customRatioW);
		const h = Math.max(0.1, customRatioH);
		const r = w / h;
		const tol = 0.02;
		for (const t of TEMPLATES) {
			if (t.id === 'original' || t.id === 'custom') continue;
			if (Math.abs(t.ratio - r) <= tol) return t.id;
		}
		return 'custom';
	}

	function selectAspectAndClose(id: TemplateId) {
		setTemplate(id);
		closeAspectPopup();
	}

	function onAspectThumbClick(id: TemplateId) {
		const container = aspectPopupContentEl;
		const scrollTop = container?.scrollTop ?? 0;
		aspectPopupPendingTemplateId = id;
		const values = getPresetRatioValues(id);
		if (values) {
			customRatioW = values.w;
			customRatioH = values.h;
		} else if (id === 'original') {
			const img = aspectPopupImage;
			if (img) {
				customRatioW = img.width;
				customRatioH = img.height;
			}
		}
		requestAnimationFrame(() => {
			if (container) container.scrollTop = scrollTop;
		});
	}

	function onAspectThumbDblClick(id: TemplateId) {
		setTemplate(id);
		const values = getPresetRatioValues(id);
		if (values) {
			customRatioW = values.w;
			customRatioH = values.h;
		} else if (id === 'original') {
			const img = aspectPopupImage;
			if (img) {
				customRatioW = img.width;
				customRatioH = img.height;
			}
		}
		closeAspectPopup();
	}

	function confirmAspectSelection() {
		setTemplate(getTemplateFromCustomRatio());
		closeAspectPopup();
	}

	function setBorderType(type: BorderType) {
		borderType = type;
	}

	let sliderActive = $state<'padding' | 'blur' | 'zoom' | null>(null);
	function setSliderActive(id: 'padding' | 'blur' | 'zoom' | null) {
		sliderActive = id;
	}

	// Lock page scroll / iOS rubber-band
	$effect(() => {
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		html.style.overflow = 'hidden';
		html.style.overscrollBehavior = 'none';
		body.style.overflow = 'hidden';
		body.style.overscrollBehavior = 'none';
		return () => {
			html.style.overflow = '';
			html.style.overscrollBehavior = '';
			body.style.overflow = '';
			body.style.overscrollBehavior = '';
		};
	});

	$effect(() => {
		if (!aspectRatioPopupOpen || !aspectPopupContentEl) return;
		const img = aspectPopupImage;
		if (!img) return;
		const container = aspectPopupContentEl;
		const scrollTop = container.scrollTop;
		const canvases = container.querySelectorAll<HTMLCanvasElement>('[data-template-id]');
		canvases.forEach((canvas) => {
			const id = canvas.getAttribute('data-template-id') as TemplateId | null;
			if (!id) return;
			const ratio = getRatioForTemplateId(id);
			const dims = getCanvasDimensions(img.width, img.height, ratio, ASPECT_POPUP_THUMB_SIZE);
			if (dims.width <= 0 || dims.height <= 0) return;
			renderCanvas(canvas, {
				image: img,
				templateRatio: ratio,
				padding: 0,
				borderType,
				blurStrength,
				solidColor,
				width: dims.width,
				height: dims.height,
				fillMode
			});
		});
		requestAnimationFrame(() => {
			container.scrollTop = scrollTop;
		});
		if (aspectPopupFocusOnce) {
			aspectPopupFocusOnce = false;
			setTimeout(() => {
				const firstBtn = aspectPopupContentEl?.querySelector<HTMLButtonElement>('.aspect-popup-thumb-btn');
				firstBtn?.focus();
			}, 0);
		}
	});

</script>

<svelte:window
	onkeydown={onKeydown}
	onpointerup={() => setSliderActive(null)}
></svelte:window>

<a id="download-link" class="download-link" href="#" download> </a>
<div class="app">
	<Topbar
		appMode={appMode}
		exportLoading={exportLoading}
		canExport={appMode === 'crop' ? !!previewImage : appMode === 'stack' ? stackImages.length > 0 : !!carouselImage}
		onExport={download}
	/>

	<div class="workspace">
		<div
			class="canvas-area"
			ondrop={onDrop}
			ondragover={onDragOver}
			role="region"
			aria-label={appMode === 'crop' ? 'Canvas' : appMode === 'stack' ? 'Stack' : 'Carousel'}
		>
			{#if appMode === 'crop'}
				<CropView
					bind:viewportEl={canvasWrapEl}
					previewImage={previewImage}
					containerSize={containerSize}
					templateRatio={cropTemplateRatio}
					padding={padding}
					borderType={borderType}
					blurStrength={blurStrength}
					solidColor={solidColor}
					fillMode={fillMode}
					onFile={onInputChange}
				/>
			{:else if appMode === 'stack'}
				<StackView
					bind:viewportEl={canvasWrapEl}
					stackImages={stackImages}
					containerSize={containerSize}
					templateRatio={stackTemplateRatio}
					padding={padding}
					borderType={borderType}
					blurStrength={blurStrength}
					solidColor={solidColor}
					fillMode={fillMode}
					onStackFiles={handleStackFiles}
					removeStackImage={removeStackImage}
					clearStack={clearStack}
					reorderStack={reorderStack}
				/>
			{:else}
				<CarouselView
					bind:viewportEl={canvasWrapEl}
					carouselImage={carouselImage}
					containerSize={containerSize}
					carouselPanelCount={carouselPanelCount}
					carouselPanelDims={carouselPanelDims}
					carouselPanelRatio={carouselPanelRatio}
					carouselZoom={carouselZoom}
					padding={padding}
					borderType={borderType}
					blurStrength={blurStrength}
					solidColor={solidColor}
					carouselError={carouselError}
					onFile={onInputChange}
				/>
			{/if}

			{#if loading || exportLoading}
				<div
					class="spinner-overlay"
					role="status"
					aria-live="polite"
					aria-label={exportLoading ? 'Exporting' : 'Importing images'}
				>
					<div class="spinner" aria-hidden="true"></div>
					{#if loading && importProgress}
						<p class="spinner-label">
							{#if importProgress.total > 1}
								Importing {importProgress.current} / {importProgress.total}
							{:else}
								Importing…
							{/if}
						</p>
					{:else if exportLoading}
						<p class="spinner-label">Exporting…</p>
					{/if}
				</div>
			{/if}
		</div>

		<Sidebar
			appMode={appMode}
			disabled={!sidebarHasImage}
			currentTemplateId={currentTemplateId}
			onSetTemplate={setTemplate}
			onOpenAspectPopup={openAspectPopup}
			showCropRemoveImage={!!previewImage}
			showCarouselRemoveImage={!!carouselImage}
			onClearCropImage={clearCropImage}
			onClearCarouselImage={clearCarouselImage}
			fillMode={fillMode}
			onFillModeContain={() => fillMode = 'contain'}
			onFillModeCover={() => fillMode = 'cover'}
			bind:customRatioW
			bind:customRatioH
			showCustomRatio={currentTemplateId === 'custom'}
			borderType={borderType}
			onSetBorderType={setBorderType}
			bind:padding
			sliderActive={sliderActive}
			onSetSliderActive={setSliderActive}
			carouselPanelCountOverride={carouselPanelCountOverride}
			carouselPanelCountAuto={carouselPanelCountAuto}
			carouselPanelCount={carouselPanelCount}
			onCarouselPanelCountOverride={(v) => carouselPanelCountOverride = v}
			bind:carouselZoom
			carouselZoomMin={carouselZoomMin}
			carouselZoomMax={carouselZoomMax}
			bind:blurStrength
			bind:solidColor
		/>
	</div>

	<ExportPreview
		open={exportPreviewOpen}
		kind={exportPreviewKind}
		panels={exportPreviewPanels}
		canUseShare={canUseShare}
		exportFormat={exportFormat}
		onSetExportFormat={(f) => exportFormat = f}
		bind:exportQuality
		exportResolutionId={exportResolutionId}
		onSetExportResolutionId={(id) => exportResolutionId = id}
		resolutionPresets={EXPORT_RESOLUTION_PRESETS}
		onExportOptionsChange={regenerateExportPanels}
		regenerating={exportPreviewRegenerating}
		onClose={closeExportPreview}
		onShareAll={shareExportPreviewPanels}
		onDownloadAll={downloadExportPreviewPanels}
		onSharePanel={shareExportPreviewPanel}
		onDownloadPanel={(panel, i) => {
			const prefix = exportFilenamePrefix();
			const ext = exportPreviewFormat === 'image/jpeg' ? 'jpg' : 'png';
			const name =
				exportPreviewPanels.length === 1 ? `${prefix}.${ext}` : `${prefix}-${i + 1}.${ext}`;
			triggerDownloadFallback(panel.blob, name);
		}}
	/>

	<AspectRatioPopup
		open={aspectRatioPopupOpen}
		fillMode={fillMode}
		bind:customRatioW
		bind:customRatioH
		selectedTemplateId={currentTemplateId}
		aspectPopupPendingTemplateId={aspectPopupPendingTemplateId}
		onClose={closeAspectPopup}
		onFillModeContain={() => fillMode = 'contain'}
		onFillModeCover={() => fillMode = 'cover'}
		onAspectThumbClick={onAspectThumbClick}
		onAspectThumbDblClick={onAspectThumbDblClick}
		onConfirm={confirmAspectSelection}
		onContentEl={(el) => aspectPopupContentEl = el}
	/>

	<NarrowImageWarning
		open={carouselNarrowImageWarning}
		onContinue={dismissCarouselNarrowWarning}
		onSwitchToCrop={switchToCropModeWithCarouselImage}
	/>
</div>

<style>
	.download-link {
		position: absolute;
		width: 0;
		height: 0;
		opacity: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.app {
		height: 100vh;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg-app);
		overflow: hidden;
	}

	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: row;
	}

	.canvas-area {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-app);
		position: relative;
	}

	.spinner-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		z-index: 20;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--adobe-blue);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner-label {
		margin: 0;
		font-size: var(--font-size-label);
		font-weight: 500;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 767px) {
		.workspace {
			flex-direction: column;
		}
	}
</style>
