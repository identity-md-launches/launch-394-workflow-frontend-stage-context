const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
const lin = c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const L = h => { const [r,g,b] = hex(h).map(lin); return 0.2126*r+0.7152*g+0.0722*b; };
const cr = (a,b) => { const [x,y] = [L(a),L(b)].sort((p,q)=>q-p); return ((x+0.05)/(y+0.05)).toFixed(2); };
const pairs = [
 ['text on surface','#1f1b17','#ffffff'], ['text on bg','#1f1b17','#faf8f4'], ['text on surface-muted','#1f1b17','#f3efe8'],
 ['secondary on surface','#5c554c','#ffffff'], ['secondary on bg','#5c554c','#faf8f4'], ['secondary on surface-muted','#5c554c','#f3efe8'],
 ['muted (crosshair only) on surface','#857c71','#ffffff'],
 ['on-accent on accent','#ffffff','#a8325c'], ['on-accent on accent-hover','#ffffff','#8b2749'],
 ['accent link on surface','#a8325c','#ffffff'], ['accent link on bg','#a8325c','#faf8f4'],
 ['focus ring on surface','#1a56c4','#ffffff'], ['focus ring on bg','#1a56c4','#faf8f4'], ['focus ring on accent','#1a56c4','#a8325c'], ['focus ring on surface-muted','#1a56c4','#f3efe8'],
 ['ok text on ok bg','#1b6e3a','#e4f4e9'], ['error text on error bg','#a3271f','#fbe9e7'], ['warning text on warning bg','#7a5300','#fff1cf'],
 ['error text on surface','#a3271f','#ffffff'], ['series on surface','#0f7b8a','#ffffff'],
 ['border vs surface (non-text)','#e6e0d6','#ffffff'], ['border-strong vs surface (input border)','#cfc6b8','#ffffff'],
 ['secondary button text on surface','#1f1b17','#ffffff'],
];
for (const [n,a,b] of pairs) console.log(cr(a,b).padStart(6), n, a, b);
