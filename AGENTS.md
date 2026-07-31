# Repository contract

This repository is intended to be public and generic.

- Never add customer names, customer paths, private benchmark data, cluster credentials, or cloud
  account identifiers.
- Generated run data belongs in `public/data/`; JSON files there are ignored by git.
- Keep aggregate metrics visibly distinct from request-correlated facts. Never imply exact routing
  or batch membership when the source data does not contain it.
- Run `npm test` and `npm run build` before committing.
- Keep the UI usable with keyboard navigation and reduced-motion preferences.
