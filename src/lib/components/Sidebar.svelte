<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { TemplateId, BorderType } from '#lib/types.js';
	import { MOBILE_MQ, type AppMode } from '#lib/constants.js';

	interface Props {
		appMode: AppMode;
		disabled: boolean;
		currentTemplateId: TemplateId;
		onSetTemplate: (id: TemplateId) => void;
		onOpenAspectPopup: () => void;
		showCropRemoveImage: boolean;
		showCarouselRemoveImage: boolean;
		onClearCropImage: () => void;
		onClearCarouselImage: () => void;
		fillMode: 'contain' | 'cover';
		onFillModeContain: () => void;
		onFillModeCover: () => void;
		customRatioW: number;
		customRatioH: number;
		showCustomRatio: boolean;
		borderType: BorderType;
		onSetBorderType: (type: BorderType) => void;
		padding: number;
		sliderActive: 'padding' | 'blur' | 'zoom' | null;
		onSetSliderActive: (id: 'padding' | 'blur' | 'zoom' | null) => void;
		carouselPanelCountOverride: number | null;
		carouselPanelCountAuto: number;
		carouselPanelCount: number;
		onCarouselPanelCountOverride: (value: number | null) => void;
		carouselZoom: number;
		carouselZoomMin: number;
		carouselZoomMax: number;
		blurStrength: number;
		solidColor: string;
}
	let {
		appMode,
		disabled,
		currentTemplateId,
		onSetTemplate,
		onOpenAspectPopup,
		showCropRemoveImage,
		showCarouselRemoveImage,
		onClearCropImage,
		onClearCarouselImage,
		fillMode,
		onFillModeContain,
		onFillModeCover,
		customRatioW = $bindable(),
		customRatioH = $bindable(),
		showCustomRatio,
		borderType,
		onSetBorderType,
		padding = $bindable(),
		sliderActive,
		onSetSliderActive,
		carouselPanelCountOverride,
		carouselPanelCountAuto,
		carouselPanelCount,
		onCarouselPanelCountOverride,
		carouselZoom = $bindable(),
		carouselZoomMin,
		carouselZoomMax,
		blurStrength = $bindable(),
		solidColor = $bindable()
	}: Props = $props();

	let panelsDropdownOpen = $state(false);
	let removeConfirming = $state(false);
	let narrowUi = $state(false);
	let panelCollapsed = $state(false);
	let panelHeightPx = $state(260);
	let panelManualHeight = $state(false);
	let resizeStartY = 0;
	let resizeStartH = 0;
	let panelResizing = $state(false);
	let mobileBarEl = $state<HTMLDivElement | null>(null);
	let sidebarBodyEl = $state<HTMLDivElement | null>(null);
	let canScrollUp = $state(false);
	let canScrollDown = $state(false);
	let lastBorderType: BorderType | null = null;
	let lastPanelMode: AppMode | null = null;
	let lastHadImage = false;
	let panelReady = $state(false);
	let panelMeasuring = $state(false);
	let scrollTopByMode: Partial<Record<AppMode, number>> = {};
	let heightByMode: Partial<Record<AppMode, number>> = {};

	const PANEL_H_MIN = 140;
	const PANEL_H_MAX_VH = 0.85;
	const hasImage = $derived(!disabled);

	function panelStorageKey(kind: 'h' | 'manual' | 'collapsed', mode: AppMode) {
		return `akicrop-mobile-panel-${kind}-${mode}`;
	}

	function readPanelState(mode: AppMode): {
		collapsed: boolean;
		manual: boolean;
		height: number | null;
	} {
		try {
			const collapsedRaw = localStorage.getItem(panelStorageKey('collapsed', mode));
			const manualRaw = localStorage.getItem(panelStorageKey('manual', mode));
			const heightRaw = localStorage.getItem(panelStorageKey('h', mode));
			const legacyCollapsed = localStorage.getItem('akicrop-mobile-panel-collapsed');
			const legacyManual = localStorage.getItem('akicrop-mobile-panel-manual');
			const legacyH = localStorage.getItem('akicrop-mobile-panel-h');
			const collapsed =
				collapsedRaw !== null ? collapsedRaw === '1' : legacyCollapsed === '1';
			const manual = manualRaw !== null ? manualRaw === '1' : legacyManual === '1';
			const heightNum = Number(heightRaw ?? legacyH);
			return {
				collapsed,
				manual,
				height: Number.isFinite(heightNum) && heightNum > 0 ? heightNum : null
			};
		} catch {
			return { collapsed: false, manual: false, height: null };
		}
	}

	function writePanelState(
		mode: AppMode,
		state: { collapsed?: boolean; manual?: boolean; height?: number }
	) {
		try {
			if (state.collapsed !== undefined) {
				localStorage.setItem(panelStorageKey('collapsed', mode), state.collapsed ? '1' : '0');
			}
			if (state.manual !== undefined) {
				if (state.manual) localStorage.setItem(panelStorageKey('manual', mode), '1');
				else localStorage.removeItem(panelStorageKey('manual', mode));
			}
			if (state.height !== undefined) {
				localStorage.setItem(panelStorageKey('h', mode), String(state.height));
			}
		} catch {
			/* ignore */
		}
	}

	function applyPanelState(mode: AppMode) {
		const stored = readPanelState(mode);
		panelCollapsed = stored.collapsed;
		panelManualHeight = stored.manual;
		const remembered = heightByMode[mode] ?? stored.height;
		if (remembered != null) {
			panelHeightPx = remembered;
			heightByMode[mode] = remembered;
		} else {
			panelManualHeight = false;
		}
	}

	function persistCurrentPanelState(mode: AppMode = appMode) {
		heightByMode[mode] = panelHeightPx;
		writePanelState(mode, {
			collapsed: panelCollapsed,
			manual: panelManualHeight,
			height: panelHeightPx
		});
	}

	function nextFrame() {
		return new Promise<void>((r) => requestAnimationFrame(() => r()));
	}

	const cropStackTemplates: { id: TemplateId; label: string }[] = [
		{ id: '1:1', label: '1:1' },
		{ id: '4:5', label: '4:5' },
		{ id: '16:9', label: '16:9' },
		{ id: 'original', label: 'Original' }
	];
	const carouselTemplates: { id: TemplateId; label: string }[] = [
		{ id: '1:1', label: '1:1' },
		{ id: '4:5', label: '4:5' },
		{ id: '16:9', label: '16:9' }
	];

	function measureBodyContentHeight(): number {
		const el = sidebarBodyEl;
		if (!el) return 0;
		let sum = 0;
		const kids = el.children;
		for (let i = 0; i < kids.length; i++) {
			sum += (kids[i] as HTMLElement).offsetHeight;
		}
		const style = getComputedStyle(el);
		if (kids.length > 1) {
			const gap = Number.parseFloat(style.rowGap || style.gap || '0') || 0;
			sum += gap * (kids.length - 1);
		}
		const padY =
			(Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
		return sum + padY;
	}

	function contentPanelHeight(): number {
		const barH = mobileBarEl?.offsetHeight ?? 0;
		return barH + measureBodyContentHeight();
	}

	function viewportPanelCap(): number {
		return Math.round(window.innerHeight * PANEL_H_MAX_VH);
	}

	function maxPanelHeight(): number {
		const vhMax = viewportPanelCap();
		const contentMax = contentPanelHeight();
		return contentMax > 0 ? Math.min(contentMax, vhMax) : vhMax;
	}

	function clampPanelHeight(h: number): number {
		const max = maxPanelHeight();
		const min = Math.min(PANEL_H_MIN, max);
		return Math.max(min, Math.min(max, Math.round(h)));
	}

	function updateScrollHints() {
		const el = sidebarBodyEl;
		let up = false;
		let down = false;
		if (el && !panelCollapsed) {
			const maxScroll = el.scrollHeight - el.clientHeight;
			up = maxScroll > 2 && el.scrollTop > 2;
			down = maxScroll > 2 && el.scrollTop < maxScroll - 2;
		}
		if (up !== canScrollUp) canScrollUp = up;
		if (down !== canScrollDown) canScrollDown = down;
	}

	function setPanelHeight(h: number) {
		const next = clampPanelHeight(h);
		if (next !== panelHeightPx) panelHeightPx = next;
	}

	async function fitPanelToContent(retries = 8, force = false) {
		const allow = untrack(
			() =>
				narrowUi &&
				!panelCollapsed &&
				!panelResizing &&
				hasImage &&
				(force || !panelManualHeight)
		);
		if (!allow) return;
		panelMeasuring = true;
		let best = 0;
		let prev = -1;
		const frames = force ? retries : Math.min(retries, 4);
		try {
			for (let i = 0; i < frames; i++) {
				await tick();
				await nextFrame();
				if (untrack(() => panelCollapsed || panelResizing || !narrowUi || !hasImage)) return;
				best = Math.max(best, contentPanelHeight());
				if (i > 1 && best >= PANEL_H_MIN && best === prev) break;
				prev = best;
			}
		} finally {
			panelMeasuring = false;
		}
		if (best <= 0) return;
		const next = Math.max(PANEL_H_MIN, Math.min(best, viewportPanelCap()));
		untrack(() => {
			panelHeightPx = next;
			heightByMode[appMode] = next;
		});
		await tick();
		updateScrollHints();
	}

	function revealPanelBottom() {
		if (!narrowUi || !hasImage || panelCollapsed) return;
		sidebarBodyEl?.scrollTo({ top: sidebarBodyEl.scrollHeight, behavior: 'smooth' });
		requestAnimationFrame(() => updateScrollHints());
	}

	async function restorePanelAfterExpand(mode: AppMode) {
		await tick();
		await nextFrame();
		await nextFrame();
		const storedH = heightByMode[mode] ?? readPanelState(mode).height;
		panelMeasuring = true;
		await tick();
		await nextFrame();
		const contentH = contentPanelHeight();
		panelMeasuring = false;
		const contentMax =
			contentH > 0 ? Math.min(contentH, viewportPanelCap()) : viewportPanelCap();
		if (storedH != null && storedH > 0) {
			panelHeightPx = Math.max(PANEL_H_MIN, Math.min(Math.round(storedH), contentMax));
			heightByMode[mode] = panelHeightPx;
		} else {
			await fitPanelToContent(10, true);
		}
		persistCurrentPanelState(mode);
		await tick();
		if (sidebarBodyEl) {
			sidebarBodyEl.scrollTop = scrollTopByMode[mode] ?? 0;
			updateScrollHints();
		}
	}

	function togglePanelCollapsed() {
		const mode = appMode;
		if (!panelCollapsed) {
			if (sidebarBodyEl) scrollTopByMode[mode] = sidebarBodyEl.scrollTop;
			heightByMode[mode] = panelHeightPx;
			panelCollapsed = true;
			persistCurrentPanelState(mode);
			canScrollUp = false;
			canScrollDown = false;
			return;
		}
		panelCollapsed = false;
		persistCurrentPanelState(mode);
		void restorePanelAfterExpand(mode);
	}

	function onPanelResizePointerDown(e: PointerEvent) {
		if (!narrowUi || panelCollapsed) return;
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		panelResizing = true;
		resizeStartY = e.clientY;
		resizeStartH = panelHeightPx;
	}

	function onPanelResizePointerMove(e: PointerEvent) {
		if (!panelResizing) return;
		setPanelHeight(resizeStartH + (resizeStartY - e.clientY));
		updateScrollHints();
	}

	function onPanelResizePointerUp(e: PointerEvent) {
		if (!panelResizing) return;
		panelResizing = false;
		panelManualHeight = true;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
		persistCurrentPanelState();
	}

	onMount(() => {
		const mq = window.matchMedia(MOBILE_MQ);
		const sync = () => {
			narrowUi = mq.matches;
		};
		sync();
		applyPanelState(appMode);
		lastPanelMode = appMode;
		lastHadImage = hasImage;
		panelReady = true;
		mq.addEventListener('change', sync);
		const onResize = () => {
			if (!narrowUi) return;
			if (panelManualHeight) {
				const next = clampPanelHeight(panelHeightPx);
				if (next !== panelHeightPx) panelHeightPx = next;
			} else {
				void fitPanelToContent();
			}
		};
		window.addEventListener('resize', onResize);
		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('resize', onResize);
		};
	});

	$effect(() => {
		if (!panelReady) return;
		const mode = appMode;
		const img = hasImage;
		const mobile = narrowUi;

		const modeChanged = lastPanelMode !== null && lastPanelMode !== mode;
		if (modeChanged) {
			const prevMode = lastPanelMode;
			removeConfirming = false;
			untrack(() => {
				if (sidebarBodyEl && !panelCollapsed) {
					scrollTopByMode[prevMode] = sidebarBodyEl.scrollTop;
				}
				persistCurrentPanelState(prevMode);
				applyPanelState(mode);
			});
			void (async () => {
				await tick();
				await nextFrame();
				untrack(() => {
					if (sidebarBodyEl && !panelCollapsed) {
						sidebarBodyEl.scrollTop = scrollTopByMode[mode] ?? 0;
						updateScrollHints();
					}
				});
			})();
		}
		lastPanelMode = mode;

		if (mobile && img && !lastHadImage && !modeChanged) {
			untrack(() => {
				panelCollapsed = false;
				panelManualHeight = false;
				delete heightByMode[mode];
			});
			void (async () => {
				await tick();
				await nextFrame();
				await fitPanelToContent(10, true);
				persistCurrentPanelState(mode);
			})();
		}
		lastHadImage = img;

		const shouldFit = untrack(
			() => img && mobile && !panelCollapsed && !panelManualHeight
		);
		if (!shouldFit) return;
		let cancelled = false;
		void (async () => {
			await tick();
			if (cancelled) return;
			await fitPanelToContent();
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const bt = borderType;
		if (!untrack(() => narrowUi && hasImage && !panelCollapsed)) return;
		if (lastBorderType === null) {
			lastBorderType = bt;
			return;
		}
		if (lastBorderType === bt) return;
		lastBorderType = bt;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => revealPanelBottom());
		});
	});
</script>

<aside
	class="sidebar"
	class:sidebar-collapsed={narrowUi && panelCollapsed}
	class:sidebar-mobile-empty={narrowUi && !hasImage}
	class:sidebar-measuring={narrowUi && panelMeasuring}
	style={narrowUi && hasImage && !panelCollapsed && !panelMeasuring
		? `--sidebar-mobile-h: ${panelHeightPx}px`
		: undefined}
>
	{#if narrowUi && hasImage}
		<div class="sidebar-mobile-bar" bind:this={mobileBarEl}>
			<button
				type="button"
				class="sidebar-resize-handle"
				aria-label="Resize controls panel"
				disabled={panelCollapsed}
				onpointerdown={onPanelResizePointerDown}
				onpointermove={onPanelResizePointerMove}
				onpointerup={onPanelResizePointerUp}
				onpointercancel={onPanelResizePointerUp}
			>
				<span class="sidebar-resize-grip" aria-hidden="true"></span>
			</button>
			<button
				type="button"
				class="sidebar-collapse-btn"
				aria-expanded={!panelCollapsed}
				aria-label={panelCollapsed ? 'Expand controls' : 'Collapse controls'}
				onclick={togglePanelCollapsed}
			>
				{panelCollapsed ? 'Controls' : 'Hide'}
				<span class="sidebar-collapse-chevron" aria-hidden="true">{panelCollapsed ? '▴' : '▾'}</span>
			</button>
		</div>
	{/if}
	<div
		class="sidebar-body-shell"
		class:sidebar-body-collapsed={narrowUi && panelCollapsed}
	>
		{#if narrowUi && hasImage && !panelCollapsed}
			<div class="sidebar-scroll-cue sidebar-scroll-cue-top" class:show={canScrollUp} aria-hidden="true">
				▴ More
			</div>
		{/if}
	<div
		class="sidebar-body"
		class:sidebar-disabled={disabled}
		aria-disabled={disabled}
		aria-hidden={narrowUi && panelCollapsed}
		bind:this={sidebarBodyEl}
		onscroll={updateScrollHints}
	>
		{#if appMode === 'crop' || appMode === 'stack'}
			<section class="control-group">
				<h2 class="control-label">Template</h2>
				<div class="template-row">
					{#each cropStackTemplates as t}
						<button
							class="sidebar-btn"
							class:selected={currentTemplateId === t.id}
							onclick={() => onSetTemplate(t.id)}
							type="button"
						>
							{t.label}
						</button>
					{/each}
					<button type="button" class="sidebar-btn aspect-more-chip" onclick={onOpenAspectPopup}>
						More…
					</button>
				</div>
				<button type="button" class="sidebar-btn aspect-more-btn" onclick={onOpenAspectPopup}>
					More ratios…
				</button>
				{#if appMode === 'crop' || appMode === 'stack'}
					<div class="sidebar-fill-row">
						<span class="control-label">Image in frame</span>
						<div class="border-type-row fill-buttons-row">
							<button type="button" class="sidebar-btn" class:selected={fillMode === 'contain'} onclick={onFillModeContain}>Fit</button>
							<button type="button" class="sidebar-btn" class:selected={fillMode === 'cover'} onclick={onFillModeCover}>Fill</button>
						</div>
					</div>
				{/if}
				{#if showCustomRatio}
					<div class="custom-ratio-row">
						<label class="custom-ratio-label">
							<span>Width</span>
							<input
								type="number"
								class="custom-ratio-input"
								min="0.1"
								step="0.1"
								bind:value={customRatioW}
								aria-label="Aspect width"
							/>
						</label>
						<span class="custom-ratio-sep">∶</span>
						<label class="custom-ratio-label">
							<span>Height</span>
							<input
								type="number"
								class="custom-ratio-input"
								min="0.1"
								step="0.1"
								bind:value={customRatioH}
								aria-label="Aspect height"
							/>
						</label>
					</div>
				{/if}
			</section>
		{:else if appMode === 'carousel'}
			<section class="control-group">
				<h2 class="control-label">Panel aspect</h2>
				<div class="template-row template-row-carousel">
					{#each carouselTemplates as t}
						<button
							class="sidebar-btn"
							class:selected={currentTemplateId === t.id}
							onclick={() => onSetTemplate(t.id)}
							type="button"
						>
							{t.label}
						</button>
					{/each}
					<button type="button" class="sidebar-btn aspect-more-chip" onclick={onOpenAspectPopup}>
						More…
					</button>
				</div>
				<button type="button" class="sidebar-btn aspect-more-btn" onclick={onOpenAspectPopup}>
					More ratios…
				</button>
			</section>
			<section class="control-group">
				<h2 class="control-label">Panels</h2>
				<div class="panel-dropdown-wrap">
					<button
						type="button"
						class="panel-dropdown-trigger sidebar-btn"
						aria-haspopup="listbox"
						aria-expanded={panelsDropdownOpen}
						aria-label="Number of panels"
						onclick={() => (panelsDropdownOpen = !panelsDropdownOpen)}
					>
						<span>{carouselPanelCountOverride === null ? `Auto (${carouselPanelCountAuto})` : carouselPanelCountOverride}</span>
						<span class="panel-dropdown-chevron" aria-hidden="true">▾</span>
					</button>
					{#if panelsDropdownOpen}
						<div
							class="panel-dropdown-backdrop"
							role="presentation"
							onclick={() => (panelsDropdownOpen = false)}
							ontouchstart={() => (panelsDropdownOpen = false)}
						></div>
						<div class="panel-dropdown-list" role="listbox">
							<button
								type="button"
								role="option"
								class="panel-dropdown-option"
								class:selected={carouselPanelCountOverride === null}
								aria-selected={carouselPanelCountOverride === null}
								onclick={() => {
									onCarouselPanelCountOverride(null);
									panelsDropdownOpen = false;
								}}
							>
								Auto ({carouselPanelCountAuto})
							</button>
							{#each Array.from({ length: carouselPanelCountAuto - 1 }, (_, i) => i + 2) as num}
								<button
									type="button"
									role="option"
									class="panel-dropdown-option"
									class:selected={carouselPanelCountOverride === num}
									aria-selected={carouselPanelCountOverride === num}
									onclick={() => {
										onCarouselPanelCountOverride(num);
										panelsDropdownOpen = false;
									}}
								>
									{num}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<p class="control-muted">{carouselPanelCount} panel{carouselPanelCount !== 1 ? 's' : ''}</p>
			</section>
		{/if}

		<section class="control-group">
			<h2 class="control-label">Border</h2>
			<div class="border-type-row">
				<button
					class="sidebar-btn"
					class:selected={borderType === 'auto'}
					onclick={() => onSetBorderType('auto')}
					type="button"
				>
					Auto
				</button>
				<button
					class="sidebar-btn"
					class:selected={borderType === 'blur'}
					onclick={() => onSetBorderType('blur')}
					type="button"
				>
					Blur
				</button>
				<button
					class="sidebar-btn"
					class:selected={borderType === 'solid'}
					onclick={() => onSetBorderType('solid')}
					type="button"
				>
					Solid
				</button>
			</div>
		</section>

		{#if appMode === 'crop' || appMode === 'stack'}
			<section class="control-group">
				<div class="slider-label">
					<span>Padding</span>
					<span>{padding}px</span>
				</div>
				<div class="slider-wrap" class:slider-active={sliderActive === 'padding'} style="--pct: {(padding / 400) * 100}%">
					<input
						type="range"
						class="slider slider-adobe"
						min="0"
						max="400"
						bind:value={padding}
						aria-label="Padding"
						onpointerdown={() => onSetSliderActive('padding')}
						onpointerup={() => onSetSliderActive(null)}
						onpointerleave={() => onSetSliderActive(null)}
						ontouchstart={() => onSetSliderActive('padding')}
						ontouchend={() => onSetSliderActive(null)}
						ontouchcancel={() => onSetSliderActive(null)}
					/>
				</div>
			</section>
		{:else}
			<section class="control-group">
				<div class="slider-label">
					<span>Zoom</span>
					<span>{carouselZoom}%</span>
				</div>
				<div class="slider-wrap" class:slider-active={sliderActive === 'zoom'} style="--pct: {carouselZoomMax > carouselZoomMin ? ((carouselZoom - carouselZoomMin) / (carouselZoomMax - carouselZoomMin)) * 100 : 0}%">
					<input
						type="range"
						class="slider slider-adobe"
						min={carouselZoomMin}
						max={carouselZoomMax}
						bind:value={carouselZoom}
						aria-label="Zoom"
						onpointerdown={() => onSetSliderActive('zoom')}
						onpointerup={() => onSetSliderActive(null)}
						onpointerleave={() => onSetSliderActive(null)}
						ontouchstart={() => onSetSliderActive('zoom')}
						ontouchend={() => onSetSliderActive(null)}
						ontouchcancel={() => onSetSliderActive(null)}
					/>
				</div>
			</section>
		{/if}

		{#if borderType === 'blur'}
			<section class="control-group">
				<div class="slider-label">
					<span>Blur</span>
					<span>{blurStrength}%</span>
				</div>
				<div class="slider-wrap" class:slider-active={sliderActive === 'blur'} style="--pct: {blurStrength}%">
					<input
						type="range"
						class="slider slider-adobe"
						min="0"
						max="100"
						bind:value={blurStrength}
						aria-label="Blur"
						onpointerdown={() => onSetSliderActive('blur')}
						onpointerup={() => onSetSliderActive(null)}
						onpointerleave={() => onSetSliderActive(null)}
						ontouchstart={() => onSetSliderActive('blur')}
						ontouchend={() => onSetSliderActive(null)}
						ontouchcancel={() => onSetSliderActive(null)}
					/>
				</div>
			</section>
		{/if}

		{#if borderType === 'solid'}
			<section class="control-group">
				<div class="slider-label">Color</div>
				<div class="color-row">
					<input type="color" class="color-picker" bind:value={solidColor} />
					<input type="text" class="color-hex" bind:value={solidColor} placeholder="#ffffff" />
				</div>
			</section>
		{/if}

		{#if showCropRemoveImage || showCarouselRemoveImage}
			<section class="control-group remove-image-group">
				{#if removeConfirming}
					<p class="control-muted">Remove this image?</p>
					<div class="remove-confirm-row">
						<button type="button" class="sidebar-btn" onclick={() => (removeConfirming = false)}>
							Cancel
						</button>
						<button
							type="button"
							class="sidebar-btn remove-image-btn"
							onclick={() => {
								removeConfirming = false;
								if (showCropRemoveImage) onClearCropImage();
								else onClearCarouselImage();
							}}
						>
							Remove
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="sidebar-btn remove-image-btn"
						onclick={() => (removeConfirming = true)}
					>
						Remove image
					</button>
				{/if}
			</section>
		{/if}
	</div>
		{#if narrowUi && hasImage && !panelCollapsed}
			<div class="sidebar-scroll-cue sidebar-scroll-cue-bottom" class:show={canScrollDown} aria-hidden="true">
				▾ More
			</div>
		{/if}
	</div>
</aside>

<style>
	.sidebar {
		width: var(--sidebar-width);
		flex-shrink: 0;
		min-height: 0;
		background: var(--bg-panel);
		border-left: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.sidebar-fill-row {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	.sidebar-fill-row .fill-buttons-row {
		flex-wrap: nowrap;
	}
	.sidebar-body-shell {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}
	.sidebar-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		touch-action: pan-y;
		scrollbar-width: thin;
		scrollbar-color: var(--track-dark) transparent;
	}
	.sidebar-scroll-cue {
		display: none;
	}
	.sidebar-body.sidebar-disabled {
		opacity: 0.85;
		filter: saturate(0.25) brightness(0.9);
	}
	.sidebar-body.sidebar-disabled button,
	.sidebar-body.sidebar-disabled input,
	.sidebar-body.sidebar-disabled select,
	.sidebar-body.sidebar-disabled textarea {
		pointer-events: none;
	}
	.sidebar-body.sidebar-disabled .sidebar-btn.selected {
		border-color: var(--border-subtle);
		background: var(--bg-input);
		color: var(--text-secondary);
	}
	.control-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.control-label {
		font-size: var(--font-size-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		margin: 0;
	}
	.control-muted {
		font-size: var(--font-size-ui);
		color: var(--text-secondary);
		margin: 0;
	}
	.panel-dropdown-wrap {
		position: relative;
	}
	.panel-dropdown-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.panel-dropdown-chevron {
		opacity: 0.7;
		font-size: 0.75em;
	}
	.panel-dropdown-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
	}
	.panel-dropdown-list {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		padding: 4px;
		border-radius: var(--radius);
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 11;
		max-height: 240px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		scrollbar-width: thin;
		scrollbar-color: var(--track-dark) transparent;
	}
	.sidebar-body::-webkit-scrollbar,
	.panel-dropdown-list::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}
	.sidebar-body::-webkit-scrollbar-track,
	.panel-dropdown-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.sidebar-body::-webkit-scrollbar-thumb,
	.panel-dropdown-list::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--track-dark) 75%, transparent);
		border-radius: 999px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	.sidebar-body::-webkit-scrollbar-thumb:hover,
	.panel-dropdown-list::-webkit-scrollbar-thumb:hover {
		background: color-mix(in srgb, var(--track-light) 65%, transparent);
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	.panel-dropdown-option {
		display: block;
		width: 100%;
		min-height: 32px;
		padding: 6px 12px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text);
		font-size: var(--font-size-ui);
		text-align: left;
		cursor: pointer;
	}
	.panel-dropdown-option:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.panel-dropdown-option.selected {
		background: rgba(59, 99, 251, 0.2);
		color: #a5b8ff;
	}
	.template-row,
	.border-type-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.custom-ratio-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.custom-ratio-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-size-ui);
		color: var(--text-secondary);
	}
	.custom-ratio-label span {
		min-width: 2.5em;
	}
	.custom-ratio-input {
		width: 64px;
		min-height: 36px;
		padding: 6px 10px;
		border-radius: var(--radius);
		border: 1px solid var(--border-subtle);
		background: var(--bg-input);
		color: var(--text);
		font-size: var(--font-size-ui);
	}
	.custom-ratio-sep {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.sidebar-btn {
		min-height: 36px;
		min-width: 44px;
		padding: 8px 12px;
		border-radius: var(--radius);
		border: 1px solid var(--border-subtle);
		background: var(--bg-input);
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.sidebar-btn:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.sidebar-btn.selected {
		border-color: var(--adobe-blue);
		background: rgba(59, 99, 251, 0.2);
		color: #a5b8ff;
	}
	.aspect-more-chip {
		display: none;
	}
	.aspect-more-btn {
		width: 100%;
		margin-top: 4px;
	}
	.remove-image-group {
		margin-top: auto;
		padding-top: 8px;
	}
	.remove-image-btn {
		width: 100%;
		color: var(--text-primary);
	}
	.remove-image-btn:hover {
		color: var(--error, #e88);
		border-color: rgba(200, 80, 80, 0.45);
		background: rgba(180, 50, 50, 0.12);
	}
	.remove-confirm-row {
		display: flex;
		gap: 8px;
	}
	.remove-confirm-row .sidebar-btn {
		flex: 1;
	}
	.slider-label {
		display: flex;
		justify-content: space-between;
		font-size: var(--font-size-label);
		color: var(--text-secondary);
	}
	.slider-wrap {
		--pct: 0%;
		--thumb-ring-inset: 2px;
		position: relative;
		width: 100%;
	}
	.slider-wrap.slider-active {
		--thumb-ring-inset: 7px;
	}
	.slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--bg-input);
		outline: none;
		display: block;
	}
	.slider-adobe {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, var(--track-light) 0%, var(--track-light) var(--pct), var(--track-dark) var(--pct), var(--track-dark) 100%);
		outline: none;
	}
	.slider-adobe::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: transparent;
	}
	.slider-adobe::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 22px;
		height: 22px;
		min-width: 22px;
		min-height: 22px;
		margin-top: -9px;
		border-radius: 50%;
		background: var(--bg-panel);
		border: none;
		box-shadow:
			inset 0 0 0 var(--thumb-ring-inset) var(--track-light),
			0 0 0 2px var(--bg-panel);
		cursor: pointer;
		outline: none;
		transition: box-shadow 0.2s ease-out;
	}
	.slider-adobe::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: transparent;
	}
	.slider-adobe::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--bg-panel);
		border: none;
		box-shadow:
			inset 0 0 0 var(--thumb-ring-inset) var(--track-light),
			0 0 0 2px var(--bg-panel);
		cursor: pointer;
		outline: none;
		transition: box-shadow 0.2s ease-out;
	}
	.color-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.color-picker {
		width: 40px;
		height: 40px;
		padding: 0;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		cursor: pointer;
		background: var(--bg-input);
	}
	.color-hex {
		flex: 1;
		min-height: 40px;
		padding: 0 12px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		background: var(--bg-input);
		color: var(--text-primary);
		font-size: var(--font-size-ui);
		font-family: inherit;
	}
	@media (max-width: 767px) {
		.sidebar {
			width: 100%;
			flex: 0 0 auto;
			height: var(--sidebar-mobile-h, 42dvh);
			max-height: 85dvh;
			min-height: 0;
			border-left: none;
			border-top: 1px solid var(--border-subtle);
		}
		.sidebar.sidebar-collapsed {
			height: auto;
			max-height: none;
		}
		.sidebar.sidebar-measuring {
			height: auto;
			max-height: 85dvh;
		}
		.sidebar.sidebar-measuring .sidebar-body-shell {
			flex: 0 0 auto;
		}
		.sidebar.sidebar-measuring .sidebar-body {
			flex: 0 0 auto;
			height: auto;
			overflow: visible;
		}
		.sidebar.sidebar-mobile-empty {
			display: none;
		}
		.sidebar-body-shell.sidebar-body-collapsed {
			display: none;
		}
		.sidebar-scroll-cue {
			position: absolute;
			left: 0;
			right: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			height: 24px;
			opacity: 0;
			pointer-events: none;
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			color: var(--text-secondary);
			transition: opacity 0.15s;
			z-index: 2;
		}
		.sidebar-scroll-cue.show {
			opacity: 1;
		}
		.sidebar-scroll-cue-top {
			top: 0;
			background: linear-gradient(to bottom, var(--bg-panel) 55%, transparent);
		}
		.sidebar-scroll-cue-bottom {
			bottom: 0;
			background: linear-gradient(to top, var(--bg-panel) 55%, transparent);
		}
		.sidebar-mobile-bar {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 2px 8px 0;
			border-bottom: 1px solid var(--border-subtle);
			background: var(--bg-panel);
		}
		.sidebar-resize-handle {
			flex: 1;
			min-height: 28px;
			margin: 0;
			padding: 0;
			border: none;
			background: transparent;
			cursor: ns-resize;
			touch-action: none;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.sidebar-resize-handle:disabled {
			cursor: default;
			opacity: 0.35;
		}
		.sidebar-resize-grip {
			width: 36px;
			height: 4px;
			border-radius: 2px;
			background: rgba(255, 255, 255, 0.22);
		}
		.sidebar-collapse-btn {
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			min-height: 32px;
			padding: 4px 10px;
			border: none;
			border-radius: var(--radius);
			background: transparent;
			color: var(--text-secondary);
			font-size: 12px;
			font-weight: 500;
			cursor: pointer;
		}
		.sidebar-collapse-btn:hover {
			background: rgba(255, 255, 255, 0.06);
			color: var(--text-primary);
		}
		.sidebar-collapse-chevron {
			font-size: 11px;
			opacity: 0.8;
		}
		.sidebar-body {
			padding: 8px 12px 10px;
			gap: 8px;
		}
		.control-group {
			gap: 6px;
		}
		.control-label {
			font-size: 11px;
			letter-spacing: 0.04em;
		}
		.template-row {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 6px;
			overflow: visible;
		}
		.template-row-carousel {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
		.border-type-row {
			gap: 6px;
			flex-wrap: nowrap;
		}
		.sidebar-btn {
			min-height: 32px;
			min-width: 0;
			padding: 5px 4px;
			font-size: 11px;
			flex: 1 1 0;
		}
		.template-row .sidebar-btn {
			width: 100%;
			padding: 5px 2px;
		}
		.aspect-more-chip {
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}
		.aspect-more-btn {
			display: none;
		}
		.sidebar-fill-row {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
		}
		.sidebar-fill-row .control-label {
			margin: 0;
			flex-shrink: 0;
		}
		.sidebar-fill-row .fill-buttons-row {
			flex: 1;
			min-width: 0;
		}
		.sidebar-fill-row .sidebar-btn {
			flex: 1;
		}
		.slider-label {
			font-size: 11px;
		}
		.color-picker {
			width: 34px;
			height: 34px;
		}
		.color-hex {
			min-height: 34px;
		}
	}
</style>
