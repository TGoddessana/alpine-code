<p><img src="../../assets/brand/wordmark.png" alt="Alpine Code" width="280"></p>

# Website and getting-started guide

A static, responsive Korean homepage, documentation page and downloadable brand kit. Product claims follow the repository; downloads point to the GitHub release page. There are no accounts, analytics, runtime secrets or third-party font requests.

```sh
pnpm website:build
python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/website/dist
```

- Edit `src/index.html`, `src/docs/index.html`, `src/brand.html`, `src/style.css` and `src/site.js`.
- `scripts/build-website.mjs` copies approved brand exports, current product screenshots and the locally installed Pretendard font plus its licence to `dist/`.
- The app source and desktop screenshot fixtures remain in `apps/desktop`; no UI is reimplemented for marketing screenshots.
- `.openai/hosting.json` records the owner-private Sites preview. Never register a duplicate Site for this source.
- Publication uses an isolated Sites checkout containing only these sources and their built assets. It must not push the enclosing Alpine Code Git repository to the Sites remote.
- When deploying to a future custom domain, update absolute `og:image` URLs to that verified origin. The proposed `alpinecode.app` domain is not connected.

Check desktop and mobile layouts, internal links, image loading, the install-command copy button, FAQ disclosures and keyboard navigation before publishing. The local build is portable to any static host.
