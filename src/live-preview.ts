import type { EditorState, Range } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { editorLivePreviewField, Notice } from 'obsidian';
import type { ScanResult, Target } from './scan';
import { scan } from './scan';

// 親の本文の開始位置を測り直したことを知らせる
const remeasured = StateEffect.define<null>();

const hidden = Decoration.replace({});
const plainLine = Decoration.line({ class: 'nbi-plain' });

// 引用の `>` は、通常の引用と同じく縦線と本文の間に置いたままにし、カーソルがない行では見えなくする
const quoteMarker = Decoration.mark({ class: 'nbi-quote-marker' });
const quoteMarkerHidden = Decoration.mark({ class: 'nbi-quote-marker nbi-quote-marker-hidden' });
const quoteSpace = Decoration.mark({ class: 'nbi-quote-space' });
const fenceText = Decoration.mark({ class: 'nbi-fence-text' });

const LINE_CLASS: Record<Exclude<Target['kind'], 'plain'>, string> = {
	code: 'nbi-code',
	'code-item': 'nbi-code nbi-code-item',
	quote: 'nbi-quote',
	'quote-item': 'nbi-quote nbi-quote-item',
};

interface Layout {
	/** 本文の開始位置（行の左端からの px） */
	x: number;
	/** インデントの縦線が描かれている位置（行の左端からの px） */
	guides: number[];
}

// 行頭の空白を隠すと Obsidian のインデントの縦線も消えるので、親の行と同じ位置に描く。
// Obsidian の `.cm-indent::before` と同じく枠線で描く（グラデーションだと端数の位置で薄い線がにじんで消える）
class Guides extends WidgetType {
	constructor(private readonly guides: readonly number[]) {
		super();
	}
	eq(other: Guides) {
		return other.guides.join() === this.guides.join();
	}
	toDOM() {
		const el = createSpan({ cls: 'nbi-guides', attr: { 'aria-hidden': 'true' } });
		for (const x of this.guides) el.createSpan({ cls: 'nbi-guide', attr: { style: `inset-inline-start: ${x}px` } });
		return el;
	}
}

function isLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) ?? false;
}

/** pos の文字を囲む要素の、行の要素までの右の余白（margin-inline-end）の合計 */
function marginAfter(view: EditorView, pos: number, lineEl: HTMLElement): number {
	const { node } = view.domAtPos(pos);
	let el = node.instanceOf(HTMLElement) ? node : node.parentElement;
	let margin = 0;
	while (el && el !== lineEl) {
		margin += parseFloat(getComputedStyle(el).marginInlineEnd) || 0;
		el = el.parentElement;
	}
	return margin;
}

class NestedBlockIndentView {
	decorations: DecorationSet = Decoration.none;
	/** カーソルが中に入らないようにする範囲（隠した行頭の空白） */
	atomic: DecorationSet = Decoration.none;
	private result: ScanResult;
	/** 親の項目の記号ごとの、本文の開始位置とインデントの縦線の位置 */
	private readonly layouts = new Map<string, Layout>();
	private destroyed = false;

	constructor(private readonly view: EditorView) {
		this.result = this.scan();
		this.build();
		this.measure();
		// コピーボタンは Obsidian がボタン自体で click を受けるので、その前に capture で受ける
		view.contentDOM.addEventListener('click', this.onCopyClick, true);
		// 貼り付けも、HTML があると Obsidian が自分で処理するので、その前に capture で受ける
		view.dom.addEventListener('paste', this.onPaste, true);
	}

	update(update: ViewUpdate) {
		const modeChanged = isLivePreview(update.startState) !== isLivePreview(update.state);
		const measured = update.transactions.some((tr) => tr.effects.some((e) => e.is(remeasured)));
		if (update.docChanged) this.result = this.scan();
		if (
			update.docChanged ||
			update.viewportChanged ||
			update.selectionSet ||
			update.focusChanged ||
			modeChanged ||
			measured
		) {
			this.build();
		}
		// 測った値が変わったら、落ち着くまでもう一度測る。Tab で項目を移したときなど、Obsidian が
		// 本文の開始位置（padding）を途中の値から正しい値に直すことがあり、行の高さは変わらないので、
		// geometryChanged だけでは測り直されない
		if (
			update.docChanged ||
			update.viewportChanged ||
			update.geometryChanged ||
			update.selectionSet ||
			modeChanged ||
			measured
		) {
			this.measure();
		}
	}

	destroy() {
		this.destroyed = true;
		this.view.contentDOM.removeEventListener('click', this.onCopyClick, true);
		this.view.dom.removeEventListener('paste', this.onPaste, true);
	}

	// 箇条書きの中のコードブロックと引用に複数行を貼り付けたら、2行目以降の頭に字下げ（引用は `> ` も）を足す。
	// 足さないと、2行目以降が親の項目より浅くなり、コードブロックや引用と箇条書きから外れて表示される
	private readonly onPaste = (evt: ClipboardEvent) => {
		const { view } = this;
		const text = evt.clipboardData?.getData('text/plain') ?? '';
		if (evt.defaultPrevented || !isLivePreview(view.state) || !/[\r\n]/.test(text)) return;
		const { doc, selection } = view.state;
		const n = doc.lineAt(selection.main.from).number;
		const target = this.result.targets.find((t) => t.line === n);
		const indent = target?.indent;
		if (!indent) return;
		// 空の行は、コードブロックではそのまま、引用では `>` だけにする（空の行で引用が終わらないように）
		const blank = target.kind === 'quote' || target.kind === 'quote-item' ? indent.trimEnd() : '';
		const [first = '', ...rest] = text.split(/\r\n?|\n/);
		// 文書の中からコピーした行など、すでに字下げが付いていれば、Obsidian に任せる
		if (rest.every((l) => l === '' || l.startsWith(indent))) return;
		const indented = [first, ...rest.map((l) => (l === '' ? blank : indent + l))].join('\n');
		evt.preventDefault();
		evt.stopPropagation();
		view.dispatch(view.state.replaceSelection(indented), { userEvent: 'input.paste', scrollIntoView: true });
	};

	// 箇条書きの中のコードブロックのコピーボタン（`.code-block-flair`）では、
	// Obsidian の代わりに、隠している行頭の空白を除いた中身をコピーする
	private readonly onCopyClick = (evt: MouseEvent) => {
		const target = evt.target as Node | null;
		if (!target?.instanceOf(Element) || !isLivePreview(this.view.state)) return;
		const flair = target.closest('.code-block-flair');
		if (!flair) return;
		const code = this.codeAt(this.view.posAtDOM(flair));
		if (code === null) return;
		evt.stopPropagation();
		void navigator.clipboard.writeText(code).then(() => new Notice('Copied to clipboard'));
	};

	/** pos の行で始まる、箇条書きの中のコードブロックの中身（フェンスの行は含めない） */
	private codeAt(pos: number): string | null {
		const { doc } = this.view.state;
		const { targets } = this.result;
		const n = doc.lineAt(pos).number;
		const i = targets.findIndex((t) => t.line === n);
		const start = targets[i];
		if (!start?.first || (start.kind !== 'code' && start.kind !== 'code-item')) return null;
		const lines: string[] = [];
		for (const t of targets.slice(i + 1)) {
			if (t.kind !== 'code' || t.first || t.closing || t.line > doc.lines) break;
			lines.push(doc.line(t.line).text.slice(t.hide));
			if (t.last) break;
		}
		return lines.join('\n');
	}

	private scan(): ScanResult {
		const { state } = this.view;
		return scan(state.doc.toJSON(), state.tabSize);
	}

	private build() {
		const { view } = this;
		if (!isLivePreview(view.state)) {
			this.decorations = this.atomic = Decoration.none;
			return;
		}
		const { doc, selection } = view.state;
		const { from, to } = view.viewport;

		// カーソルや選択がかかっている行では `>` を出す（Obsidian と同じく、エディターにフォーカスがあるときだけ）
		const activeLines = new Set<number>();
		for (const r of view.hasFocus ? selection.ranges : []) {
			const last = doc.lineAt(r.to).number;
			for (let n = doc.lineAt(r.from).number; n <= last; n++) activeLines.add(n);
		}

		const decos: Range<Decoration>[] = [];
		const atomic: Range<Decoration>[] = [];
		for (const t of this.result.targets) {
			if (t.line > doc.lines) break;
			const line = doc.line(t.line);
			if (line.to < from || line.from > to) continue;
			if (t.kind === 'plain') {
				decos.push(plainLine.range(line.from));
				continue;
			}
			const layout = this.layouts.get(t.parent);
			if (!layout) continue;

			let cls = LINE_CLASS[t.kind];
			if (t.first) cls += ' nbi-first';
			if (t.last) cls += ' nbi-last';
			decos.push(
				Decoration.line({ class: cls, attributes: { style: `--nbi-indent: ${layout.x}px` } }).range(line.from),
			);
			// 空白を隠した行、コードブロックの行（空の行には Obsidian の縦線がない）、`- ```js` の行
			// （Obsidian の縦線がコードの小さい文字に合わせてずれる）には、インデントの縦線を行頭に置く。
			// 閉じるフェンスの行は Obsidian が中身ごと置き換えるので、隠す範囲とは別の、行頭の位置に置く
			if (layout.guides.length && (t.hide > 0 || t.kind === 'code' || t.kind === 'code-item')) {
				decos.push(Decoration.widget({ widget: new Guides(layout.guides), side: -1 }).range(line.from));
			}
			// `- ```js` の行は、記号の後ろのフェンスを背景の内側から始める
			if (t.kind === 'code-item' && line.from + t.parent.length < line.to) {
				decos.push(fenceText.range(line.from + t.parent.length, line.to));
			}
			if (t.hide > 0) {
				const r = hidden.range(line.from, line.from + t.hide);
				decos.push(r);
				atomic.push(r);
			}
			// `>` に縦線と本文の間の幅と色を付け、続く空白の幅はなくす。Obsidian は `>` と空白を別の要素に
			// するので、1文字ずつ装飾する（2文字にまたがる装飾は分かれて、幅が2つ分になる）
			if (t.marker > 0) {
				const markerFrom = line.from + t.markerFrom;
				const deco = activeLines.has(t.line) ? quoteMarker : quoteMarkerHidden;
				decos.push(deco.range(markerFrom, markerFrom + 1));
				if (t.marker > 1) decos.push(quoteSpace.range(markerFrom + 1, markerFrom + t.marker));
			}
		}
		this.decorations = Decoration.set(decos, true);
		this.atomic = Decoration.set(atomic, true);
	}

	// 見えている項目の行で、本文の開始位置とインデントの縦線の位置を、行の左端からの px で測る
	private measure() {
		if (!isLivePreview(this.view.state)) return;
		this.view.requestMeasure({
			key: this,
			read: (view) => {
				const found = new Map<string, Layout>();
				// Obsidian が付けた padding から取れた記号（座標から測った値より優先する）
				const exact = new Set<string>();
				const { doc } = view.state;
				const { from, to } = view.viewport;
				for (const item of this.result.items) {
					if (exact.has(item.prefix) || item.line > doc.lines) continue;
					const line = doc.line(item.line);
					if (line.to < from || line.from > to) continue;
					const textPos = line.from + item.prefix.length;
					const { node } = view.domAtPos(textPos);
					const lineEl = (node.instanceOf(HTMLElement) ? node : node.parentElement)?.closest('.cm-line');
					if (!lineEl?.instanceOf(HTMLElement)) continue;

					const left = lineEl.getBoundingClientRect().left;
					// 縦線の位置は `.cm-indent` の左端に、`::before` の余白（文字の大きさで変わる）と幅 1px を足したところ
					const guides = Array.from(lineEl.querySelectorAll('.cm-indent'), (el) => {
						const margin = parseFloat(getComputedStyle(el, '::before').marginInlineStart) || 0;
						return Math.round((el.getBoundingClientRect().left - left + margin + 1) * 10) / 10;
					});
					// 項目の行では、Obsidian がぶら下げインデントの padding に本文の開始位置を入れている。
					// ただし `- > ...` の行（`>` の幅まで含めて測られる）と、本文がまだない行
					// （記号の右の余白が含まれない）の padding は本文の開始位置と合わないので使わない
					const rest = line.text.slice(item.prefix.length);
					const padding = parseFloat(lineEl.style.paddingInlineStart);
					if (!Number.isNaN(padding) && rest !== '' && !rest.startsWith('>')) {
						found.set(item.prefix, { x: padding, guides });
						exact.add(item.prefix);
						continue;
					}
					// padding がない行（`- ```js` など）と、使えない行は座標から測る。カーソルを置いて出る ``` は
					// 前に余白を空けているので、記号の側（side: -1）の、記号の直後の位置を使う。
					// 記号の要素の右の余白（`.cm-formatting-list` の margin-inline-end）は本文の前の空きなので足す
					if (found.has(item.prefix)) continue;
					const text = view.coordsAtPos(textPos, -1);
					if (!text) continue;
					found.set(item.prefix, { x: text.left - left + marginAfter(view, textPos - 1, lineEl), guides });
				}
				return found;
			},
			write: (found, view) => {
				let changed = false;
				for (const [prefix, layout] of found) {
					const old = this.layouts.get(prefix);
					if (
						!old ||
						Math.abs(old.x - layout.x) > 0.5 ||
						old.guides.join() !== layout.guides.join()
					) {
						this.layouts.set(prefix, layout);
						changed = true;
					}
				}
				// 測定の中では dispatch できないので、終わってから描き直す
				if (changed) {
					queueMicrotask(() => {
						if (!this.destroyed) view.dispatch({ effects: remeasured.of(null) });
					});
				}
			},
		});
	}
}

export const nestedBlockIndent = ViewPlugin.fromClass(NestedBlockIndentView, {
	decorations: (v) => v.decorations,
	provide: (plugin) =>
		EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
});
