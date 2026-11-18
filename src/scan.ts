// 文書の行を読んで、装飾する行を見つける（Obsidian と CodeMirror に依存しない）

export type TargetKind =
	| 'code' // ノート行に置いたコードブロックの行
	| 'code-item' // 項目の行で始まるフェンス（`- ```txt`）
	| 'quote' // ノート行の引用
	| 'quote-item' // 項目の行に直接書いた引用（`- > ...`）
	| 'plain'; // 箇条書きの中の、引用でもコードでもない行

export interface Target {
	/** 1 から数えた行番号 */
	line: number;
	kind: TargetKind;
	/** 親の項目の行頭の記号まで（例 `\t- `）。本文の開始位置を測るときのキー */
	parent: string;
	/** 隠す行頭の空白の文字数 */
	hide: number;
	/** `>` と続く空白1つの、行頭からの位置と文字数（引用のときだけ） */
	markerFrom: number;
	marker: number;
	/** コードブロックや、続いた引用の行のかたまりの、最初の行か（上に余白を空ける） */
	first?: boolean;
	/** かたまりの最後の行か（下に余白を空ける） */
	last?: boolean;
	/** コードブロックの閉じるフェンスの行か */
	closing?: boolean;
	/** コードブロックと引用の行で、続きの行の頭に置く文字列（複数行を貼り付けたとき、2行目以降に足す）。
	 * コードブロックは字下げの空白、引用はそれに `> ` を付けたもの */
	indent?: string;
}

export interface Item {
	line: number;
	prefix: string;
}

export interface ScanResult {
	targets: Target[];
	/** すべての項目の行（本文の開始位置を測るため） */
	items: Item[];
}

interface ListItem {
	indentCol: number;
	contentCol: number;
	prefix: string;
}

interface Fence {
	char: string;
	len: number;
	parent: ListItem | null;
	/** 中の行で隠す空白の桁数（フェンスの行のインデント） */
	hideCols: number;
	/** 中の行の頭に置く空白 */
	indent: string;
}

const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TASK_RE = /^\[.\][ \t]+/;
const FENCE_RE = /^(`{3,}|~{3,})/;

/** 文字列の幅を桁数で返す（タブは次のタブ位置まで） */
export function columns(s: string, tabSize: number): number {
	let c = 0;
	for (const ch of s) c = ch === '\t' ? c + tabSize - (c % tabSize) : c + 1;
	return c;
}

/** 行頭の空白のうち、cols 桁までの文字数 */
function charsForColumns(text: string, cols: number, tabSize: number): number {
	let c = 0;
	let i = 0;
	while (i < text.length && c < cols) {
		const ch = text[i];
		if (ch === ' ') c += 1;
		else if (ch === '\t') c += tabSize - (c % tabSize);
		else break;
		i++;
	}
	return i;
}

function leadingSpace(text: string): string {
	return /^[ \t]*/.exec(text)?.[0] ?? '';
}

function isClosingFence(body: string, fence: Fence): boolean {
	let i = 0;
	while (body[i] === fence.char) i++;
	return i >= fence.len && body.slice(i).trim() === '';
}

function quoteMarker(text: string, from: number): number {
	const next = text[from + 1];
	return next === ' ' || next === '\t' ? 2 : 1;
}

export function scan(lines: readonly string[], tabSize: number): ScanResult {
	const targets: Target[] = [];
	const items: Item[] = [];
	const stack: ListItem[] = [];
	let fence: Fence | null = null;
	let start = 0;

	// フロントマターは飛ばす
	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1);
		if (end > 0) start = end + 1;
	}

	for (let i = start; i < lines.length; i++) {
		const text = lines[i] ?? '';
		const line = i + 1;
		const space = leadingSpace(text);
		const body = text.slice(space.length);
		const cols = columns(space, tabSize);

		if (fence) {
			const parent = fence.parent;
			// 箇条書きの外のコードブロックは、閉じるまで読み飛ばす
			if (!parent) {
				if (isClosingFence(body, fence)) fence = null;
				continue;
			}
			// 親の本文より浅い行が来たら、コードブロックも項目も終わる
			if (body !== '' && cols < parent.contentCol) {
				const last = targets[targets.length - 1];
				if (last) last.last = true;
				fence = null;
			} else {
				const closing = isClosingFence(body, fence);
				targets.push({
					line,
					kind: 'code',
					parent: parent.prefix,
					hide: charsForColumns(text, fence.hideCols, tabSize),
					indent: fence.indent,
					markerFrom: 0,
					marker: 0,
					last: closing,
					closing,
				});
				if (closing) fence = null;
				continue;
			}
		}

		const m = ITEM_RE.exec(text);
		if (m) {
			const marker = m[0];
			const task = TASK_RE.exec(text.slice(marker.length))?.[0] ?? '';
			const prefix = marker + task;
			const item: ListItem = {
				indentCol: columns(m[1] ?? '', tabSize),
				contentCol: columns(marker, tabSize),
				prefix,
			};
			while (stack.length && (stack[stack.length - 1]?.indentCol ?? 0) >= item.indentCol) stack.pop();
			stack.push(item);
			items.push({ line, prefix });

			const rest = text.slice(prefix.length);
			const f = FENCE_RE.exec(rest)?.[1];
			// 続きの行は、記号の幅の分だけ空白で字下げする（例 `\t- ```js` なら `\t  `）
			const indent = (m[1] ?? '') + ' '.repeat(item.contentCol - item.indentCol);
			if (f) {
				fence = { char: f.charAt(0), len: f.length, parent: item, hideCols: item.contentCol, indent };
				targets.push({
					line,
					kind: 'code-item',
					parent: prefix,
					hide: 0,
					markerFrom: 0,
					marker: 0,
					first: true,
					indent,
				});
			} else if (rest.startsWith('>')) {
				const quote = quoteMarker(text, prefix.length);
				targets.push({
					line,
					kind: 'quote-item',
					parent: prefix,
					hide: 0,
					markerFrom: prefix.length,
					marker: quote,
					indent: indent + rest.slice(0, quote),
				});
			} else {
				targets.push({ line, kind: 'plain', parent: prefix, hide: 0, markerFrom: 0, marker: 0 });
			}
			continue;
		}

		if (body === '') continue;

		// 親は、本文の開始位置がこの行のインデント以下で、いちばん深い項目
		while (stack.length && (stack[stack.length - 1]?.contentCol ?? 0) > cols) stack.pop();
		const parent = stack[stack.length - 1];
		const f = FENCE_RE.exec(body)?.[1];
		if (!parent) {
			if (f) fence = { char: f.charAt(0), len: f.length, parent: null, hideCols: 0, indent: '' };
			continue;
		}

		if (f) {
			fence = { char: f.charAt(0), len: f.length, parent, hideCols: cols, indent: space };
			targets.push({
				line,
				kind: 'code',
				parent: parent.prefix,
				hide: space.length,
				markerFrom: 0,
				marker: 0,
				first: true,
				indent: space,
			});
		} else if (body.startsWith('>')) {
			const quote = quoteMarker(text, space.length);
			targets.push({
				line,
				kind: 'quote',
				parent: parent.prefix,
				hide: space.length,
				markerFrom: space.length,
				marker: quote,
				indent: space + body.slice(0, quote),
			});
		} else {
			targets.push({ line, kind: 'plain', parent: parent.prefix, hide: 0, markerFrom: 0, marker: 0 });
		}
	}

	markQuoteRuns(targets);
	return { targets, items };
}

// 続いた引用の行（`- > ...` と、そのすぐ下のノート行の `> ...` を含む）をかたまりとし、最初と最後の行に印を付ける
function markQuoteRuns(targets: Target[]) {
	const isQuote = (t: Target | undefined) => t?.kind === 'quote' || t?.kind === 'quote-item';
	targets.forEach((t, i) => {
		if (!isQuote(t)) return;
		const prev = targets[i - 1];
		const next = targets[i + 1];
		// `- > ...` は項目の行なので、前の行とはつながらない
		t.first = t.kind === 'quote-item' || !isQuote(prev) || prev?.line !== t.line - 1;
		t.last = !(isQuote(next) && next?.kind === 'quote' && next.line === t.line + 1);
	});
}

const ACTIVE_RE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;

export interface ActiveIndent {
	/** from < 行番号 < to の行で、縦線を明るくする */
	from: number;
	to: number;
	/** 明るくする縦線の、行頭からの文字の位置 */
	offset: number;
}

/**
 * カーソルのある行から、明るくするインデントの縦線を決める（Obsidian の .cm-active-indent の決め方をなぞる）。
 * カーソルの行が項目の行でなければ、それを含む項目の行までさかのぼり、その字下げの続く行の範囲を求める
 */
export function activeIndent(line: (n: number) => string, lines: number, cursor: number): ActiveIndent {
	let from = cursor;
	let indent = '';
	let marker = '';
	const s = ACTIVE_RE.exec(line(cursor));
	if (s?.[0]) {
		indent = s[1] ?? '';
		if (s[2]) {
			marker = ' '.repeat(s[2].length);
		} else {
			for (let c = cursor - 1; c > 0; c--) {
				const h = ACTIVE_RE.exec(line(c));
				if (!h?.[0]) break;
				if (!h[2] && h[1] === indent) continue;
				const u = h[1] ?? '';
				if (h[2] && indent.startsWith(u) && h[0].length <= indent.length) {
					from = c;
					indent = u;
					marker = ' '.repeat(h[2].length);
				}
				break;
			}
		}
	}
	let to = from + 1;
	for (; to <= lines; to++) {
		let rest = line(to);
		if (!rest.startsWith(indent)) break;
		rest = rest.slice(indent.length);
		if (marker) {
			if (rest.startsWith(marker)) continue;
			marker = '';
		}
		if (!/^(\t| {4})/.test(rest)) break;
	}
	return { from, to, offset: indent.length };
}

/** 行頭の字下げのうち、Obsidian がインデントの縦線を描く段（タブ1つか空白4つ）の、開始位置の文字数 */
export function indentStarts(text: string): number[] {
	const head = /^[\s>]+/.exec(text)?.[0] ?? '';
	const starts: number[] = [];
	let p = 0;
	while (p < head.length) {
		const ch = head.charAt(p);
		if (ch === '>') {
			p++;
			if (head.charAt(p) === ' ') p++;
		} else if (ch === '\t') {
			starts.push(p);
			p++;
		} else {
			// 空白が4つ続かなければ縦線は描かれず、続く1文字（タブなど）も飛ばされる
			let e = p;
			while (e < p + 4 && head.charAt(e) === ' ') e++;
			if (e < p + 4) {
				p = e + 1;
				continue;
			}
			starts.push(p);
			p += 4;
		}
	}
	return starts;
}
