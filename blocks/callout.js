export default {
  id: 'bx-callout',
  label: 'Callout',
  media: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>',
  content: `
    <aside class="bx-callout">
      <div class="bx-callout-label">Note</div>
      <div class="bx-callout-body">
        A short, concrete callout — context, a quote, or a side-note worth surfacing.
      </div>
    </aside>
  `,
};
