<script lang="ts">
	interface Panel {
		url: string;
		blob: Blob;
	}
	interface ResolutionPreset {
		id: string;
		label: string;
		maxSize: number | null;
	}
	interface Props {
		open: boolean;
		kind: 'carousel' | 'stack' | 'crop' | null;
		panels: Panel[];
		canUseShare: boolean;
		exportFormat: 'image/png' | 'image/jpeg';
		onSetExportFormat: (format: 'image/png' | 'image/jpeg') => void;
		exportQuality: number;
		exportResolutionId: string;
		onSetExportResolutionId: (id: string) => void;
		resolutionPresets: ResolutionPreset[];
		onExportOptionsChange?: () => void;
		regenerating?: boolean;
		onClose: () => void;
		onShareAll: () => void;
		onDownloadAll: () => void;
		onSharePanel: (panel: Panel, index: number) => void;
		onDownloadPanel: (panel: Panel, index: number) => void;
	}
	let {
		open,
		kind,
		panels,
		canUseShare,
		exportFormat,
		onSetExportFormat,
		exportQuality = $bindable(),
		exportResolutionId,
		onSetExportResolutionId,
		resolutionPresets,
		onExportOptionsChange,
		regenerating = false,
		onClose,
		onShareAll,
		onDownloadAll,
		onSharePanel,
		onDownloadPanel
	}: Props = $props();

	let resolutionDropdownOpen = $state(false);
	let qualitySliderActive = $state(false);

	function handleFormatChange(format: 'image/png' | 'image/jpeg') {
		onSetExportFormat(format);
		onExportOptionsChange?.();
	}
	function handleResolutionChange(id: string) {
		onSetExportResolutionId(id);
		resolutionDropdownOpen = false;
		onExportOptionsChange?.();
	}
	function handleQualityCommit() {
		onExportOptionsChange?.();
	}
</script>

{#if open}
	<div
		class="export-preview-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Export preview"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div class="export-preview-box">
			<div class="export-preview-header">
				<h2 class="export-preview-title">Export preview</h2>
				<button type="button" class="export-preview-close" aria-label="Close" onclick={onClose}>×</button>
			</div>
			<div class="export-preview-options">
				<div class="export-option-row">
					<span class="export-option-label">Format</span>
					<div class="export-option-buttons">
						<button
							type="button"
							class="export-option-btn"
							class:selected={exportFormat === 'image/png'}
							onclick={() => handleFormatChange('image/png')}
							aria-pressed={exportFormat === 'image/png'}
							title="Lossless compression, no quality loss"
						>
							PNG (lossless)
						</button>
						<button
							type="button"
							class="export-option-btn"
							class:selected={exportFormat === 'image/jpeg'}
							onclick={() => handleFormatChange('image/jpeg')}
							aria-pressed={exportFormat === 'image/jpeg'}
							title="Lossy compression, smaller files"
						>
							JPEG (lossy)
						</button>
					</div>
				</div>
				{#if exportFormat === 'image/jpeg'}
					<div class="export-option-row export-quality-row">
						<div class="export-slider-label">
							<span class="export-option-label">Quality</span>
							<span>{Math.round(exportQuality * 100)}%</span>
						</div>
						<div
							class="export-slider-wrap"
							class:slider-active={qualitySliderActive}
							style="--pct: {(exportQuality - 0.1) / 0.9 * 100}%"
						>
							<input
								type="range"
								class="export-slider slider-adobe"
								min="0.1"
								max="1"
								step="0.01"
								bind:value={exportQuality}
								aria-label="JPEG quality"
								onpointerdown={() => (qualitySliderActive = true)}
								onpointerup={() => {
									qualitySliderActive = false;
									handleQualityCommit();
								}}
								onpointerleave={() => (qualitySliderActive = false)}
								ontouchstart={() => (qualitySliderActive = true)}
								ontouchend={() => {
									qualitySliderActive = false;
									handleQualityCommit();
								}}
								ontouchcancel={() => (qualitySliderActive = false)}
							/>
						</div>
					</div>
				{/if}
				<div class="export-option-row">
					<span class="export-option-label">Resolution</span>
					<div class="export-resolution-wrap">
						<button
							type="button"
							class="export-option-btn export-resolution-trigger"
							aria-haspopup="listbox"
							aria-expanded={resolutionDropdownOpen}
							aria-label="Export resolution"
							onclick={() => (resolutionDropdownOpen = !resolutionDropdownOpen)}
						>
							{resolutionPresets.find((p) => p.id === exportResolutionId)?.label ?? 'Original'}
							<span class="export-resolution-chevron" aria-hidden="true">▾</span>
						</button>
						{#if resolutionDropdownOpen}
							<div
								class="export-resolution-backdrop"
								role="presentation"
								onclick={() => (resolutionDropdownOpen = false)}
								ontouchstart={() => (resolutionDropdownOpen = false)}
							></div>
							<div class="export-resolution-list" role="listbox">
								{#each resolutionPresets as preset}
									<button
										type="button"
										role="option"
										class="export-resolution-option"
										class:selected={exportResolutionId === preset.id}
										aria-selected={exportResolutionId === preset.id}
										onclick={() => handleResolutionChange(preset.id)}
									>
										{preset.label}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
			<div class="export-preview-strip-wrap">
				{#if regenerating}
					<div class="export-preview-loading" aria-hidden="true">
						<div class="export-preview-spinner"></div>
					</div>
				{/if}
				<div class="export-preview-strip" class:single={panels.length === 1}>
					{#each panels as panel, i}
						<div class="export-preview-panel">
							<div class="export-preview-thumb">
								<img src={panel.url} alt="Panel {i + 1}" />
								<span class="export-preview-index" aria-hidden="true">{i + 1}</span>
								{#if canUseShare}
									<button
										type="button"
										class="export-preview-panel-btn"
										onclick={() => onSharePanel(panel, i)}
										disabled={regenerating}
										title="Share this panel"
									>
										Share
									</button>
								{:else}
									<button
										type="button"
										class="export-preview-panel-btn"
										onclick={() => onDownloadPanel(panel, i)}
										disabled={regenerating}
										title="Download this panel"
									>
										Download
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
			<div class="export-preview-actions">
				{#if canUseShare}
					<button
						type="button"
						class="btn btn-primary"
						onclick={onShareAll}
						disabled={regenerating}
						title={panels.length === 1 ? 'Share exported image' : 'Share all exported panels'}
					>
						{panels.length === 1 ? 'Share' : 'Share all'}
					</button>
				{/if}
				<button
					type="button"
					class="btn {canUseShare ? 'btn-secondary' : 'btn-primary'}"
					onclick={onDownloadAll}
					disabled={regenerating}
					title={panels.length === 1 ? 'Download exported image' : 'Download all exported panels'}
				>
					{panels.length === 1 ? 'Download' : 'Download all'}
				</button>
				<button type="button" class="btn btn-secondary" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.export-preview-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 24px;
		box-sizing: border-box;
	}
	.export-preview-box {
		position: relative;
		background: var(--bg-panel);
		border-radius: var(--radius);
		border: 1px solid var(--border-subtle);
		width: min(480px, 100%);
		max-height: calc(100vh - 48px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
	}
	.export-preview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.export-preview-title {
		margin: 0;
		font-size: var(--font-size-title);
		font-weight: 600;
		color: var(--text-primary);
	}
	.export-preview-close {
		width: 36px;
		height: 36px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		border-radius: var(--radius);
		padding: 0;
	}
	.export-preview-close:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}
	.export-preview-options {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px 24px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.export-option-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.export-option-label {
		font-size: var(--font-size-ui);
		color: var(--text-secondary);
		min-width: 72px;
	}
	.export-option-buttons {
		display: flex;
		gap: 8px;
	}
	.export-option-btn {
		padding: 8px 14px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		background: var(--bg-input);
		color: var(--text-primary);
		font-size: var(--font-size-ui);
		cursor: pointer;
	}
	.export-option-btn:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.export-option-btn.selected {
		border-color: var(--adobe-blue);
		background: rgba(59, 99, 251, 0.15);
		color: var(--adobe-blue);
	}
	.export-quality-row {
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
	}
	.export-slider-label {
		display: flex;
		justify-content: space-between;
		font-size: var(--font-size-ui);
		color: var(--text-secondary);
	}
	.export-slider-wrap {
		--pct: 0%;
		--thumb-ring-inset: 2px;
		position: relative;
		width: 100%;
	}
	.export-slider-wrap.slider-active {
		--thumb-ring-inset: 7px;
	}
	.export-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--bg-input);
		outline: none;
		display: block;
	}
	.export-slider.slider-adobe {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, var(--track-light) 0%, var(--track-light) var(--pct), var(--track-dark) var(--pct), var(--track-dark) 100%);
		outline: none;
	}
	.export-slider.slider-adobe::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: transparent;
	}
	.export-slider.slider-adobe::-webkit-slider-thumb {
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
	.export-slider.slider-adobe::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: transparent;
	}
	.export-slider.slider-adobe::-moz-range-thumb {
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
	.export-resolution-wrap {
		position: relative;
	}
	.export-resolution-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 120px;
	}
	.export-resolution-chevron {
		opacity: 0.7;
		font-size: 0.75em;
	}
	.export-resolution-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1;
	}
	.export-resolution-list {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 4px;
		background: var(--bg-panel);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
		min-width: 100%;
		z-index: 2;
		max-height: 200px;
		overflow-y: auto;
	}
	.export-resolution-option {
		display: block;
		width: 100%;
		padding: 10px 14px;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-size: var(--font-size-ui);
		text-align: left;
		cursor: pointer;
	}
	.export-resolution-option:hover,
	.export-resolution-option.selected {
		background: rgba(255, 255, 255, 0.08);
	}
	.export-preview-strip-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.export-preview-loading {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 5;
		border-radius: var(--radius);
	}
	.export-preview-spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--adobe-blue);
		border-radius: 50%;
		animation: export-spin 0.8s linear infinite;
	}
	@keyframes export-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.export-preview-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		padding: 14px 16px;
		overflow-x: hidden;
		overflow-y: auto;
		align-content: start;
		min-height: 0;
		flex: 1;
		background: rgba(0, 0, 0, 0.18);
	}
	.export-preview-strip.single {
		grid-template-columns: minmax(0, 280px);
		justify-content: center;
	}
	.export-preview-panel {
		min-width: 0;
		line-height: 0;
	}
	.export-preview-thumb {
		position: relative;
		display: block;
		width: 100%;
		line-height: 0;
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.08),
			0 2px 8px rgba(0, 0, 0, 0.4);
		transition: box-shadow 0.15s, transform 0.15s;
	}
	.export-preview-panel:hover .export-preview-thumb,
	.export-preview-panel:focus-within .export-preview-thumb {
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.16),
			0 4px 14px rgba(0, 0, 0, 0.5);
		transform: translateY(-1px);
	}
	.export-preview-thumb img {
		display: block;
		width: 100%;
		height: auto;
		background: transparent;
	}
	.export-preview-index {
		position: absolute;
		top: 5px;
		left: 5px;
		min-width: 17px;
		height: 17px;
		padding: 0 5px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		color: #fff;
		font-size: 10px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 17px;
		text-align: center;
		pointer-events: none;
		z-index: 1;
	}
	.export-preview-panel-btn {
		position: absolute;
		left: 50%;
		bottom: 5px;
		transform: translateX(-50%);
		z-index: 1;
		min-height: 22px;
		padding: 2px 10px;
		border: none;
		border-radius: 4px;
		background: rgba(18, 18, 18, 0.82);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		color: #fff;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s, background 0.12s;
		white-space: nowrap;
	}
	.export-preview-panel:hover .export-preview-panel-btn,
	.export-preview-panel:focus-within .export-preview-panel-btn {
		opacity: 1;
	}
	.export-preview-panel-btn:hover:not(:disabled) {
		background: rgba(59, 99, 251, 0.92);
	}
	.export-preview-panel-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	@media (hover: none) {
		.export-preview-panel-btn:not(:disabled) {
			opacity: 1;
		}
	}
	.export-preview-actions {
		display: flex;
		gap: 12px;
		padding: 12px 16px;
		border-top: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	@media (max-width: 767px) {
		.export-preview-overlay {
			padding: 12px;
		}
		.export-preview-box {
			width: 100%;
			max-height: calc(100dvh - 24px);
		}
		.export-preview-options {
			padding: 10px 12px;
			gap: 8px;
		}
		.export-preview-strip {
			grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
			padding: 10px 12px;
			gap: 6px;
		}
		.export-preview-strip.single {
			grid-template-columns: minmax(0, 220px);
		}
		.export-preview-actions {
			padding: 10px 12px;
			gap: 8px;
		}
	}
</style>
