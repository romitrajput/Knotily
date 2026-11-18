export default async function notFound() {
  return {
    name: 'not-found',
    title: 'Page not found',
    html: `
    <section class="page-narrow not-found">
      <p class="nf-code" aria-hidden="true">404</p>
      <h1 class="page-title">This page came untied</h1>
      <p>The link may be old, or the piece sold out and left with its drop.</p>
      <div class="actions">
        <a class="btn" href="/shop">Go to the shop</a>
        <a class="btn btn-line" href="/">Back to home</a>
      </div>
    </section>`,
  };
}
