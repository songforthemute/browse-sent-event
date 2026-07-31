export type BrowseSentEventUrlFilter = (url: string) => boolean;

type UrlMatcher = (url: string) => boolean;

function createRegExpMatcher(pattern: RegExp): UrlMatcher | undefined {
  try {
    const matcher = new RegExp(pattern.source, pattern.flags);

    return (url) => {
      try {
        matcher.lastIndex = 0;
        return matcher.test(url);
      } catch {
        return false;
      } finally {
        matcher.lastIndex = 0;
      }
    };
  } catch {
    return undefined;
  }
}

export function createUrlFilter(patterns: readonly (string | RegExp)[]): BrowseSentEventUrlFilter {
  const matchers = patterns.flatMap<UrlMatcher>((pattern) => {
    if (typeof pattern === "string") {
      return [(url) => url.includes(pattern)];
    }

    const matcher = createRegExpMatcher(pattern);

    return matcher ? [matcher] : [];
  });

  return (url) => matchers.some((matcher) => matcher(url));
}
