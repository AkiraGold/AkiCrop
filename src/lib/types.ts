export type TemplateId = '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1' | '3:2' | '2:3' | 'original' | 'custom';

export interface Template {
	id: TemplateId;
	label: string;
	/** width / height; 0 = image aspect; custom uses state */
	ratio: number;
}

export type BorderType = 'solid' | 'blur' | 'auto';

export interface SourceRect {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

export type FillMode = 'contain' | 'cover';

export interface RenderOptions {
	image: ImageBitmap | HTMLImageElement;
	templateRatio: number;
	padding: number;
	borderType: BorderType;
	blurStrength: number; // 0–100
	solidColor: string;
	width: number;
	height: number;
	sourceRect?: SourceRect;
	fillMode?: FillMode;
	zoom?: number;
}

export const TEMPLATES: Template[] = [
	{ id: '1:1', label: 'Square', ratio: 1 },
	{ id: '4:5', label: 'Portrait (4:5)', ratio: 4 / 5 },
	{ id: '9:16', label: 'Story (9:16)', ratio: 9 / 16 },
	{ id: '16:9', label: 'Landscape (16:9)', ratio: 16 / 9 },
	{ id: '1.91:1', label: 'Wide (1.91:1)', ratio: 1.91 },
	{ id: '3:2', label: '3:2', ratio: 3 / 2 },
	{ id: '2:3', label: '2:3', ratio: 2 / 3 },
	{ id: 'original', label: 'Original', ratio: 0 },
	{ id: 'custom', label: 'Custom', ratio: 1 }
];

export const INSTAGRAM_PRESETS: TemplateId[] = ['1:1', '4:5', '9:16', '1.91:1'];
export const WIDE_PRESETS: TemplateId[] = ['16:9', '1.91:1', '3:2'];
export const TALL_PRESETS: TemplateId[] = ['4:5', '9:16', '2:3'];
