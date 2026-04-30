export default {
  id: 'mk-hero',
  label: 'Song hero',
  media: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="12" r="2.2" fill="currentColor"/><path d="M13 10 h5 M13 13 h5" stroke="currentColor" stroke-width="1.4"/></svg>',
  content: `
    <section class="mk-hero">
      <div class="mk-hero-art">
        <img src="https://via.placeholder.com/184x184/1a1a2e/c4b5fd?text=ART" alt="Album art">
      </div>
      <div class="mk-hero-meta">
        <div class="mk-hero-jp">曲名をここに</div>
        <div class="mk-hero-artist">Artist Name</div>
        <div class="mk-hero-en">Song title translation · one-line mood.</div>
      </div>
    </section>
  `,
};
