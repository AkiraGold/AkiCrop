<script lang="ts">
	import type { AppMode } from '#lib/constants.js';

	interface Props {
		appMode: AppMode;
		exportLoading: boolean;
		canExport: boolean;
		onExport: () => void;
	}
	let { appMode, exportLoading, canExport, onExport }: Props = $props();
</script>

<header class="topbar">
	<div class="topbar-brand">
		<h1 class="topbar-title">AkiCrop</h1>
		<a
			class="topbar-projects"
			href="https://virtualc.xyz"
			target="_blank"
			rel="noopener noreferrer"
			title="Projects"
			aria-label="Projects"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M15 3h6v6" />
				<path d="M10 14 21 3" />
				<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
			</svg>
			<span class="topbar-projects-label">Projects</span>
		</a>
	</div>
	<div class="topbar-mode" role="group" aria-label="Mode">
		<a href="?mode=crop" class="topbar-mode-btn" class:selected={appMode === 'crop'} title="Crop">Crop</a>
		<a href="?mode=carousel" class="topbar-mode-btn" class:selected={appMode === 'carousel'} title="Carousel">Carousel</a>
		<a href="?mode=stack" class="topbar-mode-btn" class:selected={appMode === 'stack'} title="Stack">Stack</a>
	</div>
	<button
		class="btn btn-primary topbar-export"
		disabled={!canExport || exportLoading}
		onclick={onExport}
		title={appMode === 'stack' ? 'Export stack' : appMode === 'carousel' ? 'Export carousel' : 'Export (Ctrl+S)'}
	>
		{exportLoading ? 'Exporting…' : 'Export'}
	</button>
</header>

<style>
	.topbar {
		height: var(--topbar-height);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		gap: 12px;
		background: var(--bg-panel);
		border-bottom: 1px solid var(--border-subtle);
	}
	.topbar-brand {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.topbar-title {
		font-size: var(--font-size-title);
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}
	.topbar-projects {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: var(--radius);
		color: var(--text-secondary);
		font-size: var(--font-size-label);
		font-weight: 500;
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}
	.topbar-projects:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}
	.topbar-mode {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-input);
		border-radius: var(--radius);
		padding: 2px;
	}
	.topbar-mode-btn {
		display: inline-block;
		padding: 6px 12px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: var(--font-size-label);
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.topbar-mode-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}
	.topbar-mode-btn.selected {
		background: var(--adobe-blue);
		color: white;
	}
	@media (max-width: 767px) {
		.topbar {
			height: auto;
			min-height: var(--topbar-height);
			flex-wrap: wrap;
			padding: 8px 10px;
			gap: 8px;
			row-gap: 8px;
		}
		.topbar-brand {
			gap: 4px;
			order: 1;
		}
		.topbar-projects {
			padding: 6px 8px;
			min-height: 36px;
		}
		.topbar-export {
			order: 2;
			margin-left: auto;
			min-height: 36px;
			padding: 8px 12px;
		}
		.topbar-mode {
			order: 3;
			flex: 1 1 100%;
			width: 100%;
		}
		.topbar-mode-btn {
			flex: 1;
			text-align: center;
			padding: 8px 6px;
			min-height: 36px;
		}
	}
</style>
