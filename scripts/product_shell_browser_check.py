#!/usr/bin/env python3
import argparse
import contextlib
import http.server
import json
import os
import pathlib
import threading

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]


@contextlib.contextmanager
def static_server():
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(ROOT), **kwargs
    )
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def chrome_path():
    candidates = [
        os.environ.get('WEBMCP_CHROME_BIN'),
        os.path.expanduser('~/.cache/webmcp-chrome/chrome/linux-154.0.8035.0/chrome-linux64/chrome'),
        os.path.expanduser('~/.cache/webmcp-chrome/chrome'),
    ]
    return next((candidate for candidate in candidates if candidate and os.path.isfile(candidate)), None)


def run(mode):
    desktop = mode in {'desktop', 'package-desktop', 'calendar-desktop'}
    viewport = {'width': 1440, 'height': 900} if desktop else {'width': 390, 'height': 844}
    console_errors = []
    with static_server() as url, sync_playwright() as playwright:
        kwargs = {'headless': True}
        executable = chrome_path()
        if executable:
            kwargs['executable_path'] = executable
        browser = playwright.chromium.launch(**kwargs)
        page = browser.new_page(viewport=viewport)
        page.set_default_timeout(5_000)
        page.set_default_navigation_timeout(10_000)
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        page.goto(url, wait_until='networkidle')

        if mode in {'calendar-desktop', 'calendar-mobile'}:
            counts = [int(page.get_by_test_id('live-registry-count').inner_text())]
            page.get_by_test_id('model-action').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            page.get_by_test_id('prepare-action').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            initial_days = page.get_by_test_id('countdown-days').inner_text()
            submit_visible_before = page.get_by_test_id('registry-list').get_by_text(
                'submit_exercise', exact=True
            ).is_visible()
            page.get_by_test_id('advance-past-deadline').dispatch_event('click')
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            page.get_by_test_id('advance-past-deadline').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            receipt = {
                'mode': mode,
                'registry_counts': counts,
                'initial_days': initial_days,
                'final_days': page.get_by_test_id('countdown-days').inner_text(),
                'final_clock': page.get_by_test_id('countdown-clock').inner_text(),
                'final_countdown_status': page.get_by_test_id(
                    'countdown-window-status'
                ).inner_text(),
                'final_status': page.get_by_test_id('blackout-status').inner_text(),
                'submit_visible_before': submit_visible_before,
                'submit_visible_after': page.get_by_test_id('registry-list').get_by_text(
                    'submit_exercise', exact=True
                ).count() > 0,
                'closed_chip_visible': page.get_by_test_id('window-closed-chip').is_visible(),
                'horizontal_overflow': page.evaluate(
                    'document.documentElement.scrollWidth - document.documentElement.clientWidth'
                ),
                'console_errors': console_errors,
            }
        elif mode == 'desktop':
            counts = [int(page.get_by_test_id('live-registry-count').inner_text())]
            page.get_by_test_id('share-input').fill('4263')
            page.get_by_test_id('model-action').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            page.get_by_test_id('prepare-action').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            assert page.get_by_test_id('submit-action').is_disabled()
            page.get_by_test_id('human-confirm').check()
            page.get_by_test_id('submit-action').click()
            submitted = 'submitted_simulation' in page.get_by_test_id('action-receipt').inner_text()
            page.get_by_test_id('advance-past-deadline').click()
            counts.append(int(page.get_by_test_id('live-registry-count').inner_text()))
            receipt = {
                'mode': mode,
                'registry_counts': counts,
                'submitted_simulation': submitted,
                'model_context_injected': False,
                'console_errors': console_errors,
            }
        elif mode == 'mobile':
            missing = []
            for section in ['landing', 'account', 'countdown', 'derivation', 'crossover', 'registry', 'forms', 'disclosure']:
                if page.locator(f'#{section}').count() != 1 or not page.locator(f'#{section}').is_visible():
                    missing.append(section)
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            receipt = {
                'mode': mode,
                'viewport_width': viewport['width'],
                'horizontal_overflow': overflow,
                'missing_sections': missing,
                'console_errors': console_errors,
            }
        elif mode == 'package-desktop':
            meta_count = page.locator('meta[http-equiv="origin-trial"]').count()
            meta_before_app = page.evaluate(
                """() => {
                  const meta = document.querySelector('meta[http-equiv="origin-trial"]');
                  const app = document.querySelector('script[src="./src/app.mjs"]');
                  return Boolean(meta && app && (meta.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING));
                }"""
            )
            page.goto(url + '404.html', wait_until='networkidle')
            receipt = {
                'mode': mode,
                'origin_meta_count': meta_count,
                'meta_before_app': meta_before_app,
                'fallback_title': page.title(),
                'fallback_has_account': page.locator('#account').count() == 1,
                'console_errors': console_errors,
            }
        else:
            receipt = {
                'mode': mode,
                'origin_meta_count': page.locator('meta[http-equiv="origin-trial"]').count(),
                'horizontal_overflow': page.evaluate(
                    'document.documentElement.scrollWidth - document.documentElement.clientWidth'
                ),
                'countdown_days': page.get_by_test_id('countdown-days').inner_text(),
                'registry_count': page.get_by_test_id('live-registry-count').inner_text(),
                'console_errors': console_errors,
            }
        browser.close()
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--mode',
        choices=[
            'desktop',
            'mobile',
            'package-desktop',
            'package-mobile',
            'calendar-desktop',
            'calendar-mobile',
        ],
        required=True,
    )
    args = parser.parse_args()
    print(json.dumps(run(args.mode), sort_keys=True))
