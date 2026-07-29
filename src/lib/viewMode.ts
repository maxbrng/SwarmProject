// Which panel to show: the full dev panel, or the curated exhibition panel. Production is always the
// exhibition view; in `next dev` you can force it by adding ?prod to the URL. The NODE_ENV check runs
// first so a production build folds IS_DEV to a static false and tree-shakes every dev-only branch.
function prodOverride(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("prod")
  );
}

export const IS_DEV = process.env.NODE_ENV !== "production" && !prodOverride();
