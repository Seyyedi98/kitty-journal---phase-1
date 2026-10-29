// The page that runs inside the editor WebView. Fully offline, no libraries:
// a contenteditable surface, with our own undo history and list handling
// (the browser's built-ins are inconsistent across Android WebView versions).
//
// Native -> page:  window.__cmd(name, arg)
// Page -> native:  postMessage(JSON) with { t: 'ready' | 'change' | 'state' | 'height' | 'caret' | 'focus' }
//
// Direction is automatic PER BLOCK (CSS unicode-bidi: plaintext) unless the user
// forces LTR/RTL on a block (dir attribute), so Persian, Arabic, Turkish and
// English paragraphs lay out correctly in the same entry.

const esc = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => (ch === '\u2028' ? '\\u2028' : '\\u2029'));

export function buildEditorHtml({ html = '', rtl = false, placeholder = '', minHeight = 220, colors = {}, fontSize = 15 }) {
  const c = {
    ink: '#3F3A33', muted: '#8A8070', line: '#E4DCCB', accent: '#6F8F6A', selection: '#CFE0CB', ...colors,
  };
  return `<!doctype html>
<html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
html,body{margin:0;padding:0;background:transparent;-webkit-tap-highlight-color:transparent;overflow:hidden;overscroll-behavior:none;touch-action:none}
body{position:relative;color:${c.ink};font-family:system-ui,-apple-system,Roboto,'Noto Sans','Noto Naskh Arabic','Noto Sans Arabic',sans-serif;font-size:${fontSize}px;line-height:1.75}
#ed{touch-action:none;outline:none;min-height:${minHeight}px;padding:12px 0 24px;word-wrap:break-word;overflow-wrap:anywhere;caret-color:${c.accent};-webkit-user-select:text;user-select:text}
#ed ::selection,#ed::selection{background:${c.selection}}
#ph{position:absolute;top:12px;inset-inline-start:0;color:${c.muted};pointer-events:none;display:none}
p,div,h1,h2,h3,li,blockquote,ul,ol{unicode-bidi:plaintext;text-align:start}
[dir="ltr"],[dir="rtl"]{unicode-bidi:isolate}
p{margin:0 0 .3em}
h1{font-size:1.55em;line-height:1.35;margin:.45em 0 .25em;font-weight:700}
h2{font-size:1.28em;line-height:1.4;margin:.4em 0 .2em;font-weight:700}
h3{font-size:1.1em;margin:.35em 0 .2em;font-weight:700}
ul,ol{margin:.2em 0;padding-inline-start:1.5em}
li{margin:.1em 0}
blockquote{margin:.4em 0;padding-inline-start:.9em;border-inline-start:3px solid ${c.line};color:${c.muted}}
hr{border:0;border-top:1px solid ${c.line};margin:.9em 0}
strong,b{font-weight:700}
</style></head>
<body><div id="ph"></div><div id="ed" contenteditable="true" spellcheck="true" autocapitalize="sentences"></div>
<script>
(function(){
var ed=document.getElementById('ed'),ph=document.getElementById('ph');
var INIT=${esc(html)},PH=${esc(placeholder)},INK=${esc(c.ink)};
var post=function(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}};
try{document.execCommand('defaultParagraphSeparator',false,'p');}catch(e){}
ph.textContent=PH;
var saved=null,lastState='',lastH=0,changeTimer=null;
var BLOCK=/^(P|H1|H2|H3|UL|OL|BLOCKQUOTE|HR|DIV)$/;
var LEAF='p,h1,h2,h3,li,blockquote,div';
var LISTS=/^(UL|OL)$/;

/* ---------- selection helpers: positions are (leaf index, character offset) ---------- */
function leaves(){var all=ed.querySelectorAll(LEAF),out=[];for(var i=0;i<all.length;i++){if(!all[i].querySelector(LEAF))out.push(all[i]);}return out;}
function leafOf(node){while(node&&node!==ed){if(node.nodeType===1&&node.matches(LEAF)&&!node.querySelector(LEAF))return node;node=node.parentNode;}return null;}
function charsBefore(leaf,node,off){var r=document.createRange();r.selectNodeContents(leaf);try{r.setEnd(node,off);}catch(e){return 0;}return r.toString().length;}
function pointIn(leaf,chars){
  var w=document.createTreeWalker(leaf,NodeFilter.SHOW_TEXT),n,acc=0;
  while((n=w.nextNode())){var l=n.nodeValue.length;if(acc+l>=chars)return [n,chars-acc];acc+=l;}
  return [leaf,leaf.childNodes.length];
}
function inEd(){var s=getSelection();return s.rangeCount>0&&ed.contains(s.anchorNode);}
function getSel(){
  var s=getSelection();if(!s.rangeCount||!ed.contains(s.anchorNode))return null;
  var r=s.getRangeAt(0),L=leaves(),a=leafOf(r.startContainer),b=leafOf(r.endContainer);
  if(!a||!b)return null;
  return {si:L.indexOf(a),so:charsBefore(a,r.startContainer,r.startOffset),ei:L.indexOf(b),eo:charsBefore(b,r.endContainer,r.endOffset)};
}
function setSel(o){
  if(!o)return;var L=leaves();if(!L[o.si]||!L[o.ei])return;
  var a=pointIn(L[o.si],o.so),b=pointIn(L[o.ei],o.eo),r=document.createRange(),s=getSelection();
  r.setStart(a[0],a[1]);r.setEnd(b[0],b[1]);s.removeAllRanges();s.addRange(r);
}
function topOf(node){while(node&&node.parentNode!==ed)node=node.parentNode;return node;}
function coveredTops(){
  var s=getSelection();if(!s.rangeCount)return [];
  var r=s.getRangeAt(0),out=[];
  for(var i=0;i<ed.children.length;i++){if(r.intersectsNode(ed.children[i]))out.push(ed.children[i]);}
  return out;
}

/* ---------- structure: always <p|h1|h2|ul|ol|blockquote|hr> directly inside #ed ---------- */
function isEmptyEl(el){return el.textContent===''&&!el.querySelector('br,hr,img,ul,ol');}
function fixStructure(){
  // A list nested inside a paragraph/heading (what some WebViews produce) is lifted out.
  var guard=0,lists=ed.querySelectorAll('ul,ol');
  for(var i=0;i<lists.length&&guard<200;i++){
    var l=lists[i],par=l.parentNode;
    if(par===ed||par.tagName==='LI'||!/^(P|DIV|H1|H2|H3|BLOCKQUOTE)$/.test(par.tagName)||par.parentNode!==ed)continue;
    guard++;
    var sel=getSel(),before=par.cloneNode(false),after=par.cloneNode(false);
    while(par.firstChild&&par.firstChild!==l)before.appendChild(par.firstChild);
    while(l.nextSibling)after.appendChild(l.nextSibling);
    ed.insertBefore(l,par);
    if(!isEmptyEl(before)||before.firstChild)ed.insertBefore(before,l);
    if(after.firstChild&&!isEmptyEl(after))ed.insertBefore(after,par);
    ed.removeChild(par);
    if(before.parentNode&&isEmptyEl(before))ed.removeChild(before);
    setSel(sel);
  }
}
function normalize(){
  if(!ed.firstChild){ed.innerHTML='<p><br></p>';return;}
  var n=ed.firstChild;
  while(n){
    var nx=n.nextSibling;
    var isBlock=n.nodeType===1&&BLOCK.test(n.tagName);
    if(!isBlock){
      var p=document.createElement('p');ed.insertBefore(p,n);p.appendChild(n);
      while(p.nextSibling&&!(p.nextSibling.nodeType===1&&BLOCK.test(p.nextSibling.tagName))){p.appendChild(p.nextSibling);}
      nx=p.nextSibling;
    }
    n=nx;
  }
  fixStructure();
  // merge neighbouring lists of the same kind; keep empty blocks clickable
  var sel=null,merged=false;
  for(var i=1;i<ed.children.length;i++){
    var cur=ed.children[i],prev=ed.children[i-1];
    if(LISTS.test(cur.tagName)&&prev.tagName===cur.tagName&&(prev.getAttribute('dir')||'')===(cur.getAttribute('dir')||'')){
      if(!merged){sel=getSel();merged=true;}
      while(cur.firstChild)prev.appendChild(cur.firstChild);
      ed.removeChild(cur);i--;
    }
  }
  if(merged)setSel(sel);
  for(var j=0;j<ed.children.length;j++){
    var b=ed.children[j];
    if(/^(P|H1|H2|H3)$/.test(b.tagName)&&!b.firstChild)b.appendChild(document.createElement('br'));
  }
}

/* ---------- reporting ---------- */
function isEmpty(){return ed.textContent===''&&!ed.querySelector('ul,ol,hr,blockquote');}
function updatePh(){ph.style.display=isEmpty()?'block':'none';}
function qs(c){try{return document.queryCommandState(c);}catch(e){return false;}}
function hexOf(v){
  var str=String(v||''),i=str.indexOf('(');
  if(i<0)return '';
  var parts=str.slice(i+1).split(')')[0].split(',');
  if(parts.length<3)return '';
  var out='#';
  for(var k=0;k<3;k++){var n=parseInt(parts[k],10);if(isNaN(n))return '';out+=('0'+n.toString(16)).slice(-2);}
  return out;
}
function currentColor(){
  var s=getSelection();if(!s.rangeCount)return '';
  var n=s.anchorNode;n=n&&n.nodeType===1?n:(n&&n.parentElement);
  if(!n||!ed.contains(n))return '';
  var h=hexOf(getComputedStyle(n).color);
  return h===INK.toLowerCase()?'':h;
}
function currentHighlight(){
  var s=getSelection();if(!s.rangeCount)return '';
  var n=s.anchorNode;n=n&&n.nodeType===1?n:(n&&n.parentElement);
  while(n&&n!==ed){
    var b=n.style&&n.style.backgroundColor;
    if(b&&b!=='transparent'&&b!=='rgba(0, 0, 0, 0)')return b.replace(/ /g,'');
    n=n.parentElement;
  }
  return '';
}
function currentFont(){
  var s=getSelection();if(!s.rangeCount)return '';
  var n=s.anchorNode;n=n&&n.nodeType===1?n:(n&&n.parentElement);
  if(!n||!ed.contains(n))return '';
  return fontKeyOf(getComputedStyle(n).fontFamily.split(',')[0]);
}
var hist=[],hpos=-1,hTimer=null;
function report(force){
  if(!inEd()&&!force)return;
  var s=getSelection(),st={bold:qs('bold'),italic:qs('italic'),underline:qs('underline'),strike:qs('strikeThrough'),list:'',block:'',dir:'',color:'',font:'',highlight:'',
    canUndo:hpos>0||!!hTimer,canRedo:hpos<hist.length-1};
  if(inEd()){
    var t=topOf(s.anchorNode);
    if(t&&t.nodeType===1){
      var tag=t.tagName.toLowerCase();
      if(tag==='ul'||tag==='ol')st.list=tag;else st.block=tag;
      st.dir=t.getAttribute('dir')||'';
    }
    st.color=currentColor();st.font=currentFont();st.highlight=currentHighlight();
  }
  var j=JSON.stringify(st);
  if(j!==lastState){lastState=j;post({t:'state',s:st});}
}
function height(){var h=Math.ceil(ed.getBoundingClientRect().height);if(h!==lastH){lastH=h;post({t:'height',h:h});}}
function caret(){
  var s=getSelection();if(!s.rangeCount)return;
  var r=s.getRangeAt(0).cloneRange();r.collapse(false);
  var rs=r.getClientRects(),b=rs.length?rs[rs.length-1]:null;
  if(!b||(b.height===0&&b.top===0)){var el=s.anchorNode;el=el&&el.nodeType===1?el:(el&&el.parentElement);if(el)b=el.getBoundingClientRect();}
  if(b)post({t:'caret',y:Math.round(b.bottom)});
}
function emitNow(){clearTimeout(changeTimer);changeTimer=null;post({t:'change',html:ed.innerHTML});}
function emit(){clearTimeout(changeTimer);changeTimer=setTimeout(emitNow,120);}
function afterEdit(){normalize();updatePh();height();emit();report(true);}

/* ---------- undo history: whole typing bursts, not single letters ---------- */
function snap(){return {h:ed.innerHTML,s:getSel()};}
function pushSnap(){
  var cur=snap();
  if(hpos>=0&&hist[hpos].h===cur.h){hist[hpos].s=cur.s;return;}
  hist=hist.slice(0,hpos+1);hist.push(cur);
  if(hist.length>150)hist.shift();
  hpos=hist.length-1;
}
function scheduleSnap(){clearTimeout(hTimer);hTimer=setTimeout(function(){hTimer=null;pushSnap();report(true);},700);}
function flushSnap(){if(hTimer){clearTimeout(hTimer);hTimer=null;pushSnap();}}
function loadSnap(x){ed.innerHTML=x.h;normalize();setSel(x.s);ed.focus();setSel(x.s);afterEdit();saveSel();}
function undo(){flushSnap();if(hpos<=0)return;hpos--;loadSnap(hist[hpos]);}
function redo(){flushSnap();if(hpos>=hist.length-1)return;hpos++;loadSnap(hist[hpos]);}

/* ---------- block commands ---------- */
function saveSel(){var s=getSelection();if(s.rangeCount&&ed.contains(s.anchorNode))saved=s.getRangeAt(0).cloneRange();}
function restore(){
  var s=getSelection();
  var live=(s.rangeCount&&ed.contains(s.anchorNode))?s.getRangeAt(0).cloneRange():saved;
  ed.focus();
  if(live){s.removeAllRanges();s.addRange(live);}
}
// Replace whole top-level blocks with new HTML and put the selection back. Plain DOM
// work on purpose: insertHTML merges the new block into the first <li> of a list. Undo
// is our own snapshot history, so nothing depends on the browser's undo stack.
function replaceTops(tops,html,selAfter){
  var tpl=document.createElement('template');tpl.innerHTML=html;
  ed.insertBefore(tpl.content,tops[0]);
  tops.forEach(function(t){if(t.parentNode===ed)ed.removeChild(t);});
  setSel(selAfter);
}
function attr(d){return d?' dir="'+d+'"':'';}
function setList(kind){
  fixStructure();
  var tops=coveredTops();if(!tops.length)return;
  var sel=getSel();
  var same=tops.every(function(b){return b.tagName.toLowerCase()===kind;});
  var html='',pending=[],pdir='';
  function flush(){if(pending.length){html+='<'+kind+attr(pdir)+'>'+pending.join('')+'</'+kind+'>';pending=[];pdir='';}}
  tops.forEach(function(b){
    var t=b.tagName,d=b.getAttribute('dir')||'';
    if(LISTS.test(t)){
      var items=[].slice.call(b.children);
      if(same){flush();items.forEach(function(li){html+='<p'+attr(d)+'>'+(li.innerHTML||'<br>')+'</p>';});}
      else{if(!pending.length)pdir=d;items.forEach(function(li){pending.push('<li>'+(li.innerHTML||'<br>')+'</li>');});}
    }else if(t==='HR'){flush();html+='<hr>';}
    else{if(!pending.length)pdir=d;pending.push('<li>'+(b.innerHTML||'<br>')+'</li>');}
  });
  flush();
  replaceTops(tops,html,sel);
}
// Backspace at the very start of a list item (or Enter on an empty one) leaves the list.
function leaveList(li){
  var list=li.parentNode;if(!list||!LISTS.test(list.tagName)||list.parentNode!==ed)return false;
  var kind=list.tagName.toLowerCase(),d=list.getAttribute('dir')||'',items=[].slice.call(list.children),idx=items.indexOf(li);
  var mk=function(arr){return arr.length?'<'+kind+attr(d)+'>'+arr.map(function(x){return '<li>'+(x.innerHTML||'<br>')+'</li>';}).join('')+'</'+kind+'>':'';};
  var html=mk(items.slice(0,idx))+'<p'+attr(d)+'>'+(li.innerHTML||'<br>')+'</p>'+mk(items.slice(idx+1));
  var all=leaves(),li_i=all.indexOf(li);
  replaceTops([list],html,{si:li_i,so:0,ei:li_i,eo:0});
  return true;
}
function toggleBlock(tag){
  var t=coveredTops()[0],cur=t&&t.tagName.toLowerCase();
  if(cur==='ul'||cur==='ol')return;
  document.execCommand('formatBlock',false,'<'+(cur===tag?'p':tag)+'>');
}
function setDir(d){
  var tops=coveredTops().filter(function(b){return b.tagName!=='HR';});if(!tops.length)return;
  var same=tops.every(function(b){return b.getAttribute('dir')===d;});
  tops.forEach(function(b){
    if(same)b.removeAttribute('dir');else b.setAttribute('dir',d);
    if(LISTS.test(b.tagName)){for(var i=0;i<b.children.length;i++)b.children[i].removeAttribute('dir');}
  });
}
var FONT_NAMES={serif:'serif',naskh:'Noto Naskh Arabic',mono:'monospace',hand:'cursive'};
function fontKeyOf(v){
  var x=String(v||'').toLowerCase();
  if(x.indexOf('naskh')>=0)return 'naskh';
  if(x.indexOf('mono')>=0||x.indexOf('courier')>=0)return 'mono';
  if(x.indexOf('cursive')>=0||x.indexOf('script')>=0)return 'hand';
  if(x.indexOf('serif')>=0&&x.indexOf('sans')<0)return 'serif';
  return '';
}
function setFont(key){
  try{document.execCommand('styleWithCSS',false,true);}catch(e){}
  document.execCommand('fontName',false,FONT_NAMES[key]||'system-ui');
  try{document.execCommand('styleWithCSS',false,false);}catch(e){}
}
function setHighlight(v){
  try{document.execCommand('styleWithCSS',false,true);}catch(e){}
  document.execCommand('hiliteColor',false,v||'transparent');
  try{document.execCommand('styleWithCSS',false,false);}catch(e){}
}
function setColor(hex){
  try{document.execCommand('styleWithCSS',false,true);}catch(e){}
  document.execCommand('foreColor',false,hex||INK);
  try{document.execCommand('styleWithCSS',false,false);}catch(e){}
}

window.__cmd=function(name,arg){
  restore();
  if(name==='undo'){undo();return;}
  if(name==='redo'){redo();return;}
  flushSnap();
  var map={bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough'};
  if(map[name])document.execCommand(map[name],false,null);
  else if(name==='ul'||name==='ol')setList(name);
  else if(name==='h1'||name==='h2'||name==='h3')toggleBlock(name);
  else if(name==='ltr'||name==='rtl')setDir(name);
  else if(name==='color')setColor(arg);
  else if(name==='font')setFont(arg);
  else if(name==='highlight')setHighlight(arg);
  afterEdit();pushSnap();saveSel();report(true);
};
window.__focus=function(){restore();};

/* ---------- events ---------- */
ed.addEventListener('beforeinput',function(e){
  var t=e.inputType;
  if(t==='historyUndo'){e.preventDefault();undo();return;}
  if(t==='historyRedo'){e.preventDefault();redo();return;}
  var s=getSelection();
  if(s.rangeCount&&s.isCollapsed){
    var li=s.anchorNode&&(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement);
    while(li&&li!==ed&&li.tagName!=='LI')li=li.parentElement;
    if(li&&li.tagName==='LI'){
      var atStart=charsBefore(li,s.anchorNode,s.anchorOffset)===0;
      if((t==='deleteContentBackward'&&atStart)||(t==='insertParagraph'&&isEmptyEl(li))){
        flushSnap();e.preventDefault();
        if(leaveList(li)){afterEdit();pushSnap();}
        return;
      }
    }
  }
  if(t==='insertParagraph'||t==='insertFromPaste'||t==='deleteByCut')flushSnap();
});
ed.addEventListener('input',function(e){
  afterEdit();saveSel();caret();
  if(e.inputType==='insertParagraph'||e.inputType==='insertFromPaste'||e.inputType==='deleteByCut'){pushSnap();}
  else scheduleSnap();
});
ed.addEventListener('blur',function(){if(changeTimer)emitNow();flushSnap();post({t:'focus',v:false});});
ed.addEventListener('focus',function(){post({t:'focus',v:true});});
ed.addEventListener('paste',function(e){
  e.preventDefault();
  var t=(e.clipboardData||window.clipboardData).getData('text/plain');
  if(t){flushSnap();document.execCommand('insertText',false,t);}
});
ed.addEventListener('drop',function(e){e.preventDefault();});
document.addEventListener('selectionchange',function(){saveSel();report();});
if(window.ResizeObserver){new ResizeObserver(height).observe(ed);}
/* The WebView is exactly as tall as the text, so the page itself must never scroll:
   an inner scroll would swallow vertical drags that belong to the outer screen. */
function pin(){if(window.scrollX||window.scrollY)window.scrollTo(0,0);if(document.documentElement.scrollTop)document.documentElement.scrollTop=0;if(document.body.scrollTop)document.body.scrollTop=0;}
window.addEventListener('scroll',pin,{passive:true});document.addEventListener('scroll',pin,{passive:true});

/* Vertical drags anywhere on the text scroll the OUTER screen. The page cannot scroll itself, and a
   WebView swallows touches that start on it, so the drag is measured here (in screen coordinates,
   which do not shift while the outer screen moves) and forwarded to the app, with a fling at the end. */
var dragY=0,dragT=0,dragV=0,dragging=false,startY=0,multi=false;
document.addEventListener('touchstart',function(e){
  multi=e.touches.length>1;if(multi)return;
  var t=e.touches[0];startY=dragY=t.screenY;dragT=Date.now();dragV=0;dragging=false;post({t:'tstart'});
},{passive:true});
document.addEventListener('touchmove',function(e){
  if(multi||e.touches.length!==1)return;
  var sel=getSelection();if(sel&&!sel.isCollapsed&&inEd())return;
  var t=e.touches[0];
  if(!dragging){if(Math.abs(t.screenY-startY)<8)return;dragging=true;}
  var dy=dragY-t.screenY,now=Date.now(),dt=Math.max(1,now-dragT);
  dragV=0.75*dragV+0.25*(dy/dt);dragY=t.screenY;dragT=now;
  if(dy)post({t:'drag',dy:dy});
},{passive:true});
function endDrag(){if(dragging){post({t:'dragend',v:Date.now()-dragT>120?0:dragV});}dragging=false;}
document.addEventListener('touchend',endDrag,{passive:true});document.addEventListener('touchcancel',endDrag,{passive:true});

ed.innerHTML=INIT;normalize();updatePh();
hist=[{h:ed.innerHTML,s:null}];hpos=0;
post({t:'ready'});height();
})();
</script></body></html>`;
}
