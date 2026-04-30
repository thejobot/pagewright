/**
 * Karaoke example pack, opt-in. To enable, import this module from
 * pagewright.js and call registerKaraokeBlocks(editor) after
 * registerBlocks(editor):
 *
 *   import { registerKaraokeBlocks } from './blocks/karaoke/index.js';
 *   registerKaraokeBlocks(editor);
 *
 * Also load the karaoke styles by adding to index.html:
 *
 *   <link rel="stylesheet" href="styles/blocks-karaoke.css">
 *
 * Three blocks (song hero, lyric row, runner stub) using a `mk-` class
 * prefix and Japanese/romaji sample copy. Treat as a worked example of a
 * domain-specific pack: own prefix, own sample content, own stylesheet.
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
