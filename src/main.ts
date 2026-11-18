import { Plugin } from 'obsidian';
import { nestedBlockIndent } from './live-preview';

export default class NestedBlockIndentPlugin extends Plugin {
	onload() {
		this.registerEditorExtension(nestedBlockIndent);
	}
}
