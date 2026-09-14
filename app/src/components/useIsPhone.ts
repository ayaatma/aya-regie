/**
 * Whether this is a phone, as far as anything can tell.
 *
 * A media query, because it is the only signal that is actually about the thing that matters:
 * how much room there is to draw eighteen hours across. User agent sniffing would call a tablet
 * in a keyboard case a phone and a small laptop window a desktop, both of which are wrong.
 *
 * Server rendering has no window and answers false, so the tests and any pre-render see the full
 * tool. The decision is never final either way: the night view offers a way out of itself.
 */

import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 760px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches);
    setPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return phone;
}
