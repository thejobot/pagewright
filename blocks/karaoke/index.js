/**
 * Karaoke example pack, opt-in. To enable, import this module from studio.js
 * and call registerKaraokeBlocks(editor) after registerBlocks(editor):
 *
 *   import { registerKaraokeBlocks } from './blocks/karaoke/index.js';
 *   registerKaraokeBlocks(editor);
 *
 * Also load the karaoke styles by adding to index.html:
 *
 *   <link rel="stylesheet" href="styles/blocks-karaoke.css">
 *
 * The pack ships three blocks (song hero, lyric row, runner stub) preserved
 * verbatim from the original studio that this template was extracted from.
 * They use a `mk-` class prefix and Japanese/romaji sample copy, useful as
 * a reference for building your own domain-specific block pack.
 */

import { registerBlockSet } from '../index.js';
import heroSong   from './hero-song.js';
import lyricRow   from './lyric-row.js';
import runnerStub from './runner-stub.js';

export const KARAOKE_CATEGORY = 'Karaoke (example pack)';

const KARAOKE_BLOCKS = [heroSong, lyricRow, runnerStub];

export function registerKaraokeBlocks(editor) {
  registerBlockSet(editor, KARAOKE_BLOCKS, KARAOKE_CATEGORY);
}
