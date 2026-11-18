import type { EditorState, Range } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import type { ScanResult, Target } from './scan';
import { scan } from './scan';

// 親の本文の開始位置を測り直したことを知らせる
const remeasured = StateEffect.define<null>();

const hidden = Decoration.replace({});
const plainLine = Decoration.line({ class: 'nbi-plain' });

// `- > ...` の `>` の代わりに置く、縦線と本文の間の余白
class QuoteSpacer extends WidgetType {
	eq() {
		return true;
	}
	toDOM() {
		return createSpan({ cls: 'nbi-quote-spacer' });
	}
}
const quoteSpacer = Decoration.replace({ widget: new QuoteSpacer() });
const quoteMarker = Decoration.mark({ class: 'nbi-quote-marker' });
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
	}

	update(update: ViewUpdate) {
		const modeChanged = isLivePreview(update.startState) !== isLivePreview(update.state);
		const measured = update.transactions.some((tr) => tr.effects.some((e) => e.is(remeasured)));
		if (update.docChanged) this.result = this.scan();
		if (update.docChanged || update.viewportChanged || update.selectionSet || modeChanged || measured) {
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

		// カーソルや選択がかかっている行では `>` を出す
		const activeLines = new Set<number>();
		for (const r of selection.ranges) {
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
			if (t.marker > 0) {
				const markerFrom = line.from + t.markerFrom;
				const markerTo = markerFrom + t.marker;
				if (!activeLines.has(t.line)) {
					decos.push((t.kind === 'quote-item' ? quoteSpacer : hidden).range(markerFrom, markerTo));
				} else if (t.kind === 'quote-item') {
					// `>` を出すときは、縦線に重ならないよう前に余白を空ける
					decos.push(quoteMarker.range(markerFrom, markerTo));
				}
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
					// 項目の行では、Obsidian がぶら下げインデントの padding に本文の開始位置を入れている
					const padding = parseFloat(lineEl.style.paddingInlineStart);
					if (!Number.isNaN(padding)) {
						found.set(item.prefix, { x: padding, guides });
						exact.add(item.prefix);
						continue;
					}
					// padding がない行（`- ```js` など）は座標から測る。カーソルを置いて出る ``` や `>` は
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
