# Nested Block Indent（Obsidian プラグイン）

Live Preview で、箇条書きの中のコードブロックと引用を、親の項目と同じ階層に表示する。
利用者向けの説明は @README.md を参照。

## コマンド

- コードを変えたら、次の順で確かめる。どこかで失敗したら、直してから先へ進む
  1. `npm run lint`
  2. `npm run build`（tsc の型チェックを含む）
  3. `obsidian dev:debug on`（`dev:console` はデバッガーを接続しないと使えない）
  4. `obsidian dev:errors clear` と `obsidian dev:console clear`
  5. `obsidian plugin:reload id=nested-block-indent`
  6. `obsidian dev:errors` と `obsidian dev:console level=error` で、エラーが出ていないか見る
- `npm run dev`（監視モード）は使わない。`main.js` は手順 2 の `npm run build` で作る（ソースマップは付かない）
- 表示は `test/fixture.md` で確かめる。保管庫直下に `nbi-fixture.md` としてコピーして開き、`obsidian dev:screenshot` と `obsidian dev:dom` / `obsidian eval` で見る。終わったらコピーは消す
- 操作しての動作確認（カーソル、選択、コピー、Outliner との併用）はユーザーが行うので、変更ごとに確認手順を短く示す
- 実行してよいコマンド、確認が必要なコマンド、禁止するコマンドは `.claude/settings.json` を参照
- そこにないコマンドを実行するときは、`.claude/settings.json` に追加するかどうかもユーザーに確認する

## 構成

- `src/main.ts`: プラグイン本体。エディター拡張を登録するだけ
- `src/scan.ts`: 文書の行から、装飾する行（コードブロック・引用・それ以外の箇条書きの行）と親の項目を見つける（Obsidian と CodeMirror に依存しない）
- `src/live-preview.ts`: CodeMirror 6 の ViewPlugin。親の項目の本文の開始位置を測り、`--nbi-indent` と行頭の空白を隠す装飾を付ける
- `styles.css`: 装飾のクラスのスタイル
- `test/fixture.md`: 表示を確かめるためのノート（仕様の対象をすべて含める）
- `.github/workflows/`: daily-logging と同じ。`lint.yml` は push ごとに build と lint、`release.yml` はタグの push でリリースの下書きを作る

## 方針

- `minAppVersion` は 1.15.1（Live Preview の DOM とクラス名に依存するため、確かめた版にする）
- UI の文字列、README、コミットメッセージは英語
- コードのコメントは日本語
- 最小限にする。設定画面とコマンドは作らない
- Markdown の中身は書き換えない。装飾（`Decoration`）だけで表示を変える。文書の文字列を消す・足す変更（`dispatch` での挿入・削除）はしない
- Live Preview のときだけ装飾する（`editorLivePreviewField`）。閲覧モードとソースモードは変えない
- Obsidian の内部のクラス（`HyperMD-*` など）に頼るのは CSS のセレクターだけにし、対象の行の判定は文書の文字列から行う
- `isDesktopOnly` は daily-logging と同じく `false`
- 依存パッケージを追加・更新する前に相談する（`@codemirror/state` と `@codemirror/view` は `obsidian` の peerDependencies として入る。バンドルには含めない）

## 仕様

### 目的

Live Preview で、箇条書きの中のコードブロックと引用を、親の項目と同じ階層に表示する。閲覧モードとソースモードは変えない。Markdown ファイルの中身は一切書き換えない。

### 対象

1. ノート行（Shift+Enter で書く行）に置いたフェンス付きコードブロック（```` ``` ```` と `~~~`）
2. 項目の行で始まるフェンス（例：`- ```txt`）
3. ノート行の引用（`> ...`）
4. 項目の行に直接書いた引用（`- > ...`）。折り返した行まで左の縦線を伸ばす
5. 箇条書きは `-` `*` `+` `1.` `1)` とチェックボックス `- [ ]`。インデントはタブ・空白の両方。3階層以上にも対応する

### 表示の決め事

- コードブロックは、背景の左端を親の項目の本文の開始位置に揃える。コードの文字は、通常のコードブロックの余白の分だけ内側から始める（閲覧モードと同じ）
- 項目の行で始まるフェンス（`- ```txt`）は、記号をいつもの項目の位置に出し、背景は本文の開始位置から始める
- 引用は、左の縦線を親の項目の本文の開始位置に揃える
- `- > ...` の `>` は、通常の引用と同じく、カーソルがその行にあるときだけ出す。それ以外は隠す
- ノート行の引用のすぐ次の項目の行には、縦線を付けない。Obsidian が遅延継続として引用の続きにしても、縦線は `>` で始まる行で止める
- コードブロックと、続いた引用の行のかたまりの、上下に余白（`--nbi-gap`、既定 `--size-4-2`）を空ける。背景と引用の縦線は余白の内側に描き、親のインデントの縦線は余白にも描いてつなげる。`- > ...` は1行ずつ別のかたまりにする

### やらないこと

- テーマ、シンタックスハイライト、行番号、折りたたみ、設定画面
- コールアウト（`> [!note]`）
- 入れ子の引用（`> > ...`）。縦線は1本だけ扱う
- 親の本文より深いインデントの区別。フェンスや `>` が親の本文より深くインデントされていても、親の本文に揃える
- 引用の中のコードブロック

### 受け入れ条件

- 背景・左の縦線・文字の開始位置が、親の項目の本文と揃う
- 改行した直後の空の行で、行頭の空白が見えない
- カーソル移動・選択・コピーした文字列が元の Markdown と一致する
- Outliner プラグインと同時に使って、Tab や項目の移動が壊れない

## 調べて分かった Live Preview の DOM（Obsidian 1.15.1）

- 項目の行は `.HyperMD-list-line.HyperMD-list-line-N`。インラインの `text-indent: -Xpx; padding-inline-start: Xpx` で本文の開始位置を決めている（X は記号の幅で変わる。`-` は 64px、`1.` とチェックボックスは 66px など）
- ノート行は `HyperMD-list-line-nobullet` が付き、項目の行と同じやり方でぶら下げインデントになる
- 箇条書きの中のコードブロックの行は `HyperMD-codeblock` と `HyperMD-list-line-nobullet` が付くが、インラインの `padding` は付かない。行頭の空白は `.cm-indent` / `.cm-indent-spacing` のままコードの中に表示され、背景は行の左端から始まる
- `- ```js` の行は `HyperMD-codeblock-begin` と `HyperMD-list-line-N` の両方が付き、行頭に記号が出る
- `- > ...` は引用として解析されない（`HyperMD-quote` が付かず、`>` がそのまま出る）。判定は自前で行う必要がある
- ノート行の `> ...` は `HyperMD-quote HyperMD-quote-lazy` になる。縦線は行の左端に出て、親の項目と揃わない
- ノート行の引用のすぐ次の項目の行（`- コードブロック` など）にも、遅延継続（lazy continuation）として `HyperMD-quote HyperMD-quote-lazy` が付き、縦線が伸びてしまう（表示の決め事で止める）
- 本文の開始位置は、項目の行のインラインの `padding-inline-start` をそのまま使う。padding のない行（`- ```js`）だけ、行の要素の左端から本文の座標を測る。記号の種類（`\t- ` など）ごとに覚え、画面の外の親にも使う
- Tab（Outliner の `indent-list` など）で項目を移すと、Obsidian は項目の行の padding を、途中の値（71px など）を経てから正しい値（100px など）に直す。行の高さは変わらず `geometryChanged` にならないので、測った値が変わったら落ち着くまで測り直す（カーソル移動でも測る）。Outliner のコマンドは `app.commands.executeCommandById('obsidian-outliner:indent-list')` で試せる
- CodeMirror の測定は `requestAnimationFrame` で動くので、Obsidian のウィンドウが隠れている（`document.visibilityState` が `hidden`）と走らず、装飾が付かない。CLI で確かめるときはウィンドウを表示しておく
- インデントの縦線は `.cm-indent::before`（`.cm-indent` の左端 + `margin-inline-start: var(--indentation-guide-editing-indent)` + 幅 1px の右の枠線）。この余白は `.85em` で文字の大きさに比例するので、文字の小さいコードの行ではずれる
- 行頭の空白を隠すと縦線も消える。そこで、親の項目の行で縦線が描かれている位置を px で測り、空白を隠した行と `- ```js` の行の行頭にウィジェット（`.nbi-guide`）を置いて、Obsidian と同じく枠線で描く。`- ```js` の行の Obsidian の縦線は消す
- 縦線をグラデーションの背景で描くと、端数の位置（14.6px など）で薄い色がにじんで見えなくなる。枠線なら Obsidian と同じくくっきり出る
- `- ```js` の行は行全体がコードの文字（`--code-size`）になり、記号までの幅が普通の項目より狭くなる。そのため、カーソルを置いて出る ``` が背景の左にはみ出す。行の文字は普通の項目と同じにし、記号の後ろ（`.nbi-fence-text`）だけをコードの文字にして、`--size-4-4` 内側から始める
- 言語名とコピーボタン（`.code-block-flair`）は、行の上端から `top: 6px`。上に余白を足した行では、その分だけ下げる
- カーソルを置いたときに書式の記号が出るのは、エディターにフォーカスがあるときだけ。CLI で確かめるときは `window.focus()` で Obsidian の窓を前に出す（`document.hasFocus()` で確かめる）
- 閉じるフェンスの行は、Obsidian が行の中身全体をウィジェットに置き換える。隠す範囲を置き換えるウィジェットは出ないので、縦線は行頭の位置（`side: -1`）に置く

## Git

- 変更はできるだけ細かい単位でコミットする。1コミットで1つの目的にする
- コミットする前に `git diff` を見せて、ユーザーの確認を取る
- リポジトリは `normalsalt/obsidian-nested-block-indent`（daily-logging と同じく `obsidian-` を付ける）
- push とリリースは、ユーザーが頼んだときだけ行う。リリースの手順:
  1. 未コミットの変更がなく、`master` にいることを確かめる
  2. 前のタグからのコミットを示し、バージョン（patch / minor / major）を決める（ユーザーが指定していればそれ）
  3. `npm version <patch|minor|major>`（package.json、package-lock.json、manifest.json、versions.json を更新し、コミットとタグを作る）
  4. `git push` と `git push origin <version>`
  5. `gh run list --workflow=release.yml --limit 1` で実行を見つけ、`gh run watch <id>` で終わるまで待つ
  6. `gh release view <version>` で、下書きに `main.js`、`manifest.json`、`styles.css` があるか確かめる。欠けていたら公開せず、ユーザーに知らせる
  7. `gh release edit <version> --draft=false` で公開する
- 最初のリリース（0.1.0）だけは、manifest.json がすでに 0.1.0 なので `npm version` を使わない。タグはユーザーが `git tag 0.1.0` で付けて push する（`git tag` は `.claude/settings.json` で禁止している）。その後は手順 5 から行う
- タグには `v` を付けない（`.npmrc` に `tag-version-prefix=""` を設定済み）。`release.yml` はリリースを下書きで作るので、公開するには `gh release edit <version> --draft=false` が必要
