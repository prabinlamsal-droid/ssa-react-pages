import { createHash } from 'node:crypto';

/** Hash final inlined payloads after viteSingleFile has assembled the HTML. */
export function bridgeCsp() {
  return {
    name: 'ssa:bridge-csp',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const artifact of Object.values(bundle)) {
          if (artifact.type !== 'asset' || !artifact.fileName.endsWith('.html')) continue;
          const html = String(artifact.source);
          if (!/<head\b[^>]*>/i.test(html) ||
              /<(?:script|link)\b[^>]*(?:src|href)=/i.test(html) ||
              /http-equiv=["']Content-Security-Policy/i.test(html)) {
            this.error('Bridge HTML must have one head, inlined resources, and no pre-existing CSP.');
          }
          const hashes = tag => [...new Set([...html.matchAll(
            new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi'),
          )].map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'"))];
          const scripts = hashes('script');
          const styles = hashes('style');
          if (!scripts.length || !styles.length) this.error('Expected inline bridge scripts and styles.');
          const policy = [
            "default-src 'none'", "connect-src 'none'",
            'script-src ' + scripts.join(' '), 'style-src ' + styles.join(' '),
            'img-src data:', "frame-src 'none'", "worker-src 'none'",
            "object-src 'none'", "form-action 'none'", "base-uri 'none'",
          ].join('; ');
          artifact.source = html.replace(/<head\b[^>]*>/i, match =>
            match + '\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">');
        }
      },
    },
  };
}

