(() => {
'use strict';

const STATUS={
  unknown:{label:'Unqualified',color:'#3a3a3c',score:0},
  named:{label:'Named',color:'#d7a81c',score:1},
  source:{label:'C reconstructed',color:'#1583bd',score:2},
  codegen_exact:{label:'Codegen exact',color:'#13a6b2',score:3},
  binary_exact:{label:'Binary exact',color:'#0ca770',score:4}
};
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={
  data:null,view:'functions',drill:null,rects:[],displayRects:[],hoveredKey:null,selectedKey:null,
  touchArmed:null,lastTouchAt:0,hoverStarted:0,transition:null,raf:0,memoryLanes:[],sizeRanks:new Map(),radarRects:[]
};
const canvas=document.querySelector('#treemap'),ctx=canvas.getContext('2d');
const radar=document.querySelector('#memory-radar'),rctx=radar.getContext('2d');
const tooltip=document.querySelector('#tooltip'),detail=document.querySelector('#detail');
const path=document.querySelector('#path'),back=document.querySelector('#back'),stats=document.querySelector('#stats');
const hoverReadout=document.querySelector('#hover-readout'),mapTitle=document.querySelector('#map-title'),radarRange=document.querySelector('#radar-range');
const buttons=[...document.querySelectorAll('[data-view]')];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes=v=>{const n=Number(v)||0;if(n>=1048576)return(n/1048576).toFixed(2)+' MB';if(n>=1024)return(n/1024).toFixed(1)+' kB';return n+' B'};
const fmtPct=v=>v==null?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
const addressNumber=i=>parseInt(String(i.address||'0').replace(/^0x/i,''),16)||0;
const itemKey=i=>i.kind==='group'?'group:'+i.name:'fn:'+i.address;
const statusPct=i=>i.status==='binary_exact'?100:(i.instruction_match_pct??i.reccmp_match_pct??i.raw_match_pct??0);
const cReconstructed=i=>i.kind==='function'&&i.function_class!=='CRT'&&(STATUS[i.status]?.score||0)>=2;

function exactStats(fs){
  const exactFns=fs.filter(f=>f.status==='binary_exact');
  const exactBytes=exactFns.reduce((s,f)=>s+f.size,0);
  return{functions:exactFns.length,bytes:exactBytes,functionPct:100*exactFns.length/Math.max(1,fs.length),bytePct:100*exactBytes/Math.max(1,fs.reduce((s,f)=>s+f.size,0))};
}
function aggregate(items){
  const groups=new Map();
  for(const fn of items){const name=fn.compilation_unit||'UNASSIGNED';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(fn)}
  return [...groups].map(([name,functions])=>{
    const size=functions.reduce((s,f)=>s+f.size,0),groupStats=exactStats(functions);
    const weighted=functions.reduce((s,f)=>s+(STATUS[f.status]?.score||0)*f.size,0)/Math.max(1,size);
    const status=Object.keys(STATUS)[Math.max(0,Math.min(4,Math.round(weighted)))];
    const confidence=functions.map(f=>f.unit_confidence).find(Boolean)||null;
    return{kind:'group',name,size,functions,status,exactFunctionPct:groupStats.functionPct,exactBytePct:groupStats.bytePct,unit_confidence:confidence};
  }).sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name));
}
function currentItems(){
  let fs=state.data.functions;
  if(state.drill){fs=fs.filter(f=>(f.compilation_unit||'UNASSIGNED')===state.drill);return fs.map(f=>({...f,kind:'function',name:f.symbol}))}
  if(state.view==='units')return aggregate(fs);
  return fs.map(f=>({...f,kind:'function',name:f.symbol}));
}
function splitBalanced(items){
  if(items.length<2)return[items,[]];
  const total=items.reduce((s,i)=>s+Math.max(1,i.size),0);let sum=0,best=1,delta=Infinity;
  for(let i=1;i<items.length;i++){sum+=Math.max(1,items[i-1].size);const d=Math.abs(total/2-sum);if(d<delta){delta=d;best=i}}
  return[items.slice(0,best),items.slice(best)];
}
function layoutTreemap(items,x,y,w,h,out){
  if(!items.length||w<=0||h<=0)return;if(items.length===1){out.push({item:items[0],x,y,w,h});return}
  const[a,b]=splitBalanced(items),sa=a.reduce((s,i)=>s+Math.max(1,i.size),0),sb=b.reduce((s,i)=>s+Math.max(1,i.size),0),ratio=sa/Math.max(1,sa+sb);
  if(w>=h){const wa=w*ratio;layoutTreemap(a,x,y,wa,h,out);layoutTreemap(b,x+wa,y,w-wa,h,out)}else{const ha=h*ratio;layoutTreemap(a,x,y,w,ha,out);layoutTreemap(b,x,y+ha,w,h-ha,out)}
}
function layoutMemory(items,w,h,out){
  const fs=[...items].sort((a,b)=>addressNumber(a)-addressNumber(b));
  const lanes=Math.max(4,Math.min(8,Math.round(h/90))),gutter=74,gap=5,laneH=(h-gap*(lanes-1))/lanes;
  const total=fs.reduce((s,f)=>s+Math.max(1,f.size),0),target=total/lanes;
  const laneSets=[];let lane=[],sum=0;
  for(const f of fs){if(lane.length&&sum+f.size>target&&laneSets.length<lanes-1){laneSets.push(lane);lane=[];sum=0}lane.push(f);sum+=f.size}laneSets.push(lane);
  while(laneSets.length<lanes)laneSets.push([]);
  state.memoryLanes=[];
  laneSets.forEach((set,index)=>{
    const y=index*(laneH+gap),laneBytes=set.reduce((s,f)=>s+Math.max(1,f.size),0)||1;let x=gutter;
    set.forEach((item,n)=>{const ww=n===set.length-1?Math.max(.5,w-x):Math.max(.5,(w-gutter)*(Math.max(1,item.size)/laneBytes));out.push({item,x,y,w:ww,h:laneH,lane:index});x+=ww});
    if(set.length)state.memoryLanes.push({y,h:laneH,start:set[0].address,end:set[set.length-1].address});
  });
}
function resizeCanvas(target,context,heightOverride){
  const box=target.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  const cssW=box.width,cssH=heightOverride??box.height,w=Math.max(1,Math.round(cssW*dpr)),h=Math.max(1,Math.round(cssH*dpr));
  if(target.width!==w||target.height!==h){target.width=w;target.height=h}context.setTransform(dpr,0,0,dpr,0,0);return{width:cssW,height:cssH};
}
function targetLayout(){
  const d=resizeCanvas(canvas,ctx),items=currentItems(),out=[];
  if(state.view==='memory'&&!state.drill)layoutMemory(items,d.width,d.height,out);else layoutTreemap(items,0,0,d.width,d.height,out);
  return out;
}
function bounds(rects){
  if(!rects.length)return null;const x1=Math.min(...rects.map(r=>r.x)),y1=Math.min(...rects.map(r=>r.y)),x2=Math.max(...rects.map(r=>r.x+r.w)),y2=Math.max(...rects.map(r=>r.y+r.h));return{x:x1,y:y1,w:x2-x1,h:y2-y1};
}
function originFor(item,oldRects,newRect){
  const key=itemKey(item),same=oldRects.find(r=>itemKey(r.item)===key);if(same)return same;
  if(item.kind==='group'){const keys=new Set(item.functions.map(f=>'fn:'+f.address)),members=oldRects.filter(r=>keys.has(itemKey(r.item))),b=bounds(members);if(b)return{item,x:b.x,y:b.y,w:b.w,h:b.h}}
  else{const groupName=item.compilation_unit||'UNASSIGNED',group=oldRects.find(r=>itemKey(r.item)==='group:'+groupName);if(group)return{item,x:group.x,y:group.y,w:group.w,h:group.h}}
  return{item,x:newRect.x+newRect.w/2,y:newRect.y+newRect.h/2,w:0,h:0};
}
function startLayoutTransition(){
  const old=state.displayRects.length?state.displayRects:state.rects,newRects=targetLayout();state.rects=newRects;
  if(reducedMotion||!old.length){state.displayRects=newRects;state.transition=null;draw(performance.now());return}
  const from=newRects.map(r=>originFor(r.item,old,r));state.transition={start:performance.now(),duration:340,from,to:newRects};schedule();
}
function ease(t){return 1-Math.pow(1-t,3)}
function lerp(a,b,t){return a+(b-a)*t}
function transitionRects(now){
  if(!state.transition)return state.rects;
  const t=Math.min(1,(now-state.transition.start)/state.transition.duration),e=ease(t);
  const result=state.transition.to.map((r,i)=>({item:r.item,x:lerp(state.transition.from[i].x,r.x,e),y:lerp(state.transition.from[i].y,r.y,e),w:lerp(state.transition.from[i].w,r.w,e),h:lerp(state.transition.from[i].h,r.h,e),lane:r.lane}));
  if(t>=1){state.transition=null;state.displayRects=state.rects;return state.rects}state.displayRects=result;return result;
}
function shade(hex,delta){const n=parseInt(hex.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+delta)),g=Math.max(0,Math.min(255,((n>>8)&255)+delta)),b=Math.max(0,Math.min(255,(n&255)+delta));return'#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('')}
function fillFor(rect){const base=STATUS[rect.item.status]?.color||STATUS.unknown.color,g=ctx.createLinearGradient(rect.x,rect.y,rect.x,rect.y+rect.h);g.addColorStop(0,shade(base,22));g.addColorStop(.48,base);g.addColorStop(1,shade(base,-30));return g}
function drawCornerBrackets(r,color){
  const{x,y,w,h}=r,l=Math.min(10,w/4,h/4);if(l<3)return;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();
  ctx.moveTo(x+2,y+l);ctx.lineTo(x+2,y+2);ctx.lineTo(x+l,y+2);ctx.moveTo(x+w-l,y+2);ctx.lineTo(x+w-2,y+2);ctx.lineTo(x+w-2,y+l);
  ctx.moveTo(x+2,y+h-l);ctx.lineTo(x+2,y+h-2);ctx.lineTo(x+l,y+h-2);ctx.moveTo(x+w-l,y+h-2);ctx.lineTo(x+w-2,y+h-2);ctx.lineTo(x+w-2,y+h-l);ctx.stroke();
}
function drawLabel(r){
  const{item,x,y,w,h}=r;
  if(item.kind!=='group'||w<48||h<25)return;
  ctx.save();
  ctx.beginPath();ctx.rect(x+3,y+3,Math.max(0,w-6),Math.max(0,h-6));ctx.clip();
  ctx.font='900 11px Arial, sans-serif';ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
  ctx.fillText(item.name,x+7,y+17,Math.max(0,w-14));
  if(h>=43&&w>=78){
    ctx.font='700 9px Arial, sans-serif';ctx.fillStyle='rgba(255,255,255,.80)';
    ctx.fillText(item.functions.length+' FUNCTIONS · '+item.exactFunctionPct.toFixed(1)+'% EXACT',x+7,y+32,Math.max(0,w-14));
  }
  ctx.restore();
}
function drawMemoryLaneLabels(){
  if(state.view!=='memory'||state.drill)return;ctx.save();ctx.font='800 9px Arial, sans-serif';ctx.textBaseline='middle';for(const lane of state.memoryLanes){ctx.fillStyle='#777e82';ctx.fillText(lane.start,7,lane.y+lane.h/2-5);ctx.fillStyle='#42474a';ctx.fillText(lane.end,7,lane.y+lane.h/2+7)}ctx.restore();
}
function draw(now){
  if(!state.data)return;resizeCanvas(canvas,ctx);const rects=transitionRects(now);ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);drawMemoryLaneLabels();
  const hasHover=!!state.hoveredKey,pulseAge=now-state.hoverStarted,pulse=pulseAge>=0&&pulseAge<320?1-pulseAge/320:0;
  for(const r of rects){const key=itemKey(r.item),hovered=key===state.hoveredKey,selected=key===state.selectedKey;ctx.save();if(hasHover&&!hovered&&!selected)ctx.globalAlpha=.30;else if(hasHover&&selected&&!hovered)ctx.globalAlpha=.82;
    if(hovered){ctx.shadowColor='#fff7a3';ctx.shadowBlur=17+12*pulse}else if(selected){ctx.shadowColor='#e43b2e';ctx.shadowBlur=10}
    const inset=hovered?2:1;ctx.fillStyle=fillFor(r);ctx.fillRect(r.x+inset,r.y+inset,Math.max(0,r.w-inset*2),Math.max(0,r.h-inset*2));
    ctx.lineWidth=hovered?3+2*pulse:selected?3:1;ctx.strokeStyle=hovered?'#fff7a3':selected?'#e43b2e':'rgba(0,0,0,.72)';ctx.strokeRect(r.x+1.5,r.y+1.5,Math.max(0,r.w-3),Math.max(0,r.h-3));
    if(hovered&&r.w>10&&r.h>10){ctx.strokeStyle='rgba(255,213,28,.95)';ctx.lineWidth=1;ctx.strokeRect(r.x+4.5,r.y+4.5,Math.max(0,r.w-9),Math.max(0,r.h-9))}if(selected)drawCornerBrackets(r,'#fff');ctx.restore();drawLabel(r)}
  drawRadar();back.hidden=!state.drill;path.textContent=state.drill?'FUN_WIN.EXE / CURRENT C UNITS / '+state.drill:'FUN_WIN.EXE / '+(state.view==='units'?'CURRENT C UNITS':state.view==='memory'?'MEMORY MAP':'ALL FUNCTIONS');mapTitle.textContent=state.view==='memory'?'ADDRESS MAP':'FUNCTION MAP';
  if(state.transition||pulse>0)schedule();
}
function schedule(){if(state.raf)return;state.raf=requestAnimationFrame(now=>{state.raf=0;draw(now)})}
function locate(e){const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;return(state.displayRects.length?state.displayRects:state.rects).find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null}
function sizeRank(i){return state.sizeRanks.get(i.address)||100}
function tooltipHtml(i,touchHint=false){
  if(i.kind==='group')return'<div class="tooltip-inner"><div class="tooltip-title">'+esc(i.name)+'</div><div class="tooltip-row"><span>FUNCTIONS</span><b>'+i.functions.length+'</b></div><div class="tooltip-row"><span>SIZE</span><b>'+fmtBytes(i.size)+'</b></div><div class="tooltip-row"><span>EXACT FUNCTIONS</span><b>'+fmtPct(i.exactFunctionPct)+'</b></div><div class="tooltip-row"><span>EXACT BYTES</span><b>'+fmtPct(i.exactBytePct)+'</b></div><div class="tooltip-row"><span>CONFIDENCE</span><b>'+esc(i.unit_confidence||'—')+'</b></div><div class="tooltip-meter"><i style="width:'+Math.max(0,Math.min(100,i.exactBytePct))+'%"></i></div>'+(touchHint?'<div class="tooltip-hint">TAP AGAIN TO OPEN</div>':'')+'</div>';
  const pct=statusPct(i),rank=sizeRank(i);return'<div class="tooltip-inner"><div class="tooltip-title">'+esc(i.symbol)+'</div><div class="tooltip-row"><span>ADDRESS</span><b>'+esc(i.address)+'</b></div><div class="tooltip-row"><span>SIZE</span><b>'+fmtBytes(i.size)+' · TOP '+rank.toFixed(rank<10?1:0)+'%</b></div><div class="tooltip-row"><span>STATUS</span><b>'+esc(STATUS[i.status]?.label||i.status)+'</b></div><div class="tooltip-row"><span>C RECONSTRUCTED</span><b>'+(cReconstructed(i)?'YES':'NO')+'</b></div><div class="tooltip-row"><span>INSTRUCTION MATCH</span><b>'+fmtPct(i.instruction_match_pct)+'</b></div><div class="tooltip-row"><span>LINKED MATCH</span><b>'+fmtPct(i.reccmp_match_pct)+'</b></div><div class="tooltip-meter"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div></div>';
}
function placeTooltip(e){const stage=canvas.parentElement.getBoundingClientRect(),box=tooltip.getBoundingClientRect();let left=e.clientX-stage.left+18,top=e.clientY-stage.top+18;if(left+box.width>stage.width-8)left=e.clientX-stage.left-box.width-18;if(top+box.height>stage.height-8)top=e.clientY-stage.top-box.height-18;tooltip.style.left=Math.max(8,left)+'px';tooltip.style.top=Math.max(8,top)+'px'}
function showTooltip(r,e,touchHint=false){if(!r){tooltip.hidden=true;hoverReadout.textContent='MOVE OVER A BLOCK';return}tooltip.innerHTML=tooltipHtml(r.item,touchHint);tooltip.hidden=false;placeTooltip(e);const i=r.item;hoverReadout.textContent=i.kind==='group'?i.name+' · '+i.functions.length+' FUNCTIONS':i.address+' · '+i.symbol}
function showDetail(i){
  state.selectedKey=itemKey(i);
  if(i.kind==='group'){detail.innerHTML='<div class="inspector-number">'+String(Math.min(99,i.functions.length)).padStart(2,'0')+'</div><div><h2>'+esc(i.name)+'</h2><p>'+i.functions.length+' functions · '+fmtBytes(i.size)+' · '+fmtPct(i.exactBytePct)+' of bytes exact.</p><div class="detail-grid"><div><span>EXACT FUNCTIONS</span><strong>'+fmtPct(i.exactFunctionPct)+'</strong></div><div><span>EXACT BYTES</span><strong>'+fmtPct(i.exactBytePct)+'</strong></div><div><span>CONFIDENCE</span><strong>'+esc(i.unit_confidence||'—')+'</strong></div><div><span>SIZE</span><strong>'+fmtBytes(i.size)+'</strong></div></div></div>';return}
  const pct=statusPct(i),rank=sizeRank(i);detail.innerHTML='<div class="inspector-number">'+Math.round(pct)+'</div><div><h2>'+esc(i.symbol)+'</h2><p>'+esc(i.address)+' · '+fmtBytes(i.size)+' · '+esc(STATUS[i.status]?.label||i.status)+'</p><div class="detail-grid"><div><span>CURRENT C UNIT</span><strong>'+esc(i.compilation_unit||'UNASSIGNED')+'</strong></div><div><span>CLASS</span><strong>'+esc(i.function_class||'—')+'</strong></div><div><span>C RECONSTRUCTED</span><strong>'+(cReconstructed(i)?'YES':'NO')+'</strong></div><div><span>SIZE RANK</span><strong>TOP '+rank.toFixed(rank<10?1:0)+'%</strong></div><div><span>INSTRUCTION MATCH</span><strong>'+fmtPct(i.instruction_match_pct)+'</strong></div><div><span>LINKED MATCH</span><strong>'+fmtPct(i.reccmp_match_pct)+'</strong></div><div><span>RAW MATCH</span><strong>'+fmtPct(i.raw_match_pct)+'</strong></div><div><span>STATUS</span><strong>'+esc(STATUS[i.status]?.label||i.status)+'</strong></div></div></div>';
}
function clearTouchFocus(){state.touchArmed=null;state.hoveredKey=null;tooltip.hidden=true;hoverReadout.textContent='MOVE OVER A BLOCK'}
function setHover(i){const key=i?itemKey(i):null;if(key!==state.hoveredKey){state.hoveredKey=key;state.hoverStarted=performance.now();schedule()}}

function drawRadar(){
  if(!state.data)return;
  const d=resizeCanvas(radar,rctx);
  rctx.clearRect(0,0,d.width,d.height);
  const fs=[...state.data.functions].sort((a,b)=>addressNumber(a)-addressNumber(b));
  const total=fs.reduce((s,f)=>s+Math.max(1,f.size),0)||1;
  let x=0;
  state.radarRects=[];
  for(const f of fs){
    const w=Math.max(.35,d.width*Math.max(1,f.size)/total);
    state.radarRects.push({item:f,x,w});
    rctx.fillStyle=STATUS[f.status]?.color||STATUS.unknown.color;
    rctx.fillRect(x,2,w,d.height-4);
    const fnKey='fn:'+f.address;
    const groupKey='group:'+(f.compilation_unit||'UNASSIGNED');
    const radarHot=fnKey===state.selectedKey||fnKey===state.hoveredKey||groupKey===state.hoveredKey;
    if(radarHot){
      rctx.fillStyle=fnKey===state.selectedKey?'#e43b2e':'#fff7a3';
      rctx.fillRect(Math.max(0,x-1),0,Math.max(2,w+2),d.height);
    }
    x+=w;
  }
}

function radarFunctionAt(e){
  const box=radar.getBoundingClientRect();
  const x=e.clientX-box.left;
  return state.radarRects.find(r=>x>=r.x&&x<=r.x+r.w)?.item||null;
}
function mapEntityForRadarFunction(fn){
  if(!fn)return null;
  if(state.view==='units'&&!state.drill){
    const groupName=fn.compilation_unit||'UNASSIGNED';
    return state.rects.find(r=>r.item.kind==='group'&&r.item.name===groupName)?.item||null;
  }
  return fn;
}
function setRadarHover(fn){
  const entity=mapEntityForRadarFunction(fn);
  setHover(entity);
  if(fn){
    hoverReadout.textContent=fn.address+' · '+fn.symbol;
  }else{
    hoverReadout.textContent='MOVE OVER A BLOCK';
  }
  schedule();
}
radar.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch')return;
  setRadarHover(radarFunctionAt(e));
});
radar.addEventListener('pointerleave',e=>{
  if(e.pointerType==='touch')return;
  setRadarHover(null);
});
radar.addEventListener('pointerup',e=>{
  if(e.pointerType!=='touch')return;
  const fn=radarFunctionAt(e);
  if(!fn)return;
  e.preventDefault();
  state.lastTouchAt=performance.now();
  showDetail(fn);
  setRadarHover(fn);
  schedule();
});
radar.addEventListener('click',e=>{
  if(performance.now()-state.lastTouchAt<700)return;
  const fn=radarFunctionAt(e);
  if(!fn)return;
  state.touchArmed=null;
  showDetail(fn);
  setRadarHover(fn);
  schedule();
});

canvas.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;const r=locate(e);setHover(r?.item||null);showTooltip(r,e)});
canvas.addEventListener('pointerleave',e=>{if(e.pointerType==='touch'||state.touchArmed)return;setHover(null);tooltip.hidden=true;hoverReadout.textContent='MOVE OVER A BLOCK'});
canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')return;const r=locate(e);if(!r)return;e.preventDefault();state.lastTouchAt=performance.now();const i=r.item,key=itemKey(i),secondTap=state.touchArmed===key;if(!secondTap){state.touchArmed=key;setHover(i);showDetail(i);schedule();showTooltip(r,e,i.kind==='group');return}showDetail(i);if(i.kind==='group'){state.drill=i.name;clearTouchFocus();state.selectedKey=null;startLayoutTransition()}else{setHover(i);schedule();showTooltip(r,e,false)}});
canvas.addEventListener('click',e=>{if(performance.now()-state.lastTouchAt<700)return;const r=locate(e);if(!r)return;const i=r.item;state.touchArmed=null;showDetail(i);if(i.kind==='group'){state.drill=i.name;setHover(null);tooltip.hidden=true;startLayoutTransition()}else schedule()});
document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||e.target===canvas)return;if(state.touchArmed){clearTouchFocus();schedule()}});
back.addEventListener('click',()=>{state.drill=null;state.selectedKey=null;clearTouchFocus();startLayoutTransition()});
buttons.forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.drill=null;state.selectedKey=null;clearTouchFocus();buttons.forEach(x=>x.classList.toggle('active',x===b));startLayoutTransition()}));
addEventListener('resize',()=>{state.transition=null;state.rects=targetLayout();state.displayRects=state.rects;schedule()});

fetch('data/progress.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(data=>{
  state.data=data;
  const sizes=[...data.functions].sort((a,b)=>b.size-a.size);sizes.forEach((f,index)=>state.sizeRanks.set(f.address,100*(index+1)/sizes.length));
  const first=data.functions[0],last=data.functions[data.functions.length-1];if(first&&last)radarRange.textContent=first.address+' → '+last.address;
  const c=data.summary.status_counts,total=Math.max(1,data.summary.functions),exact=c.binary_exact||0,exactFunctionPct=100*exact/total,exactBytes=data.summary.status_bytes?.binary_exact||data.functions.filter(f=>f.status==='binary_exact').reduce((s,f)=>s+f.size,0),bytePct=100*exactBytes/Math.max(1,data.summary.bytes),angle1=exactFunctionPct*2.7,angle2=bytePct*2.7;
  stats.innerHTML='<div class="gauge-card"><div class="gauge" data-target-angle="'+angle1+'" data-target-pct="'+exactFunctionPct+'" style="--angle:0deg;--needle:-135deg"><div class="gauge-readout">0.0%</div></div><div class="gauge-copy"><strong>'+exact+' / '+total+'</strong><span>BINARY EXACT</span><small>functions</small></div></div>'+
    '<div class="gauge-card"><div class="gauge" data-target-angle="'+angle2+'" data-target-pct="'+bytePct+'" style="--angle:0deg;--needle:-135deg"><div class="gauge-readout">0.0%</div></div><div class="gauge-copy"><strong>'+fmtBytes(exactBytes)+'</strong><span>EXACT CODE</span><small>of '+fmtBytes(data.summary.bytes)+'</small></div></div>'+
    '<div class="stat"><strong>'+fmtBytes(data.summary.bytes)+'</strong><span>TRACKED CODE</span><small>'+data.summary.functions.toLocaleString('en-US')+' functions</small></div>'+
    '<div class="stat"><strong>'+(c.codegen_exact||0)+'</strong><span>CODEGEN EXACT</span><small>not yet binary exact</small></div>'+
    '<div class="stat"><strong>'+(data.summary.explicit_compilation_units||0)+'</strong><span>CURRENT C UNITS</span><small>compiled source units</small></div>';
  const gaugeStart=performance.now();
  const gaugeDuration=reducedMotion?0:1150;
  const animateGauges=now=>{
    const t=gaugeDuration===0?1:Math.min(1,(now-gaugeStart)/gaugeDuration);
    const e=1-Math.pow(1-t,3);
    document.querySelectorAll('.gauge').forEach(g=>{
      const angle=Number(g.dataset.targetAngle)||0;
      const pct=Number(g.dataset.targetPct)||0;
      g.style.setProperty('--angle',(angle*e)+'deg');
      g.style.setProperty('--needle',(-135+angle*e)+'deg');
      const readout=g.querySelector('.gauge-readout');
      if(readout)readout.textContent=(pct*e).toFixed(1)+'%';
    });
    if(t<1)requestAnimationFrame(animateGauges);
  };
  requestAnimationFrame(animateGauges);
  state.rects=targetLayout();state.displayRects=state.rects;schedule();
}).catch(err=>{detail.innerHTML='<div class="inspector-number">!</div><div><h2>DATA ERROR</h2><p>'+esc(err.message)+'</p></div>'});
})();
