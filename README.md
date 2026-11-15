# filing-reader dashboard

Generated site: do not edit by hand. Every file here is replaced on each publish by the `dashboard`
workflow of the filing-reader project (`fr dashboard build`), from its committed ledger.
It shows aggregate and operational data only (company list, filing activity, screening counts,
price indices, pipeline health). `private/` is a password-protected view: its data is only in
`private/payload.json`, encrypted (AES-256-GCM, key from PBKDF2-HMAC-SHA256), decrypted in the browser.

Served by GitHub Pages from the root of `main`.
