const PLACE_ID = /^[a-z0-9-]{3,100}$/;
const PRODUCT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function bookingPath(id) {
  return PLACE_ID.test(id || '') ? '/place/' + encodeURIComponent(id) + '?book=1' : null;
}

// Old shared links keep working, but no longer boot the marketplace first.
export function legacyCustomerDestination(pathname, search = '') {
  if (!['/market', '/market.html'].includes(pathname)) return null;
  const params = new URLSearchParams(search);
  const booking = bookingPath(params.get('book'));
  if (booking) return booking;
  const menu = params.get('menu');
  return PRODUCT_ID.test(menu || '') ? '/menu/' + encodeURIComponent(menu) : null;
}

export function marketDetailRoute(pathname) {
  const match = String(pathname).match(/^\/(seller|item|catalog)\/([^/]+)\/?$/);
  return match && UUID.test(match[2]) ? {type: match[1], id: match[2]} : null;
}

export function placeReturnPath(id, query = {}) {
  const path = '/place/' + encodeURIComponent(id || '');
  const params = new URLSearchParams();
  if (query.book === '1') params.set('book', '1');
  if (PRODUCT_ID.test(query.product || '')) params.set('product', query.product);
  return path + (params.size ? '?' + params.toString() : '');
}
