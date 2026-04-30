export default {
  id: 'bx-embed',
  label: 'Audio embed',
  media: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 12a6 6 0 0 0 12 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  content: `
    <section class="bx-embed">
      <div class="bx-embed-icon">🎙</div>
      <div class="bx-embed-meta">
        <div class="bx-embed-title">Audio title</div>
        <div class="bx-embed-sub">A short description of the clip.</div>
        <audio controls preload="none" src=""></audio>
      </div>
    </section>
  `,
};
