/**
 * Every style rule the applied stylesheets hold, each with the media
 * condition it sits under, so a test can tell a rule that always applies
 * from one that applies only under reduced motion. Pair it with
 * `applyStylesheet`, since jsdom evaluates no media query itself.
 */
export function styleRules(): { rule: CSSStyleRule; media: string | null }[] {
  const rules: { rule: CSSStyleRule; media: string | null }[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule) rules.push({ rule, media: null });
      if (rule instanceof CSSMediaRule)
        for (const inner of rule.cssRules)
          if (inner instanceof CSSStyleRule)
            rules.push({ rule: inner, media: rule.media.mediaText });
    }
  }
  return rules;
}
