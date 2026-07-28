/**
 * Resolving paths to files served out of `public/`.
 *
 * The dev server serves the app from `/`, but a GitHub Pages project site
 * serves it from `/<repo>/`, so a hardcoded `/pin.png` would 404 there. Vite
 * bakes the deployment prefix into `import.meta.env.BASE_URL` at build time
 * (from `base` in `vite.config.ts`); every runtime fetch of a `public/` file
 * goes through the helper below so both layouts work unchanged.
 */

/** Prefixes a `public/`-relative path with the deployment base. */
export const asset = (path: string): string =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
