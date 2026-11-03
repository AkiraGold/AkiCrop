<script lang="ts">
	import { getCanvasDimensions, renderCanvas } from '#lib/renderer.js';
	import {
		createSmoothZoom,
		debounce,
		isLikelyMouseWheel,
		isTrackpadPinch,
		panAfterZoomToward,
		wheelZoomFactor
	} from '#lib/utils.js';
	import { STACK_PREVIEW_MAX, STACK_ZOOM_MIN, STACK_ZOOM_MAX, STACK_ZOOM_STEP } from '#lib/constants.js';
	import type { BorderType } from '#lib/types.js';

	interface StackImage {
		blob: Blob;
		preview: ImageBitmap;
	}

	const SWIPE_THRESHOLD = 60;
	const SWIPE_DRAG_CLAMP = 0.4;
	const SWIPE_ANIM_MS = 280;
	const WHEEL_NAV_THRESHOLD = 100;
	const WHEEL_NAV_COOLDOWN_MS = 380;
	const LIST_NARROW_MQ = '(max-width: 767px)';
	const LIST_COLUMNS_MIN = 1;
	const LIST_COLUMNS_MAX = 4;
	const LIST_COLUMNS_PHONE_MAX = 2;
	const LIST_GRID_GAP = 12;
	const LIST_GRID_PAD = 32;
	const LIST_NEXT_ROW_PEEK = 1 / 3;
	/** Comfortable card width for auto column count; peek rule still sets the floor. */
	const LIST_TARGET_COL_WIDTH = 400;

	interface Props {
		viewportEl?: HTMLDivElement | null;
		stackImages: StackImage[];
		containerSize: { width: number; height: number };
		templateRatio: number;
		padding: number;
		borderType: BorderType;
		blurStrength: number;
		solidColor: string;
		fillMode: 'contain' | 'cover';
		onStackFiles: (e: Event) => void;
		removeStackImage: (index: number) => void;
		clearStack: () => void;
		reorderStack: (from: number, to: number) => void;
	}
	let {
		viewportEl = $bindable(),
		stackImages,
		containerSize,
		templateRatio,
		padding,
		borderType,
		blurStrength,
		solidColor,
		fillMode,
		onStackFiles,
		removeStackImage,
		clearStack,
		reorderStack
	}: Props = $props();

	let stackViewMode = $state<'list' | 'story'>('list');
	let stackStoryIndex = $state(0);
	let stackZoom = $state(1);
	let stackPanX = $state(0);
	let stackPanY = $state(0);
	let stackIsPanning = $state(false);
	let stackPanPointerStart = $state<{ x: number; y: number; panX: number; panY: number } | null>(null);
	let stackListEl = $state<HTMLDivElement | null>(null);
	let stackScrollEl = $state<HTMLDivElement | null>(null);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let listHoverIndex = $state<number | null>(null);
	let lastDragPoint = { x: 0, y: 0 };
	let stackFileInputEl = $state<HTMLInputElement | null>(null);
	let stackStoryCanvasEl = $state<HTMLCanvasElement | null>(null);
	let stackSwipeCanvasLeft = $state<HTMLCanvasElement | null>(null);
	let stackSwipeCanvasCenter = $state<HTMLCanvasElement | null>(null);
	let stackSwipeCanvasRight = $state<HTMLCanvasElement | null>(null);
	let stackSwipeDragOffset = $state(0);
	let stackSwipePointerStart = $state<{ x: number; startOffset: number } | null>(null);
	let stackSwipeAnimating = $state(false);
	let stackSwipeAnimRaf = 0;
	let stackGestureMode = $state<'slide' | 'zoom'>('slide');
	let stackPinchActive = $state(false);
	let stackPinchInitialDist = 0;
	let stackPinchInitialZoom = 1;
	let stackPinchOriginX = 0;
	let stackPinchOriginY = 0;
	let stackPinchStartPanX = 0;
	let stackPinchStartPanY = 0;
	let wheelNavAccum = 0;
	let wheelNavCooldownUntil = 0;
	let narrowListUi = $state(
		typeof window !== 'undefined' ? window.matchMedia(LIST_NARROW_MQ).matches : false
	);
	let touchUi = $state(
		typeof window !== 'undefined'
			? window.matchMedia('(hover: none), (pointer: coarse)').matches
			: false
	);
	let listColumns = $state(2);
	let listColumnsManual = false;
	let listColumnsAutoRatio = NaN;

	const stackStoryCurrentItem = $derived(
		stackImages.length > 0 ? stackImages[stackStoryIndex] ?? stackImages[0] : null
	);

	const listColumnsCap = $derived(narrowListUi ? LIST_COLUMNS_PHONE_MAX : LIST_COLUMNS_MAX);
	const effectiveListColumns = $derived(
		Math.max(LIST_COLUMNS_MIN, Math.min(listColumnsCap, listColumns))
	);
	function listFrameRatio(): number {
		if (templateRatio > 0) return templateRatio;
		const first = stackImages[0]?.preview;
		if (first && first.height > 0) return first.width / first.height;
		return 1;
	}

	function computeDefaultListColumns(
		viewportW: number,
		viewportH: number,
		ratio: number,
		imageCount: number
	): number {
		const innerW = Math.max(1, viewportW - LIST_GRID_PAD);
		const innerH = Math.max(1, viewportH - LIST_GRID_PAD);
		const r = ratio > 0 ? ratio : 1;
		const maxColW = (innerH * r) / (1 + LIST_NEXT_ROW_PEEK);
		const minForPeek =
			maxColW > 0
				? Math.ceil((innerW + LIST_GRID_GAP) / (maxColW + LIST_GRID_GAP))
				: 2;
		const byTarget = Math.max(
			1,
			Math.round((innerW + LIST_GRID_GAP) / (LIST_TARGET_COL_WIDTH + LIST_GRID_GAP))
		);
		const denser = Math.min(LIST_COLUMNS_MAX, byTarget, Math.max(1, imageCount));
		return Math.max(LIST_COLUMNS_MIN, Math.min(LIST_COLUMNS_MAX, Math.max(minForPeek, denser)));
	}

	function listColumnsIn() {
		listColumnsManual = true;
		listColumns = Math.min(listColumnsCap, listColumns + 1);
	}
	function listColumnsOut() {
		listColumnsManual = true;
		listColumns = Math.max(LIST_COLUMNS_MIN, listColumns - 1);
	}

	function setStackBrowseMode(mode: 'list' | 'grid' | 'story') {
		if (mode === 'story') {
			stackViewMode = 'story';
			return;
		}
		stackViewMode = 'list';
		listColumnsManual = true;
		listColumns = mode === 'grid' ? LIST_COLUMNS_PHONE_MAX : 1;
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia(LIST_NARROW_MQ);
		const touchMq = window.matchMedia('(hover: none), (pointer: coarse)');
		const sync = () => {
			narrowListUi = mq.matches;
		};
		const syncTouch = () => {
			touchUi = touchMq.matches;
		};
		sync();
		syncTouch();
		mq.addEventListener('change', sync);
		touchMq.addEventListener('change', syncTouch);
		return () => {
			mq.removeEventListener('change', sync);
			touchMq.removeEventListener('change', syncTouch);
		};
	});

	$effect(() => {
		if (!narrowListUi) return;
		if (!listColumnsManual) listColumns = 1;
		else if (listColumns > LIST_COLUMNS_PHONE_MAX) listColumns = LIST_COLUMNS_PHONE_MAX;
	});

	$effect(() => {
		if (narrowListUi) return;
		const r = listFrameRatio();
		const w = containerSize.width;
		const h = containerSize.height;
		const count = stackImages.length;
		if (w <= 0 || h <= 0) return;
		if (listColumnsManual && Math.abs(r - listColumnsAutoRatio) < 1e-9) return;
		listColumnsManual = false;
		listColumnsAutoRatio = r;
		listColumns = computeDefaultListColumns(w, h, r, count);
	});

	function getTouchDist(touches: TouchList): number {
		if (touches.length < 2) return 0;
		return Math.hypot(
			touches[1].clientX - touches[0].clientX,
			touches[1].clientY - touches[0].clientY
		);
	}

	function setStackGestureMode(mode: 'slide' | 'zoom') {
		stackGestureMode = mode;
	}

	function getStackSwipeDims(item: StackImage) {
		if (!item || containerSize.width <= 0 || containerSize.height <= 0)
			return { width: 0, height: 0 };
		const base = getCanvasDimensions(
			item.preview.width,
			item.preview.height,
			templateRatio,
			undefined
		);
		const scale = Math.min(
			containerSize.width / base.width,
			containerSize.height / base.height,
			1
		);
		return {
			width: Math.round(base.width * scale),
			height: Math.round(base.height * scale)
		};
	}

	const stackStoryDims = $derived.by(() =>
		stackStoryCurrentItem ? getStackSwipeDims(stackStoryCurrentItem) : { width: 0, height: 0 }
	);
	const stackCanPan = $derived(stackZoom > 1.001);
	const stackDragPans = $derived(stackGestureMode === 'zoom' || stackCanPan);
	const stackPanTransform = $derived(`translate(${stackPanX}px, ${stackPanY}px)`);
	const stackScaleTransform = $derived(`scale(${stackZoom})`);

	function clampStackPan() {
		const cW = stackStoryDims.width * stackZoom;
		const cH = stackStoryDims.height * stackZoom;
		const halfX = Math.max(0, (cW - containerSize.width) / 2);
		const halfY = Math.max(0, (cH - containerSize.height) / 2);
		stackPanX = Math.max(-halfX, Math.min(halfX, stackPanX));
		stackPanY = Math.max(-halfY, Math.min(halfY, stackPanY));
	}

	function resetStackPan() {
		stackPanX = 0;
		stackPanY = 0;
	}

	function easeOutCubic(t: number) {
		return 1 - (1 - t) ** 3;
	}

	function animateSwipeOffset(to: number, onDone?: () => void) {
		cancelAnimationFrame(stackSwipeAnimRaf);
		const from = stackSwipeDragOffset;
		const start = performance.now();
		stackSwipeAnimating = true;
		stackSwipePointerStart = null;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / SWIPE_ANIM_MS);
			stackSwipeDragOffset = from + (to - from) * easeOutCubic(t);
			if (t < 1) {
				stackSwipeAnimRaf = requestAnimationFrame(tick);
				return;
			}
			stackSwipeDragOffset = to;
			stackSwipeAnimating = false;
			stackSwipeAnimRaf = 0;
			onDone?.();
		};
		stackSwipeAnimRaf = requestAnimationFrame(tick);
	}

	function commitSwipeTo(dir: -1 | 1) {
		const w = containerSize.width;
		if (w <= 0) return;
		animateSwipeOffset(dir * w, () => {
			stackStoryIndex = Math.max(0, Math.min(stackImages.length - 1, stackStoryIndex - dir));
			resetStackPan();
			stackSwipeDragOffset = 0;
		});
	}

	function finishSwipeGesture(offset: number) {
		if (offset > SWIPE_THRESHOLD && stackStoryIndex > 0) commitSwipeTo(1);
		else if (offset < -SWIPE_THRESHOLD && stackStoryIndex < stackImages.length - 1) commitSwipeTo(-1);
		else animateSwipeOffset(0);
	}

	function stackStoryPrev() {
		if (stackSwipeAnimating || stackImages.length <= 1 || stackStoryIndex <= 0) return;
		if (stackViewMode === 'story' && stackImages.length > 1) commitSwipeTo(1);
		else {
			stackStoryIndex = Math.max(0, stackStoryIndex - 1);
			resetStackPan();
		}
	}
	function stackStoryNext() {
		if (stackSwipeAnimating || stackImages.length <= 1 || stackStoryIndex >= stackImages.length - 1)
			return;
		if (stackViewMode === 'story' && stackImages.length > 1) commitSwipeTo(-1);
		else {
			stackStoryIndex = Math.min(stackImages.length - 1, stackStoryIndex + 1);
			resetStackPan();
		}
	}

	function onStackKeydown(e: KeyboardEvent) {
		if (stackViewMode !== 'story' || stackImages.length <= 1) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			stackStoryPrev();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			stackStoryNext();
		}
	}

	let stackWheelFocal: { vx: number; vy: number; cx: number; cy: number } | null = null;

	const smoothStackZoom = createSmoothZoom({
		get: () => stackZoom,
		set: (v) => {
			stackZoom = v;
		},
		onFrame: () => {
			if (stackWheelFocal) {
				stackPanX = stackWheelFocal.vx - stackWheelFocal.cx * stackZoom;
				stackPanY = stackWheelFocal.vy - stackWheelFocal.cy * stackZoom;
			}
			if (stackZoom <= 1) resetStackPan();
			else clampStackPan();
		},
		ease: 0.28
	});

	function stackZoomIn() {
		stackWheelFocal = null;
		const next = Math.min(STACK_ZOOM_MAX, Math.round((smoothStackZoom.getTarget() + STACK_ZOOM_STEP) * 100) / 100);
		smoothStackZoom.setTarget(next, true);
		clampStackPan();
	}
	function stackZoomOut() {
		stackWheelFocal = null;
		const next = Math.max(STACK_ZOOM_MIN, Math.round((smoothStackZoom.getTarget() - STACK_ZOOM_STEP) * 100) / 100);
		smoothStackZoom.setTarget(next, true);
		if (next <= 1) resetStackPan();
		else clampStackPan();
	}
	function stackZoomReset() {
		stackWheelFocal = null;
		smoothStackZoom.setTarget(1, true);
		resetStackPan();
		if (touchUi) stackGestureMode = 'slide';
	}
	function openSwipeAt(index: number) {
		if (index < 0 || index >= stackImages.length) return;
		stackStoryIndex = index;
		resetStackPan();
		stackViewMode = 'story';
	}

	const debouncedStackRender = debounce(() => {
		if (!stackListEl || !stackImages.length) return;
		for (let i = 0; i < stackImages.length; i++) {
			const canvas = stackListEl.querySelector<HTMLCanvasElement>(`[data-stack-index="${i}"]`);
			const item = stackImages[i];
			if (!canvas || !item) continue;
			const dims = getCanvasDimensions(item.preview.width, item.preview.height, templateRatio, STACK_PREVIEW_MAX);
			if (dims.width <= 0 || dims.height <= 0) continue;
			renderCanvas(canvas, {
				image: item.preview,
				templateRatio,
				padding,
				borderType,
				blurStrength,
				solidColor,
				width: dims.width,
				height: dims.height,
				fillMode
			});
		}
	}, 16);

	$effect(() => {
		stackImages;
		templateRatio;
		padding;
		borderType;
		blurStrength;
		solidColor;
		fillMode;
		stackListEl;
		if (stackListEl && stackImages.length) debouncedStackRender();
	});

	$effect(() => {
		const n = stackImages.length;
		if (n === 0) return;
		if (stackStoryIndex >= n) stackStoryIndex = n - 1;
	});
	function renderStackSwipePanel(
		canvas: HTMLCanvasElement | null,
		item: StackImage | undefined,
		dims: { width: number; height: number }
	) {
		if (!canvas || !item || dims.width <= 0 || dims.height <= 0) return;
		renderCanvas(canvas, {
			image: item.preview,
			templateRatio,
			padding,
			borderType,
			blurStrength,
			solidColor,
			width: dims.width,
			height: dims.height,
			fillMode
		});
	}

	function renderAllStackSwipePanels() {
		if (stackViewMode !== 'story' || !stackImages.length) return;
		const idx = stackStoryIndex;
		const leftItem = idx > 0 ? stackImages[idx - 1] : null;
		const centerItem = stackImages[idx];
		const rightItem = idx < stackImages.length - 1 ? stackImages[idx + 1] : null;
		renderStackSwipePanel(stackSwipeCanvasLeft, leftItem ?? undefined, leftItem ? getStackSwipeDims(leftItem) : { width: 0, height: 0 });
		renderStackSwipePanel(stackSwipeCanvasCenter, centerItem, getStackSwipeDims(centerItem));
		renderStackSwipePanel(stackSwipeCanvasRight, rightItem ?? undefined, rightItem ? getStackSwipeDims(rightItem) : { width: 0, height: 0 });
	}

	const debouncedStackSwipeRender = debounce(renderAllStackSwipePanels, 16);

	$effect(() => {
		stackStoryIndex;
		stackImages;
		templateRatio;
		padding;
		borderType;
		blurStrength;
		solidColor;
		fillMode;
		stackSwipeCanvasLeft;
		stackSwipeCanvasCenter;
		stackSwipeCanvasRight;
		if (stackViewMode === 'story' && stackImages.length) {
			renderAllStackSwipePanels();
			debouncedStackSwipeRender();
		}
	});

	$effect(() => {
		stackStoryCurrentItem;
		stackStoryDims.width;
		stackStoryDims.height;
		templateRatio;
		padding;
		borderType;
		blurStrength;
		solidColor;
		fillMode;
		stackStoryCanvasEl;
		if (stackViewMode === 'story' && stackStoryCanvasEl && stackStoryCurrentItem && stackImages.length <= 1) {
			renderStackSwipePanel(stackStoryCanvasEl, stackStoryCurrentItem, stackStoryDims);
		}
	});

	function applyStackWheelZoom(e: WheelEvent) {
		const prevTarget = smoothStackZoom.getTarget();
		const next = Math.min(STACK_ZOOM_MAX, Math.max(STACK_ZOOM_MIN, prevTarget * wheelZoomFactor(e)));
		if (Math.abs(next - prevTarget) < 1e-6) return;
		const rect = viewportEl?.getBoundingClientRect();
		const vx = rect ? e.clientX - (rect.left + rect.width / 2) : 0;
		const vy = rect ? e.clientY - (rect.top + rect.height / 2) : 0;

		if (isTrackpadPinch(e) || !isLikelyMouseWheel(e)) {
			stackWheelFocal = null;
			const p = panAfterZoomToward(stackPanX, stackPanY, stackZoom, next, vx, vy);
			stackPanX = p.panX;
			stackPanY = p.panY;
			smoothStackZoom.setTarget(next, true);
			if (stackZoom <= 1) resetStackPan();
			else clampStackPan();
			return;
		}

		stackWheelFocal = {
			vx,
			vy,
			cx: stackZoom > 0 ? (vx - stackPanX) / stackZoom : 0,
			cy: stackZoom > 0 ? (vy - stackPanY) / stackZoom : 0
		};
		smoothStackZoom.setTarget(next);
	}

	function onStackStoryWheel(e: WheelEvent) {
		if (stackViewMode !== 'story') return;
		const absX = Math.abs(e.deltaX);
		const absY = Math.abs(e.deltaY);

		if (isTrackpadPinch(e) || isLikelyMouseWheel(e)) {
			e.preventDefault();
			applyStackWheelZoom(e);
			wheelNavAccum = 0;
			return;
		}

		if (stackCanPan) {
			e.preventDefault();
			stackPanX -= e.deltaX;
			stackPanY -= e.deltaY;
			clampStackPan();
			wheelNavAccum = 0;
			return;
		}

		if (absY > absX) {
			e.preventDefault();
			applyStackWheelZoom(e);
			wheelNavAccum = 0;
			return;
		}

		if (stackImages.length <= 1 || absX === 0) return;
		e.preventDefault();
		const now = performance.now();
		if (now < wheelNavCooldownUntil) {
			wheelNavAccum = 0;
			return;
		}
		if (wheelNavAccum !== 0 && Math.sign(e.deltaX) !== Math.sign(wheelNavAccum)) {
			wheelNavAccum = e.deltaX;
			return;
		}
		wheelNavAccum += e.deltaX;
		if (Math.abs(wheelNavAccum) < WHEEL_NAV_THRESHOLD) return;
		if (wheelNavAccum > 0) stackStoryNext();
		else stackStoryPrev();
		wheelNavAccum = 0;
		wheelNavCooldownUntil = now + WHEEL_NAV_COOLDOWN_MS;
	}

	function clampSwipeOffset(offset: number) {
		const cw = containerSize.width;
		const maxDrag = cw * SWIPE_DRAG_CLAMP;
		if (stackStoryIndex <= 0) return Math.min(0, Math.max(-maxDrag, offset));
		if (stackStoryIndex >= stackImages.length - 1) return Math.max(0, Math.min(maxDrag, offset));
		return Math.max(-maxDrag, Math.min(maxDrag, offset));
	}

	function onStackSwipePointerDown(e: PointerEvent) {
		if (e.button !== 0 || stackPinchActive || stackSwipeAnimating) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (stackDragPans) {
			stackIsPanning = true;
			stackPanPointerStart = { x: e.clientX, y: e.clientY, panX: stackPanX, panY: stackPanY };
			stackSwipePointerStart = null;
			return;
		}
		stackIsPanning = false;
		stackPanPointerStart = null;
		stackSwipePointerStart = { x: e.clientX, startOffset: stackSwipeDragOffset };
	}
	function onStackSwipePointerMove(e: PointerEvent) {
		if (stackPinchActive) return;
		if (stackIsPanning && stackPanPointerStart) {
			stackPanX = stackPanPointerStart.panX + (e.clientX - stackPanPointerStart.x);
			stackPanY = stackPanPointerStart.panY + (e.clientY - stackPanPointerStart.y);
			clampStackPan();
			return;
		}
		if (!stackSwipePointerStart) return;
		const raw = stackSwipePointerStart.startOffset + (e.clientX - stackSwipePointerStart.x);
		stackSwipeDragOffset = clampSwipeOffset(raw);
	}
	function onStackSwipePointerUp(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		if (stackIsPanning) {
			stackIsPanning = false;
			stackPanPointerStart = null;
			return;
		}
		if (stackSwipeAnimating) return;
		const offset = stackSwipeDragOffset;
		stackSwipePointerStart = null;
		finishSwipeGesture(offset);
	}
	function onStackSwipeTouchStart(e: TouchEvent) {
		if (stackSwipeAnimating) return;
		if (e.touches.length === 2) {
			e.preventDefault();
			stackWheelFocal = null;
			smoothStackZoom.stop();
			stackIsPanning = false;
			stackPanPointerStart = null;
			stackSwipePointerStart = null;
			stackSwipeDragOffset = 0;
			stackPinchActive = true;
			stackPinchInitialDist = getTouchDist(e.touches);
			stackPinchInitialZoom = stackZoom;
			stackPinchOriginX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			stackPinchOriginY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
			stackPinchStartPanX = stackPanX;
			stackPinchStartPanY = stackPanY;
			stackGestureMode = 'zoom';
			return;
		}
		if (e.touches.length !== 1 || stackPinchActive) return;
		if (stackDragPans) {
			stackIsPanning = true;
			stackPanPointerStart = {
				x: e.touches[0].clientX,
				y: e.touches[0].clientY,
				panX: stackPanX,
				panY: stackPanY
			};
			stackSwipePointerStart = null;
			return;
		}
		stackSwipePointerStart = { x: e.touches[0].clientX, startOffset: stackSwipeDragOffset };
	}
	function onStackSwipeTouchMove(e: TouchEvent) {
		if (e.touches.length === 2 && stackPinchInitialDist > 0) {
			e.preventDefault();
			stackIsPanning = false;
			const dist = getTouchDist(e.touches);
			const scale = dist / stackPinchInitialDist;
			const next = Math.min(
				STACK_ZOOM_MAX,
				Math.max(STACK_ZOOM_MIN, stackPinchInitialZoom * scale)
			);
			const pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			const pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
			const dragDeltaX = pinchCenterX - stackPinchOriginX;
			const dragDeltaY = pinchCenterY - stackPinchOriginY;
			if (viewportEl) {
				const rect = viewportEl.getBoundingClientRect();
				const vcx = rect.left + rect.width / 2;
				const vcy = rect.top + rect.height / 2;
				const r = next / stackPinchInitialZoom;
				stackPanX =
					(1 - r) * (stackPinchOriginX - vcx) + r * stackPinchStartPanX + dragDeltaX;
				stackPanY =
					(1 - r) * (stackPinchOriginY - vcy) + r * stackPinchStartPanY + dragDeltaY;
			}
			smoothStackZoom.setTarget(next, true);
			if (next <= 1) resetStackPan();
			else clampStackPan();
			return;
		}
		if (stackIsPanning && stackPanPointerStart && e.touches.length === 1) {
			e.preventDefault();
			stackPanX = stackPanPointerStart.panX + (e.touches[0].clientX - stackPanPointerStart.x);
			stackPanY = stackPanPointerStart.panY + (e.touches[0].clientY - stackPanPointerStart.y);
			clampStackPan();
			return;
		}
		if (!stackSwipePointerStart || e.touches.length !== 1) return;
		const raw = stackSwipePointerStart.startOffset + (e.touches[0].clientX - stackSwipePointerStart.x);
		stackSwipeDragOffset = clampSwipeOffset(raw);
	}
	function onStackSwipeTouchEnd(e: TouchEvent) {
		if (e.touches.length >= 2) return;
		if (stackPinchActive && e.touches.length < 2) {
			stackPinchActive = false;
			stackPinchInitialDist = 0;
			smoothStackZoom.syncFromDisplay();
			if (stackZoom <= 1) {
				resetStackPan();
			} else {
				clampStackPan();
			}
			if (e.touches.length === 1) {
				stackIsPanning = true;
				stackPanPointerStart = {
					x: e.touches[0].clientX,
					y: e.touches[0].clientY,
					panX: stackPanX,
					panY: stackPanY
				};
			}
			return;
		}
		if (e.changedTouches.length !== 1) return;
		if (stackIsPanning) {
			stackIsPanning = false;
			stackPanPointerStart = null;
			return;
		}
		if (stackSwipeAnimating) return;
		const offset = stackSwipeDragOffset;
		stackSwipePointerStart = null;
		finishSwipeGesture(offset);
	}

	$effect(() => {
		stackZoom;
		stackStoryDims.width;
		stackStoryDims.height;
		containerSize.width;
		containerSize.height;
		if (stackViewMode !== 'story') return;
		clampStackPan();
	});

	$effect(() => {
		if (stackViewMode !== 'story') {
			wheelNavAccum = 0;
			wheelNavCooldownUntil = 0;
		}
	});

	$effect(() => {
		const el = viewportEl;
		if (!el || stackViewMode !== 'story' || !stackImages.length) return;
		el.addEventListener('wheel', onStackStoryWheel, { passive: false });
		return () => el.removeEventListener('wheel', onStackStoryWheel);
	});

	function syncListHoverFromPoint(x: number, y: number) {
		if (!stackListEl) {
			listHoverIndex = null;
			return;
		}
		const el = document.elementFromPoint(x, y);
		const wrap = el instanceof Element ? el.closest('.stack-cell-wrap') : null;
		if (!(wrap instanceof HTMLElement) || !stackListEl.contains(wrap)) {
			listHoverIndex = null;
			return;
		}
		const idx = Array.prototype.indexOf.call(stackListEl.children, wrap);
		listHoverIndex = idx >= 0 ? idx : null;
	}

	function autoScrollWhileDragging(clientY: number) {
		if (!stackScrollEl || dragFromIndex == null) return;
		const rect = stackScrollEl.getBoundingClientRect();
		const edge = 72;
		const maxStep = 28;
		if (clientY < rect.top + edge) {
			const t = 1 - Math.max(0, clientY - rect.top) / edge;
			stackScrollEl.scrollTop -= Math.ceil(maxStep * t);
		} else if (clientY > rect.bottom - edge) {
			const t = 1 - Math.max(0, rect.bottom - clientY) / edge;
			stackScrollEl.scrollTop += Math.ceil(maxStep * t);
		}
	}

	function listIndexFromPoint(clientX: number, clientY: number): number | null {
		if (!stackListEl) return null;
		const wraps = stackListEl.querySelectorAll('.stack-cell-wrap');
		if (!wraps.length) return null;
		for (let i = 0; i < wraps.length; i++) {
			const r = wraps[i].getBoundingClientRect();
			if (clientY >= r.top && clientY <= r.bottom) return i;
		}
		const first = wraps[0].getBoundingClientRect();
		if (clientY < first.top) return 0;
		return wraps.length - 1;
	}

	function onListHandlePointerDown(e: PointerEvent, index: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragFromIndex = index;
		dragOverIndex = index;
		listHoverIndex = null;
		lastDragPoint = { x: e.clientX, y: e.clientY };
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
	}

	function onListHandlePointerMove(e: PointerEvent) {
		if (dragFromIndex == null) return;
		e.preventDefault();
		lastDragPoint = { x: e.clientX, y: e.clientY };
		autoScrollWhileDragging(e.clientY);
		const idx = listIndexFromPoint(e.clientX, e.clientY);
		if (idx != null) dragOverIndex = idx;
	}

	function onListHandlePointerUp(e: PointerEvent) {
		if (dragFromIndex == null) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		const from = dragFromIndex;
		const to = dragOverIndex;
		dragFromIndex = null;
		dragOverIndex = null;
		if (from != null && to != null && from !== to) reorderStack(from, to);
		requestAnimationFrame(() => syncListHoverFromPoint(lastDragPoint.x, lastDragPoint.y));
	}

	function onListPointerEnter(index: number) {
		if (dragFromIndex != null) return;
		listHoverIndex = index;
	}

	function onListPointerLeave(e: PointerEvent) {
		if (dragFromIndex != null) return;
		const related = e.relatedTarget as Node | null;
		const wrap = e.currentTarget as HTMLElement;
		if (related && wrap.contains(related)) return;
		if (listHoverIndex !== null) listHoverIndex = null;
	}
</script>

<svelte:window onkeydown={onStackKeydown} />

<div
	bind:this={viewportEl}
	class="canvas-viewport stack-viewport"
	class:dropzone={!stackImages.length}
	class:stack-story-view={stackViewMode === 'story' && stackImages.length > 0}
	class:stack-can-pan={stackViewMode === 'story' && stackDragPans}
	class:stack-panning={stackViewMode === 'story' && stackIsPanning}
>
	{#if stackImages.length}
		{#if stackViewMode === 'story'}
			{#if stackImages.length > 1}
				<div
					class="stack-swipe-track"
					class:swipe-animating={stackSwipeAnimating}
					style="transform: translateX({stackSwipeDragOffset}px); width: {containerSize.width * 3}px;"
					onpointerdown={onStackSwipePointerDown}
					onpointermove={onStackSwipePointerMove}
					onpointerup={onStackSwipePointerUp}
					onpointerleave={onStackSwipePointerUp}
					ontouchstart={onStackSwipeTouchStart}
					ontouchmove={onStackSwipeTouchMove}
					ontouchend={onStackSwipeTouchEnd}
					ontouchcancel={onStackSwipeTouchEnd}
				>
					<div class="stack-swipe-panel" style="width: {containerSize.width}px; height: {containerSize.height}px;">
						<div class="stack-story-pan" style="transform: {stackPanTransform}">
							<canvas
								bind:this={stackSwipeCanvasLeft}
								class="stack-story-canvas"
								style="transform: {stackScaleTransform}"
								width={stackStoryIndex > 0 ? getStackSwipeDims(stackImages[stackStoryIndex - 1]).width : 0}
								height={stackStoryIndex > 0 ? getStackSwipeDims(stackImages[stackStoryIndex - 1]).height : 0}
							></canvas>
						</div>
					</div>
					<div class="stack-swipe-panel" style="width: {containerSize.width}px; height: {containerSize.height}px;">
						<div class="stack-story-pan" style="transform: {stackPanTransform}">
							<canvas
								bind:this={stackSwipeCanvasCenter}
								class="stack-story-canvas"
								style="transform: {stackScaleTransform}"
								width={stackStoryDims.width}
								height={stackStoryDims.height}
							></canvas>
						</div>
					</div>
					<div class="stack-swipe-panel" style="width: {containerSize.width}px; height: {containerSize.height}px;">
						<div class="stack-story-pan" style="transform: {stackPanTransform}">
							<canvas
								bind:this={stackSwipeCanvasRight}
								class="stack-story-canvas"
								style="transform: {stackScaleTransform}"
								width={stackStoryIndex < stackImages.length - 1 ? getStackSwipeDims(stackImages[stackStoryIndex + 1]).width : 0}
								height={stackStoryIndex < stackImages.length - 1 ? getStackSwipeDims(stackImages[stackStoryIndex + 1]).height : 0}
							></canvas>
						</div>
					</div>
				</div>
				<div class="stack-story-nav" aria-label="Position">
					<button type="button" class="stack-story-arrow" onclick={stackStoryPrev} disabled={stackStoryIndex === 0 || stackSwipeAnimating} title="Previous" aria-label="Previous image">
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M15 18 9 12l6-6" />
						</svg>
					</button>
					<span class="stack-story-counter">
						<span class="stack-story-counter-current">{stackStoryIndex + 1}</span>
						<span class="stack-story-counter-sep">/</span>
						<span class="stack-story-counter-total">{stackImages.length}</span>
					</span>
					<button type="button" class="stack-story-arrow" onclick={stackStoryNext} disabled={stackStoryIndex === stackImages.length - 1 || stackSwipeAnimating} title="Next" aria-label="Next image">
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="m9 18 6-6-6-6" />
						</svg>
					</button>
				</div>
			{:else}
				<div
					class="stack-story-frame"
					onpointerdown={onStackSwipePointerDown}
					onpointermove={onStackSwipePointerMove}
					onpointerup={onStackSwipePointerUp}
					onpointerleave={onStackSwipePointerUp}
					ontouchstart={onStackSwipeTouchStart}
					ontouchmove={onStackSwipeTouchMove}
					ontouchend={onStackSwipeTouchEnd}
					ontouchcancel={onStackSwipeTouchEnd}
				>
					<div class="stack-story-pan" style="transform: {stackPanTransform}">
						<canvas
							bind:this={stackStoryCanvasEl}
							class="stack-story-canvas"
							style="transform: {stackScaleTransform}"
							width={stackStoryDims.width}
							height={stackStoryDims.height}
						></canvas>
					</div>
				</div>
			{/if}
		{:else}
			<div class="stack-scroll" class:list-reordering={dragFromIndex !== null} bind:this={stackScrollEl}>
				<div class="stack-list-wrap">
					<div
						class="stack-list"
						bind:this={stackListEl}
						style="grid-template-columns: repeat({effectiveListColumns}, minmax(0, 1fr))"
					>
						{#each stackImages as item, i (item.preview)}
							<div
								class="stack-cell-wrap"
								class:drag-over={dragOverIndex === i && dragFromIndex !== null && dragFromIndex !== i}
								class:show-controls={listHoverIndex === i && dragFromIndex === null}
								class:dragging={dragFromIndex === i}
								onpointerenter={() => onListPointerEnter(i)}
								onpointerleave={onListPointerLeave}
							>
								<div class="stack-cell">
									<canvas
										class="stack-cell-canvas"
										data-stack-index={i}
										width={getCanvasDimensions(item.preview.width, item.preview.height, templateRatio, STACK_PREVIEW_MAX).width}
										height={getCanvasDimensions(item.preview.width, item.preview.height, templateRatio, STACK_PREVIEW_MAX).height}
									></canvas>
									<div
										class="stack-cell-handle"
										role="button"
										tabindex="-1"
										title="Drag to reorder"
										aria-label="Drag to reorder item {i + 1}"
										onpointerdown={(e) => onListHandlePointerDown(e, i)}
										onpointermove={onListHandlePointerMove}
										onpointerup={onListHandlePointerUp}
										onpointercancel={onListHandlePointerUp}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
											<circle cx="9" cy="6" r="1.5" />
											<circle cx="15" cy="6" r="1.5" />
											<circle cx="9" cy="12" r="1.5" />
											<circle cx="15" cy="12" r="1.5" />
											<circle cx="9" cy="18" r="1.5" />
											<circle cx="15" cy="18" r="1.5" />
										</svg>
									</div>
									<button
										type="button"
										class="stack-cell-remove"
										onclick={() => removeStackImage(i)}
										title="Remove"
										aria-label="Remove item {i + 1}"
									>×</button>
									<button
										type="button"
										class="stack-cell-swipe"
										onclick={() => openSwipeAt(i)}
										title="Open in Swipe"
										aria-label="Open item {i + 1} in Swipe view"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M15 3h6v6" />
											<path d="M10 14 21 3" />
											<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
										</svg>
									</button>
									<span class="stack-cell-index" aria-hidden="true">{i + 1}</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div class="drop-message">
			<p>Add images to stack vertically</p>
			<label class="btn btn-secondary">
				<input type="file" accept="image/*" multiple bind:this={stackFileInputEl} onchange={onStackFiles} />
				Add images
			</label>
		</div>
		<label class="drop-overlay">
			<input type="file" accept="image/*" multiple onchange={onStackFiles} />
		</label>
	{/if}
</div>

{#if stackImages.length}
	<footer class="zoom-bar">
		<div class="zoom-group">
			{#if narrowListUi}
				<button
					type="button"
					class="zoom-btn"
					class:selected={stackViewMode === 'list' && effectiveListColumns <= 1}
					onclick={() => setStackBrowseMode('list')}
					title="Single-column list"
				>List</button>
				<button
					type="button"
					class="zoom-btn"
					class:selected={stackViewMode === 'list' && effectiveListColumns > 1}
					onclick={() => setStackBrowseMode('grid')}
					title="Two-column grid"
				>Grid</button>
				<button
					type="button"
					class="zoom-btn"
					class:selected={stackViewMode === 'story'}
					onclick={() => setStackBrowseMode('story')}
					title="One at a time (drag to switch)"
				>Swipe</button>
			{:else}
				<button
					type="button"
					class="zoom-btn"
					class:selected={stackViewMode === 'list'}
					onclick={() => (stackViewMode = 'list')}
					title="List view"
				>List</button>
				<button
					type="button"
					class="zoom-btn"
					class:selected={stackViewMode === 'story'}
					onclick={() => (stackViewMode = 'story')}
					title="One at a time (drag to switch)"
				>Swipe</button>
			{/if}
			<div class="zoom-subgroup">
				<label class="zoom-btn">
					<input type="file" accept="image/*" multiple onchange={onStackFiles} />
					Add
				</label>
				<button type="button" class="zoom-btn" onclick={clearStack}>Clear</button>
			</div>
		</div>
		{#if stackViewMode === 'list' && !narrowListUi}
			<div class="zoom-group zoom-group-zoom">
				<span class="zoom-pct" title="Columns">{effectiveListColumns} col</span>
				<button type="button" class="zoom-btn" onclick={listColumnsOut} disabled={effectiveListColumns <= LIST_COLUMNS_MIN} title="Fewer columns">−</button>
				<button type="button" class="zoom-btn" onclick={listColumnsIn} disabled={effectiveListColumns >= listColumnsCap} title="More columns">+</button>
			</div>
		{:else if stackViewMode === 'story'}
			{#if touchUi}
				<div class="zoom-group zoom-group-gesture">
					<button
						type="button"
						class="zoom-btn"
						class:selected={stackGestureMode === 'slide'}
						onclick={() => setStackGestureMode('slide')}
						title="Swipe between images"
					>Slide</button>
					<button
						type="button"
						class="zoom-btn"
						class:selected={stackGestureMode === 'zoom'}
						onclick={() => setStackGestureMode('zoom')}
						title="Pinch to zoom, drag to pan"
					>Zoom</button>
				</div>
			{/if}
			<div class="zoom-group zoom-group-zoom">
				<button type="button" class="zoom-btn" class:selected={stackZoom === 1} onclick={stackZoomReset} title="100%">100%</button>
				<span class="zoom-pct">{Math.round(stackZoom * 100)}%</span>
				<button type="button" class="zoom-btn" onclick={stackZoomOut} title="Zoom out">−</button>
				<button type="button" class="zoom-btn" onclick={stackZoomIn} title="Zoom in">+</button>
			</div>
		{/if}
	</footer>
{/if}

<style>
	.stack-viewport {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		overflow: hidden;
	}
	.stack-viewport.dropzone {
		position: relative;
		align-items: center;
		justify-content: center;
		background: var(--bg-input);
		border: 2px dashed var(--border-subtle);
	}
	.drop-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 24px;
		pointer-events: none;
	}
	.drop-message .btn {
		pointer-events: auto;
		position: relative;
	}
	/* visually hidden; label is the control */
	.drop-message input[type="file"] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.drop-overlay {
		position: absolute;
		inset: 0;
		cursor: pointer;
	}
	.drop-overlay input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.stack-viewport.stack-story-view {
		position: relative;
		align-items: center;
		justify-content: center;
		touch-action: none;
		overflow: hidden;
	}
	.stack-viewport.stack-story-view.stack-can-pan {
		cursor: grab;
	}
	.stack-viewport.stack-story-view.stack-panning {
		cursor: grabbing;
	}
	.stack-swipe-track {
		display: flex;
		flex-direction: row;
		flex-shrink: 0;
		height: 100%;
		cursor: grab;
		will-change: transform;
	}
	.stack-swipe-track:active {
		cursor: grabbing;
	}
	.stack-swipe-track.swipe-animating {
		pointer-events: none;
	}
	.stack-swipe-panel {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.stack-story-frame {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		min-height: 0;
	}
	.stack-story-pan {
		display: flex;
		align-items: center;
		justify-content: center;
		transform-origin: center center;
		will-change: transform;
	}
	.stack-story-canvas {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
		transform-origin: center center;
		will-change: transform;
	}
	.stack-story-nav {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius);
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(18, 18, 18, 0.72);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
	}
	.stack-story-arrow {
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: background 0.15s, color 0.15s, opacity 0.15s;
	}
	.stack-story-arrow:hover:not(:disabled) {
		background: rgba(59, 99, 251, 0.35);
		color: #fff;
	}
	.stack-story-arrow:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.stack-story-counter {
		display: inline-flex;
		align-items: baseline;
		justify-content: center;
		gap: 5px;
		min-width: 3.6em;
		padding: 0 8px;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		user-select: none;
	}
	.stack-story-counter-current {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.stack-story-counter-sep {
		font-size: 12px;
		color: var(--text-secondary);
		opacity: 0.7;
	}
	.stack-story-counter-total {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.stack-scroll {
		flex: 1;
		min-height: 0;
		min-width: 0;
		width: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
	}
	.stack-scroll.list-reordering {
		touch-action: none;
		user-select: none;
	}
	.stack-list-wrap {
		display: block;
		width: 100%;
		padding: 16px;
		box-sizing: border-box;
	}
	.stack-list {
		display: grid;
		gap: 12px;
		width: 100%;
		box-sizing: border-box;
		align-items: start;
	}
	.stack-cell-wrap {
		background: var(--bg-input);
		border-radius: var(--radius);
		padding: 8px;
		border: 1px solid var(--border-subtle);
		transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
		/* Keep wheel/trackpad scroll free; only the handle starts a drag */
		touch-action: pan-y;
	}
	.stack-cell-wrap.drag-over {
		border-color: var(--adobe-blue);
		box-shadow: 0 0 0 1px var(--adobe-blue);
	}
	.stack-cell-wrap.dragging {
		opacity: 0.45;
	}
	.stack-cell {
		position: relative;
		width: 100%;
		min-width: 0;
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
	}
	.stack-cell-canvas {
		display: block;
		width: 100%;
		height: auto;
		pointer-events: none;
	}
	.stack-cell-handle,
	.stack-cell-remove,
	.stack-cell-swipe {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		background: rgba(0, 0, 0, 0.55);
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
		opacity: 0;
		pointer-events: none;
	}
	.stack-cell-wrap.show-controls .stack-cell-handle,
	.stack-cell-wrap.show-controls .stack-cell-remove,
	.stack-cell-wrap.show-controls .stack-cell-swipe {
		opacity: 1;
		pointer-events: auto;
	}
	.stack-cell-handle {
		top: 8px;
		left: 8px;
		width: 32px;
		height: 32px;
		padding: 0;
		cursor: grab;
		touch-action: none;
	}
	.stack-cell-handle:active {
		cursor: grabbing;
	}
	.stack-cell-handle:hover {
		background: rgba(0, 0, 0, 0.75);
	}
	.stack-cell-remove {
		top: 8px;
		right: 8px;
		width: 32px;
		height: 32px;
		padding: 0;
		font-size: 18px;
		line-height: 1;
		color: #f0a0a0;
	}
	.stack-cell-remove:hover {
		background: rgba(120, 30, 30, 0.85);
		color: #fff;
	}
	.stack-cell-swipe {
		bottom: 8px;
		right: 8px;
		width: 32px;
		height: 32px;
		padding: 0;
	}
	.stack-cell-swipe:hover {
		background: rgba(59, 99, 251, 0.85);
		color: #fff;
	}
	.stack-cell-index {
		position: absolute;
		bottom: 8px;
		left: 8px;
		z-index: 1;
		min-width: 22px;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 600;
		text-align: center;
		pointer-events: none;
	}
	.zoom-bar {
		width: 100%;
		height: var(--zoombar-height);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 8px;
		padding: 0 8px;
		box-sizing: border-box;
		background: var(--bg-panel);
		border-top: 1px solid var(--border-subtle);
	}
	.zoom-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}
	.zoom-subgroup {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: 10px;
		padding-left: 10px;
		border-left: 1px solid var(--border-subtle);
	}
	.zoom-group-gesture {
		margin-left: auto;
	}
	.zoom-group-zoom {
		margin-left: auto;
	}
	.zoom-group-gesture + .zoom-group-zoom {
		margin-left: 0;
	}
	.zoom-pct {
		min-width: 48px;
		text-align: center;
		font-size: var(--font-size-label);
		color: var(--text-secondary);
	}
	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.zoom-bar label.zoom-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.zoom-bar input[type="file"] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}
	.zoom-btn {
		min-width: var(--touch-min);
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		background: var(--bg-input);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.15s;
	}
	.zoom-btn:hover {
		background: rgba(255, 255, 255, 0.08);
	}
	.zoom-btn.selected {
		border-color: var(--adobe-blue);
		background: rgba(59, 99, 251, 0.2);
		color: #a5b8ff;
	}
	@media (max-width: 767px) {
		.zoom-bar {
			height: auto;
			min-height: 36px;
			flex-wrap: wrap;
			align-content: center;
			justify-content: space-between;
			row-gap: 4px;
			column-gap: 4px;
			padding: 4px 6px;
			overflow: hidden;
		}
		.zoom-bar > .zoom-group:first-child {
			flex: 1 1 100%;
			min-width: 0;
		}
		.zoom-group {
			gap: 4px;
			flex-shrink: 1;
			min-width: 0;
		}
		.zoom-subgroup {
			margin-left: auto;
			padding-left: 0;
			border-left: none;
			gap: 4px;
		}
		.zoom-group-gesture,
		.zoom-group-zoom {
			margin-left: 0;
		}
		.zoom-group-zoom {
			margin-left: auto;
		}
		.zoom-pct {
			min-width: 2.75em;
			font-size: 11px;
		}
		.zoom-bar .zoom-btn {
			min-width: 0;
			min-height: 28px;
			padding: 0 8px;
			font-size: 12px;
		}
		.stack-list-wrap {
			padding: 10px;
		}
		.stack-list {
			gap: 8px;
		}
		.stack-cell-wrap {
			padding: 6px;
		}
		/* Always show controls on touch — no reliable hover */
		.stack-cell-handle,
		.stack-cell-remove,
		.stack-cell-swipe {
			opacity: 1;
			pointer-events: auto;
		}
	}

	@media (hover: none) {
		.stack-cell-handle,
		.stack-cell-remove,
		.stack-cell-swipe {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
