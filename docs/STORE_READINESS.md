# Chrome Web Store readiness — working checklist

This is an engineering checklist, not a certification or legal opinion. Current project state: **not ready to publish**.

## Implemented foundations

- [x] Manifest V3; extension-page CSP restricts scripts to `'self'` and adds only the WASM compilation directive required by the bundled ONNX Runtime.
- [x] No remote JavaScript, CDN runtime, analytics or project-operated audio backend.
- [x] Tab capture starts only through an explicit toolbar action; tabCapture/activeTab permissions are used for YouTube audio.
- [x] Host access is limited to YouTube and AudD's API endpoint for user-consented track matching.
- [x] Recognition upload and storage are explained before the action; local history and token can be deleted.
- [x] Model origin/license and hash are recorded in `models/MODEL_CARD.md`.
- [x] Draft privacy policy added at `docs/PRIVACY_POLICY_DRAFT.md`.

## Required before a public release

- [ ] Complete human listening tests and 30-minute/low-tier device tests; record results in `tests/MANUAL_QA.md`.
- [ ] Run lifecycle and separation E2E suites in supported Chrome on YouTube; run long-session tests and verify actual capture ends, navigation, extension reload and recovery.
- [ ] Test AudD with an authorized token; validate actual WebM/Opus acceptance, successful match, no match, invalid credentials, network errors and throttling.
- [ ] Compare AudD and ACRCloud using current official pricing, limits, data retention, geographic availability, commercial terms and supported formats; obtain legal/owner approval for the selected service.
- [ ] Verify current Chrome Web Store user-data, limited-use and prominent disclosure requirements against official policy, then finalize the privacy policy, owner contact and support URL.
- [ ] Perform a dependency and model license audit for the exact shipped versions/artifacts; publish third-party notices. Do not assume this checklist substitutes for legal review.
- [ ] Decide and add an explicit project license (there is currently no root `LICENSE` file); verify all code, assets and model distribution rights first.
- [ ] Build the final zip from `dist/`, inspect actual package contents/size, check icons and screenshots, and test a clean install/update/uninstall.
- [ ] Review whether the AudD host permission should be optional at runtime (Chrome minimum version and consent flow considered) and ensure permission wording matches actual use.
- [ ] Document known audio limitations, including the mono mid-channel model behavior, music-louder-than-dialogue degradation and fallback behavior.

## Permission/CSP notes

`activeTab`, `tabCapture`, `offscreen`, and `storage` are used by the capture, DSP and preferences paths. `https://*.youtube.com/*` is used by the content UI and lifecycle URL observation. `https://api.audd.io/*` is used only from the offscreen extension page for explicit recognition requests. The extension-page CSP has no remote script source; `'wasm-unsafe-eval'` is needed for the packaged ORT WASM. Re-audit if any permission, host, dependency, model or provider changes.
