# شکیب‌لرن local frontend recreation

RTL React/Vite recreation of the publicly visible ShakibLearn frontend. It includes responsive desktop/mobile layouts, local image assets, product/article cards, route shells, mobile navigation drawer, cart drawer, category tabs, product accordions, forms, and the sticky mobile toolbar.

## Run

```bash
npm install
npm run dev
```

Then open `http://127.0.0.1:5173/`.

## Scope

- Technology: React 19 + Vite 8, plain CSS, no backend.
- Local collected image assets: 7 files in `assets/images/`.
- Source inspection confirmed the public site uses WordPress/WooCommerce, Elementor, LearnDash, and WoodMart. Those server-side systems are not copied.
- Google-hosted Vazirmatn is referenced for typography; system fallbacks remain available offline.
- Payments, accounts, checkout, wishlist persistence, app downloads, and course progress require a backend and are represented as frontend shells only.
