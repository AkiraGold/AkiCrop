<script lang="ts">
	import { getCanvasDimensions, renderCanvas } from '#lib/renderer.js';
	import { debounce } from '#lib/utils.js';
	import { STACK_PREVIEW_MAX, STACK_ZOOM_MIN, STACK_ZOOM_MAX, STACK_ZOOM_STEP } from '#lib/constants.js';
	import type { BorderType } from '#lib/types.js';

	interface StackImage {
		blob: Blob;
		preview: ImageBitmap;
	}

	const SWIPE_THRESHOLD = 60;
	const SWIPE_DRAG_CLAMP = 0.4;
	const LIST_GRID_MIN_COL = 440;
	const LIST_GRID_GAP = 12;
	const LIST_GRID_PAD = 32;
	const LIST_SINGLE_COL_MQ = '(max-width: 767px)';

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
	let browseForcedSingleCol = $state(
		typeof window !== 'undefined' ? window.matchMedia(LIST_SINGLE_COL_MQ).matches : false
	);

	const stackStoryCurrentItem = $derived(
		stackImages.length > 0 ? stackImages[stackStoryIndex] ?? stackImages[0] : null
	);

	const browseViewLabel = $derived.by(() => {
		if (browseForcedSingleCol) return 'List';
		const inner = Math.max(0, containerSize.width - LIST_GRID_PAD);
		const cols = Math.max(1, Math.floor((inner + LIST_GRID_GAP) / (LIST_GRID_MIN_COL + LIST_GRID_GAP)));
		return cols > 1 ? 'Grid' : 'List';
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia(LIST_SINGLE_COL_MQ);
		const sync = () => {
			browseForcedSingleCol = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

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

	function stackStoryPrev() {
		if (stackImages.length <= 1) return;
		stackStoryIndex = Math.max(0, stackStoryIndex - 1);
	}
	function stackStoryNext() {
		if (stackImages.length <= 1) return;
		stackStoryIndex = Math.min(stackImages.length - 1, stackStoryIndex + 1);
	}
	function stackZoomIn() {
		stackZoom = Math.min(STACK_ZOOM_MAX, Math.round((stackZoom + STACK_ZOOM_STEP) * 100) / 100);
	}
	function stackZoomOut() {
		stackZoom = Math.max(STACK_ZOOM_MIN, Math.round((stackZoom - STACK_ZOOM_STEP) * 100) / 100);
	}
	function stackZoomReset() {
		stackZoom = 1;
	}
	function openSwipeAt(index: number) {
		if (index < 0 || index >= stackImages.length) return;
		stackStoryIndex = index;
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

	function onStackStoryWheel(e: WheelEvent) {
		if (stackViewMode !== 'story' || stackImages.length <= 1) return;
		e.preventDefault();
		if (e.deltaY > 0) stackStoryNext();
		else if (e.deltaY < 0) stackStoryPrev();
	}

	function clampSwipeOffset(offset: number) {
		const cw = containerSize.width;
		const maxDrag = cw * SWIPE_DRAG_CLAMP;
		if (stackStoryIndex <= 0) return Math.min(0, Math.max(-maxDrag, offset));
		if (stackStoryIndex >= stackImages.length - 1) return Math.max(0, Math.min(maxDrag, offset));
		return Math.max(-maxDrag, Math.min(maxDrag, offset));
	}

	function onStackSwipePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		stackSwipePointerStart = { x: e.clientX, startOffset: stackSwipeDragOffset };
	}
	function onStackSwipePointerMove(e: PointerEvent) {
		if (!stackSwipePointerStart) return;
		const raw = stackSwipePointerStart.startOffset + (e.clientX - stackSwipePointerStart.x);
		stackSwipeDragOffset = clampSwipeOffset(raw);
	}
	function onStackSwipePointerUp(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		const offset = stackSwipeDragOffset;
		stackSwipePointerStart = null;
		if (offset > SWIPE_THRESHOLD && stackStoryIndex > 0) stackStoryPrev();
		else if (offset < -SWIPE_THRESHOLD && stackStoryIndex < stackImages.length - 1) stackStoryNext();
		stackSwipeDragOffset = 0;
	}
	function onStackSwipeTouchStart(e: TouchEvent) {
		if (e.touches.length === 1)
			stackSwipePointerStart = { x: e.touches[0].clientX, startOffset: stackSwipeDragOffset };
	}
	function onStackSwipeTouchMove(e: TouchEvent) {
		if (!stackSwipePointerStart || e.touches.length !== 1) return;
		const raw = stackSwipePointerStart.startOffset + (e.touches[0].clientX - stackSwipePointerStart.x);
		stackSwipeDragOffset = clampSwipeOffset(raw);
	}
	function onStackSwipeTouchEnd(e: TouchEvent) {
		if (e.changedTouches.length !== 1) return;
		const offset = stackSwipeDragOffset;
		stackSwipePointerStart = null;
		if (offset > SWIPE_THRESHOLD && stackStoryIndex > 0) stackStoryPrev();
		else if (offset < -SWIPE_THRESHOLD && stackStoryIndex < stackImages.length - 1) stackStoryNext();
		stackSwipeDragOffset = 0;
	}

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

	function onListDragStart(e: DragEvent, index: number) {
		dragFromIndex = index;
		dragOverIndex = index;
		listHoverIndex = null;
		lastDragPoint = { x: e.clientX, y: e.clientY };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
		const wrap = (e.currentTarget as HTMLElement).closest('.stack-cell-wrap');
		if (wrap instanceof HTMLElement) wrap.classList.add('dragging');
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
	}

	function finishListDrag(e: DragEvent) {
		dragFromIndex = null;
		dragOverIndex = null;
		const wrap = (e.currentTarget as HTMLElement).closest('.stack-cell-wrap');
		if (wrap instanceof HTMLElement) wrap.classList.remove('dragging');
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
		// CSS :hover sticks after DnD until the next real mousemove — re-sync from pointer
		requestAnimationFrame(() => syncListHoverFromPoint(lastDragPoint.x, lastDragPoint.y));
	}

	function onListDragEnd(e: DragEvent) {
		finishListDrag(e);
	}

	function onListDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		lastDragPoint = { x: e.clientX, y: e.clientY };
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		autoScrollWhileDragging(e.clientY);
		if (dragFromIndex == null || dragFromIndex === index) {
			dragOverIndex = dragFromIndex;
			return;
		}
		dragOverIndex = index;
	}

	function onStackScrollDragOver(e: DragEvent) {
		if (dragFromIndex == null) return;
		e.preventDefault();
		lastDragPoint = { x: e.clientX, y: e.clientY };
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		autoScrollWhileDragging(e.clientY);
	}

	function onListDrop(e: DragEvent, index: number) {
		e.preventDefault();
		lastDragPoint = { x: e.clientX, y: e.clientY };
		const from = dragFromIndex;
		if (from != null && from !== index) reorderStack(from, index);
		finishListDrag(e);
	}

	function onListDragLeave(e: DragEvent, index: number) {
		const related = e.relatedTarget as Node | null;
		const wrap = e.currentTarget as HTMLElement;
		if (related && wrap.contains(related)) return;
		if (dragOverIndex === index) dragOverIndex = dragFromIndex;
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

<div
	bind:this={viewportEl}
	class="canvas-viewport stack-viewport"
	class:dropzone={!stackImages.length}
	class:stack-story-view={stackViewMode === 'story' && stackImages.length > 0}
	onwheel={stackViewMode === 'story' && stackImages.length > 1 ? onStackStoryWheel : undefined}
>
	{#if stackImages.length}
		{#if stackViewMode === 'story'}
			{#if stackImages.length > 1}
				<div
					class="stack-swipe-track"
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
						<canvas
							bind:this={stackSwipeCanvasLeft}
							class="stack-story-canvas"
							style="transform: scale({stackZoom})"
							width={stackStoryIndex > 0 ? getStackSwipeDims(stackImages[stackStoryIndex - 1]).width : 0}
							height={stackStoryIndex > 0 ? getStackSwipeDims(stackImages[stackStoryIndex - 1]).height : 0}
						></canvas>
					</div>
					<div class="stack-swipe-panel" style="width: {containerSize.width}px; height: {containerSize.height}px;">
						<canvas
							bind:this={stackSwipeCanvasCenter}
							class="stack-story-canvas"
							style="transform: scale({stackZoom})"
							width={stackStoryDims.width}
							height={stackStoryDims.height}
						></canvas>
					</div>
					<div class="stack-swipe-panel" style="width: {containerSize.width}px; height: {containerSize.height}px;">
						<canvas
							bind:this={stackSwipeCanvasRight}
							class="stack-story-canvas"
							style="transform: scale({stackZoom})"
							width={stackStoryIndex < stackImages.length - 1 ? getStackSwipeDims(stackImages[stackStoryIndex + 1]).width : 0}
							height={stackStoryIndex < stackImages.length - 1 ? getStackSwipeDims(stackImages[stackStoryIndex + 1]).height : 0}
						></canvas>
					</div>
				</div>
				<div class="stack-story-nav" aria-label="Position">
					<button type="button" class="stack-story-arrow" onclick={stackStoryPrev} disabled={stackStoryIndex === 0} title="Previous">←</button>
					<span class="stack-story-counter">{stackStoryIndex + 1} / {stackImages.length}</span>
					<button type="button" class="stack-story-arrow" onclick={stackStoryNext} disabled={stackStoryIndex === stackImages.length - 1} title="Next">→</button>
				</div>
			{:else}
				<div class="stack-story-frame">
					<canvas
						bind:this={stackStoryCanvasEl}
						class="stack-story-canvas"
						style="transform: scale({stackZoom})"
						width={stackStoryDims.width}
						height={stackStoryDims.height}
					></canvas>
				</div>
			{/if}
		{:else}
			<div
				class="stack-scroll"
				bind:this={stackScrollEl}
				ondragover={onStackScrollDragOver}
			>
				<div class="stack-list-wrap">
					<div class="stack-list" bind:this={stackListEl}>
						{#each stackImages as item, i (item.preview)}
							<div
								class="stack-cell-wrap"
								class:drag-over={dragOverIndex === i && dragFromIndex !== null && dragFromIndex !== i}
								class:show-controls={listHoverIndex === i && dragFromIndex === null}
								onpointerenter={() => onListPointerEnter(i)}
								onpointerleave={onListPointerLeave}
								ondragover={(e) => onListDragOver(e, i)}
								ondragleave={(e) => onListDragLeave(e, i)}
								ondrop={(e) => onListDrop(e, i)}
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
										draggable="true"
										role="button"
										tabindex="-1"
										title="Drag to reorder"
										aria-label="Drag to reorder item {i + 1}"
										ondragstart={(e) => onListDragStart(e, i)}
										ondragend={onListDragEnd}
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
			<button type="button" class="zoom-btn" class:selected={stackViewMode === 'list'} onclick={() => (stackViewMode = 'list')} title={`${browseViewLabel} view`}>{browseViewLabel}</button>
			<button type="button" class="zoom-btn" class:selected={stackViewMode === 'story'} onclick={() => (stackViewMode = 'story')} title="One at a time (drag to switch)">Swipe</button>
			<div class="zoom-subgroup">
				<label class="zoom-btn">
					<input type="file" accept="image/*" multiple onchange={onStackFiles} />
					Add
				</label>
				<button type="button" class="zoom-btn" onclick={clearStack}>Clear</button>
			</div>
		</div>
		{#if stackViewMode === 'story'}
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
		touch-action: pan-y;
		overflow: hidden;
	}
	.stack-swipe-track {
		display: flex;
		flex-direction: row;
		flex-shrink: 0;
		height: 100%;
		cursor: grab;
	}
	.stack-swipe-track:active {
		cursor: grabbing;
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
	.stack-story-canvas {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
		transform-origin: center center;
		transition: transform 0.12s ease;
	}
	.stack-story-nav {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		border-radius: var(--radius);
		background: rgba(0, 0, 0, 0.6);
	}
	.stack-story-arrow {
		width: 36px;
		height: 36px;
		border: none;
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.15);
		color: var(--text-primary);
		font-size: 18px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.stack-story-arrow:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.25);
	}
	.stack-story-arrow:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.stack-story-counter {
		font-size: var(--font-size-label);
		color: var(--text-secondary);
		min-width: 3em;
		text-align: center;
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
	.stack-list-wrap {
		display: block;
		width: 100%;
		padding: 16px;
		box-sizing: border-box;
	}
	.stack-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
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
	.zoom-group-zoom {
		margin-left: auto;
	}
	.zoom-pct {
		min-width: 48px;
		text-align: center;
		font-size: var(--font-size-label);
		color: var(--text-secondary);
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
			height: 36px;
			gap: 6px;
			padding: 0 6px;
		}
		.stack-list-wrap {
			padding: 10px;
		}
		.stack-list {
			grid-template-columns: 1fr;
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
		.zoom-bar .zoom-btn {
			min-width: 0;
			padding: 0 10px;
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
