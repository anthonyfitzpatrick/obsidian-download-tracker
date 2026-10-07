import { moment } from 'obsidian';

// Obsidian bundles moment, but its typings only resolve when the moment package is
// installed beside obsidian, so every call goes through this one typed signature.
interface MomentLike {
	format(pattern: string): string;
	localeData(): { longDateFormat(key: string): string };
}
const at = moment as unknown as (time?: number) => MomentLike;

// Obsidian sets moment's locale from its language, so 'll' and 'lll' follow it.
export function formatTime(time: number, pattern: string): string {
	return at(time).format(pattern);
}

export function languageDatePattern(): string {
	return at().localeData().longDateFormat('ll');
}
