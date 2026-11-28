type AnalyticsConsent = 'granted' | 'denied';

interface AnalyticsWindow extends Window {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
}

const storageKey = 'vibelog:analytics-consent';
const loader = document.querySelector<HTMLScriptElement>('script[data-analytics-loader]');
const banner = document.querySelector<HTMLElement>('[data-analytics-consent]');
const settings = document.querySelector<HTMLButtonElement>('[data-analytics-settings]');
const allow = document.querySelector<HTMLButtonElement>('[data-analytics-allow]');
const deny = document.querySelector<HTMLButtonElement>('[data-analytics-deny]');
const measurementId = loader?.dataset.measurementId;

if (
  loader &&
  banner &&
  settings &&
  allow &&
  deny &&
  measurementId &&
  /^G-[A-Z0-9]+$/u.test(measurementId)
) {
  const analyticsWindow = window as unknown as AnalyticsWindow & Record<string, unknown>;
  let started = false;
  let enabled = false;

  // GA gets page types, not people: /@someone becomes /@name, and query strings (which can carry
  // a HackMD name in returnTo) and other sites' paths are dropped.
  const redactPath = (path: string): string => path.replace(/^\/@[^/]+/u, '/@name');
  const redactedReferrer = (): string => {
    try {
      const referrer = new URL(document.referrer);
      return referrer.origin === location.origin
        ? `${referrer.origin}${redactPath(referrer.pathname)}`
        : referrer.origin;
    } catch {
      return '';
    }
  };
  const track = (event: string): void => {
    if (enabled) analyticsWindow.gtag('event', event);
  };

  const readConsent = (): AnalyticsConsent | undefined => {
    try {
      const value = localStorage.getItem(storageKey);
      return value === 'granted' || value === 'denied' ? value : undefined;
    } catch {
      return undefined;
    }
  };

  const writeConsent = (value: AnalyticsConsent): void => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // A blocked storage API should not prevent the visitor from making a session choice.
    }
  };

  const showBanner = (): void => {
    banner.hidden = false;
    settings.hidden = true;
  };

  const hideBanner = (): void => {
    banner.hidden = true;
    settings.hidden = false;
  };

  // gtag.js only acts on Arguments objects in dataLayer; pushing an array is silently ignored,
  // which kept every page view from being sent. This mirrors Google's own snippet.
  const gtag = function (): void {
    // oxlint-disable-next-line prefer-rest-params
    analyticsWindow.dataLayer.push(arguments);
  } as (...args: unknown[]) => void;

  const enableAnalytics = (): void => {
    analyticsWindow[`ga-disable-${measurementId}`] = false;
    enabled = true;
    if (started) {
      analyticsWindow.gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }

    analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
    analyticsWindow.gtag = gtag;
    analyticsWindow.gtag('consent', 'default', {
      ad_personalization: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      analytics_storage: 'granted',
    });
    analyticsWindow.gtag('js', new Date());
    analyticsWindow.gtag('config', measurementId, {
      allow_ad_personalization_signals: false,
      allow_google_signals: false,
      page_location: `${location.origin}${redactPath(location.pathname)}`,
      page_referrer: redactedReferrer(),
      // gtag.js would otherwise send document.title, which names the profile on previews.
      page_title: document.title.replace(/@[^\s·]+/gu, '@name'),
    });
    // Funnel steps: a page marks what viewing it means, and links mark what clicking them means.
    const view =
      document.querySelector<HTMLElement>('[data-analytics-view]')?.dataset.analyticsView;
    if (view) track(view);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    if (loader.nonce) script.nonce = loader.nonce;
    document.head.append(script);
    started = true;
  };

  const disableAnalytics = (): void => {
    enabled = false;
    if (started) analyticsWindow.gtag('consent', 'update', { analytics_storage: 'denied' });
    analyticsWindow[`ga-disable-${measurementId}`] = true;
  };

  allow.addEventListener('click', () => {
    writeConsent('granted');
    enableAnalytics();
    hideBanner();
  });
  deny.addEventListener('click', () => {
    writeConsent('denied');
    disableAnalytics();
    hideBanner();
  });
  settings.addEventListener('click', showBanner);
  for (const link of document.querySelectorAll<HTMLElement>('[data-analytics-event]'))
    link.addEventListener('click', () => {
      track(link.dataset.analyticsEvent ?? '');
    });

  const consent = readConsent();
  if (consent === 'granted') {
    enableAnalytics();
    hideBanner();
  } else if (consent === 'denied') {
    disableAnalytics();
    hideBanner();
  } else {
    showBanner();
  }
}
