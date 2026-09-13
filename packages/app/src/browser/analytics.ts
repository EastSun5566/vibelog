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

if (loader && banner && settings && allow && deny && measurementId && /^G-[A-Z0-9]+$/u.test(measurementId)) {
  const analyticsWindow = window as unknown as AnalyticsWindow & Record<string, unknown>;
  let started = false;

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

  const gtag = (...args: unknown[]): void => {
    analyticsWindow.dataLayer.push(args);
  };

  const enableAnalytics = (): void => {
    analyticsWindow[`ga-disable-${measurementId}`] = false;
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
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    if (loader.nonce) script.nonce = loader.nonce;
    document.head.append(script);
    started = true;
  };

  const disableAnalytics = (): void => {
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
