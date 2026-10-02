import {createHash} from 'node:crypto';
const hash = code => "'sha256-"+createHash('sha256').update(code).digest('base64')+"'";
const payloads=(html,tag)=>[...html.matchAll(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','gi'))].map(m=>m[1]);
export function sealHtml(html,appId) {
 if (!/<head\b[^>]*>/i.test(html) || /http-equiv=["']Content-Security-Policy/i.test(html)) throw new Error('HTML needs a head and no existing CSP.');
 const scripts=payloads(html,'script').map(hash),styles=payloads(html,'style').map(hash);
 const policy=["default-src 'none'","connect-src 'none'",
 'script-src '+(scripts.join(' ') || "'none'"),'style-src '+(styles.join(' ') || "'none'"),
 'img-src data:','font-src data:',"frame-src 'none'","worker-src 'none'","object-src 'none'","form-action 'none'","base-uri 'none'"].join('; ');
 return html.replace(/<head\b[^>]*>/i,m=>m+'<meta name="arcbridge-app-id" content="'+appId+'"><meta name="arcbridge-protocol" content="1"><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
}
export function validateHtml(html,appId) {
 const csp=html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/i)?.[1];
 if (!csp || !csp.includes("connect-src 'none'")) throw new Error('Missing restrictive CSP.');
 const directives=csp.split('; ').map(value=>value.trim());
 const fixed=["default-src 'none'","connect-src 'none'","img-src data:","font-src data:","frame-src 'none'","worker-src 'none'","object-src 'none'","form-action 'none'","base-uri 'none'"];
 if(directives.length!==11 || fixed.some(value=>!directives.includes(value)))throw new Error('CSP policy has unsupported permissions.');
 if (!html.includes('<meta name="arcbridge-app-id" content="'+appId+'">')) throw new Error('Artifact app identity mismatch.');
 for(const tag of ['script','style']) {
   const actual=payloads(html,tag).map(hash);
   const declared=csp.split('; ').find(x=>x.startsWith(tag+'-src '))?.slice(tag.length+5).trim().split(' ') ?? [];
   if (actual.some(h=>!declared.includes(h)) || declared.some(h=>h!=="'none'"&&!actual.includes(h))) throw new Error('Inline CSP hash mismatch.');
 }
 if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\bhref\s*=/i.test(html)) throw new Error('External script/style asset is unsupported.');
 const markup=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 for (const match of markup.matchAll(/\b(?:src|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
  const value=match[1]??match[2]??match[3];
  if (!value.startsWith('data:')) throw new Error('Non-inline asset is unsupported: '+value);
 }
 if (/\sstyle\s*=|\son[a-z]+\s*=/i.test(markup)) throw new Error('Inline style/event attributes are incompatible with CSP.');
 for(const css of payloads(html,'style')) {
  if (/@import\b/i.test(css)) throw new Error('External CSS import is unsupported.');
  for(const m of css.matchAll(/url\(\s*['"]?([^)'"]+)/gi)) {
   if (!m[1].startsWith('data:') && !m[1].startsWith('#')) throw new Error('External CSS asset is unsupported.');
  }
 }
 return html;
}
