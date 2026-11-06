import {createBookings, BOOKING_CSS} from './booking-ui.js';
import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
import {bookingPath} from '../public/customer-navigation.js';
import {memberDb, memberState, onMemberChange, ensureBookingMember} from './member-access.js';

// The provider page already contains its public identity. Opening its booking form
// needs the booking providers endpoint, not a second copy of the whole market.
export function mountPlaceBooking() {
  const trigger = document.querySelector('[data-place-booking]');
  if (!trigger || !bookingPath(trigger.dataset.placeBooking)) return;
  const place = {id: trigger.dataset.placeBooking, name: trigger.dataset.placeName || ''};
  let dialog, pending = null, opener = trigger, openAttempt = 0;
  const style = document.createElement('style');
  style.textContent = BOOKING_CSS;
  document.head.append(style);

  function close() {
    if (bookings.cancelOpen?.() === false) return;
    openAttempt++;pending = null;trigger.removeAttribute('aria-busy');
    dialog?.close();
    const url = new URL(location.href);
    if (url.searchParams.get('book') === '1') {
      url.searchParams.delete('book');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    if (opener?.isConnected) opener.focus({preventScroll: true});
  }

  function modal(html) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'place-booking-dialog';
      dialog.className = 'member-dialog place-booking-dialog';
      dialog.setAttribute('aria-label', 'حجز في ' + place.name);
      dialog.innerHTML = '<button type="button" class="member-close" aria-label="إغلاق الحجز">' + icon('close') + '</button><div data-booking-content></div>';
      document.body.append(dialog);
      dialog.querySelector('.member-close').addEventListener('click', close);
      dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
    }
    dialog.querySelector('[data-booking-content]').innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }

  const bookings = createBookings({
    db: memberDb,
    getUser: () => {
      const user = memberState().user;
      return user ? {...user, user_metadata:{display_name:user.name || ''}} : null;
    },
    requireUser(next) {
      if (memberState().member) return true;
      void ensureBookingMember().then(allowed => {if (allowed) next();});
      return false;
    },
    modal, closeModal: close, esc,
  });

  async function open() {
    if (pending) return pending;
    const attempt = ++openAttempt;
    trigger.setAttribute('aria-busy', 'true');
    pending = (async () => {
      if (!await ensureBookingMember() || attempt !== openAttempt) return;
      await bookings.openForm(place);
    })().catch(() => {
      if (attempt !== openAttempt) return;
      modal('<h2>تعذر فتح الحجز</h2><p>راجع الاتصال وحاول تاني. بيانات المكان قدامك.</p><button class="primary" type="button" data-booking-open-retry>حاول تاني</button>');
      dialog.querySelector('[data-booking-open-retry]').onclick = open;
    }).finally(() => {if (attempt === openAttempt) {pending = null; trigger.removeAttribute('aria-busy');}});
    return pending;
  }

  trigger.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); opener = trigger;
    void open();
  });
  onMemberChange((next, previous) => {
    if (!previous || previous === next.user?.id) return;
    bookings.cancelOpen({force: true, clearDrafts: true});
    close();
    dialog?.querySelector('[data-booking-content]').replaceChildren();
  });
  if (new URLSearchParams(location.search).get('book') === '1') void open();
}
