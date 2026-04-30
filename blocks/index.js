/**
 * Default block registry. Each block defines its label, category, and the HTML
 * dropped onto the GrapesJS canvas. Blocks are self-contained — their CSS
 * lives in /styles/blocks.css so the same class names render identically in
 * the editor and in the exported page HTML.
 *
 * Optional add-on packs live in subdirectories (e.g. blocks/karaoke). Enable
 * a pack by importing its register function and calling it in studio.js after
 * the default registerBlocks() call.
 */

import heroCard       from './hero-card.js';
import callout        from './callout.js';
import embed          from './embed.js';
import sectionDivider from './section-divider.js';

export const BLOCK_CATEGORY = 'Blocks';

const BLOCKS = [heroCard, callout, embed, sectionDivider];

// Default floating toolbar for every block. Keeps parent-jump, move, and
// clone; intentionally omits the default tlb-delete button so clicking
// around a block can't silently destroy it. Delete still works via the Del
// key (see studio.js component:remove handler → undo toast).
const BLOCK_TOOLBAR = [
  { attributes: { class: 'fa fa-arrow-up', title: 'Select parent' }, command: 'select-parent' },
  { attributes: { class: 'fa fa-arrows',   title: 'Move' },          command: 'tlb-move' },
  { attributes: { class: 'fa fa-clone',    title: 'Clone' },         command: 'tlb-clone' },
];

export function registerBlocks(editor) {
  registerBlockSet(editor, BLOCKS, BLOCK_CATEGORY);
}

export function registerBlockSet(editor, defs, category) {
  const bm = editor.BlockManager;
  for (const def of defs) {
    bm.add(def.id, {
      label: def.label,
      category,
      media: def.media,
      attributes: { class: 'bx-block' },
      // Content carries both the HTML and the component-model overrides that
      // apply to the root wrapper of the dropped block. `components` is the
      // HTML; `toolbar` replaces GrapesJS's default floating menu.
      content: {
        components: def.content,
        toolbar: BLOCK_TOOLBAR,
      },
    });
  }
}
