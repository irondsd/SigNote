import posthog from 'posthog-js';
import type { CaptureResult } from 'posthog-js';

// Keep URL-derived properties out of every event. The app puts search terms in
// the URL, and note routes can contain note identifiers.
const URL_PROPERTIES = [
  '$current_url',
  '$pathname',
  '$host',
  '$referrer',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_referrer',
] as const;

const stripUrlProperties = (event: CaptureResult | null): CaptureResult | null => {
  if (!event) return event;

  const properties = { ...event.properties };
  for (const property of URL_PROPERTIES) delete properties[property];

  return { ...event, properties };
};

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',

  // These are privacy invariants, not dashboard preferences. The local false
  // values take precedence over PostHog's remote project configuration.
  autocapture: false,
  rageclick: false,
  property_denylist: ['$elements', '$el_text', ...URL_PROPERTIES],
  mask_all_text: true,
  mask_all_element_attributes: true,
  capture_pageview: false,
  capture_pageleave: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_performance: false,
  disable_session_recording: true,
  enable_recording_console_log: false,
  session_recording: {
    captureJsonLd: false,
    recordBody: false,
    recordHeaders: false,
  },
  save_campaign_params: false,
  save_referrer: false,
  before_send: stripUrlProperties,

  capture_exceptions: true,
  debug: false,
});
