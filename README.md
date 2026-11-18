# Nested Block Indent

Show code blocks and quotes inside lists at the level of their list item in Live Preview.

In Live Preview, Obsidian draws a code block or a quote inside a list from the left edge of the editor, with the indentation shown as part of the block. Nested Block Indent lines them up with the text of the list item they belong to, the same way Reading view does.

````markdown
- Shopping
	- Recipe
	  ```txt
	  2 eggs
	  ```
	- > A quote on the item line
	  > or on the lines below it
````

Reading view and Source mode are not changed. The plugin only changes how lines are drawn. It doesn't modify your notes, and the text you select or copy is the same as in the file.

Code blocks and quotes inside a list also get two small helpers:

- The copy button of a code block copies the code without the indentation of the list, like in Reading view.
- When you paste several lines into a code block or a quote, the indentation of the list (and `> ` for a quote) is added to the second and following lines, so they stay in the block.

## Requirements

- Obsidian 1.15.1 or later

## What it covers

- Fenced code blocks (```` ``` ```` and `~~~`) on the lines below a list item, or starting on the item line itself (`- ```txt`)
- Quotes (`> ...`) on the lines below a list item, or on the item line itself (`- > ...`). Wrapped lines keep the line on the left.
- Bullet (`-` `*` `+`), numbered (`1.` `1)`), and task (`- [ ]`) lists, indented with tabs or spaces, at any depth

The background of a code block and the line on the left of a quote start where the item's text starts. The indentation guides of the parent items continue past the block, and there is a little space above and below it.

When a quote is followed by a list item, Obsidian keeps drawing the quote line next to that item. Nested Block Indent stops it at the last line that starts with `>`.

The `>` of a quote on an item line is hidden, and shown when the cursor is on that line, like other quotes in Live Preview.

## Not covered

- Callouts (`> [!note]`)
- Nested quotes (`> > ...`), which are shown with a single line
- Code blocks inside quotes
- Extra indentation: a block indented more than its item's text is still lined up with the text

## Notes

- Nested Block Indent depends on how Obsidian draws lists in Live Preview, which isn't a public API. A future Obsidian update may change it and break the layout. Disabling the plugin brings back Obsidian's own layout.
- It works with the [Outliner](https://github.com/vslinko/obsidian-outliner) plugin.

## Installation

Nested Block Indent is not yet available in Community plugins. You can install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from Community plugins.
2. In BRAT's settings, choose **Add beta plugin** and enter `normalsalt/obsidian-nested-block-indent`.
3. Enable **Nested Block Indent** in **Settings → Community plugins**.

BRAT keeps the plugin up to date with new releases.

## License

[MIT](LICENSE)
