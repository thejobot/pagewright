export default {
  id: 'bx-hero',
  label: 'Hero card',
  media: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="12" r="2.2" fill="currentColor"/><path d="M13 10 h5 M13 13 h5" stroke="currentColor" stroke-width="1.4"/></svg>',
  content: `
    <section class="bx-hero">
      <div class="bx-hero-art">
        <img src="https://placehold.co/184x184/1a1a2e/c4b5fd?text=ART" alt="">
      </div>
      <div class="bx-hero-meta">
        <div class="bx-hero-title">Page title</div>
        <div class="bx-hero-sub">A short subtitle or one-line description.</div>
      </div>
    </section>
  `,
};
