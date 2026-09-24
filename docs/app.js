(() => {
'use strict';

const STATUS={
  unknown:{label:'Unqualified',color:'#3a3a3c',score:0},
  named:{label:'Named',color:'#d7a81c',score:1},
  source:{label:'C reconstructed',color:'#1583bd',score:2},
  codegen_exact:{label:'Codegen exact',color:'#13a6b2',score:3},
  binary_exact:{label:'Binary exact',color:'#0ca770',score:4}
};
const state={data:null,view:'functions',drill:null,rects:[],hovered:null,selected:null};
const canvas=document.querySelector('#treemap');
const ctx=canvas.getContext('2d');
const tooltip=document.querySelector('#tooltip');
const detail=document.querySelector('#detail');
const path=document.querySelector('#path');
const back=document.querySelector('#back');
const stats=document.querySelector('#stats');
const hoverReadout=document.querySelector('#hover-readout');
const buttons=[...document.querySelectorAll('[data-view]')];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes=v=>{const n=Number(v)||0;if(n>=1048576)return(n/1048576).toFixed(2)+' MB';if(n>=1024)return(n/1024).toFixed(1)+' kB';return n+' B'};
const fmtPct=v=>v==null?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
const statusPct=i=>i.status==='binary_exact'?100:(i.instruction_match_pct??i.reccmp_match_pct??i.raw_match_pct??0);

function aggregate(items){
  const groups=new Map();
  for(const fn of items){
    const name=fn.compilation_unit||'UNASSIGNED';
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(fn);
  }
  return [...groups].map(([name,functions])=>{
    const size=functions.reduce((s,f)=>s+f.size,0);
    const weighted=functions.reduce((s,f)=>s+(STATUS[f.status]?.score||0)*f.size,0)/Math.max(1,size);
    const status=Object.keys(STATUS)[Math.max(0,Math.min(4,Math.round(weighted)))];
    return{kind:'group',name,size,functions,status};
  }).sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name));
}
function currentItems(){
  let fs=state.data.functions;
  if(state.drill){
    fs=fs.filter(f=>(f.compilation_unit||'UNASSIGNED')===state.drill);
    return fs.map(f=>({...f,kind:'function',name:f.symbol}));
  }
  if(state.view==='units')return aggregate(fs);
  return fs.map(f=>({...f,kind:'function',name:f.symbol}));
}
function splitBalanced(items){
  if(items.length<2)return[items,[]];
  const total=items.reduce((s,i)=>s+Math.max(1,i.size),0);
  let sum=0,best=1,delta=Infinity;
  for(let i=1;i<items.length;i++){
    sum+=Math.max(1,items[i-1].size);
    const d=Math.abs(total/2-sum);
    if(d<delta){delta=d;best=i}
  }
  return[items.slice(0,best),items.slice(best)];
}
function layout(items,x,y,w,h,out){
  if(!items.length||w<=0||h<=0)return;
  if(items.length===1){out.push({item:items[0],x,y,w,h});return}
  const[a,b]=splitBalanced(items);
  const sa=a.reduce((s,i)=>s+Math.max(1,i.size),0);
  const sb=b.reduce((s,i)=>s+Math.max(1,i.size),0);
  const ratio=sa/Math.max(1,sa+sb);
  if(w>=h){
    const wa=w*ratio;
    layout(a,x,y,wa,h,out);layout(b,x+wa,y,w-wa,h,out);
  }else{
    const ha=h*ratio;
    layout(a,x,y,w,ha,out);layout(b,x,y+ha,w,h-ha,out);
  }
}
function resize(){
  const box=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,Math.round(box.width*dpr));
  const height=Math.max(1,Math.round(box.height*dpr));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return{width:box.width,height:box.height};
}
function fillFor(rect){
  const base=STATUS[rect.item.status]?.color||STATUS.unknown.color;
  const g=ctx.createLinearGradient(rect.x,rect.y,rect.x,rect.y+rect.h);
  g.addColorStop(0,shade(base,22));
  g.addColorStop(.48,base);
  g.addColorStop(1,shade(base,-30));
  return g;
}
function shade(hex,delta){
  const n=parseInt(hex.slice(1),16);
  const r=Math.max(0,Math.min(255,(n>>16)+delta));
  const g=Math.max(0,Math.min(255,((n>>8)&255)+delta));
  const b=Math.max(0,Math.min(255,(n&255)+delta));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function drawLabel(r){
  const{item,x,y,w,h}=r;
  if(w<48||h<25)return;
  ctx.save();
  ctx.beginPath();ctx.rect(x+3,y+3,Math.max(0,w-6),Math.max(0,h-6));ctx.clip();
  ctx.font='900 11px Arial, sans-serif';
  ctx.fillStyle='#fff';
  ctx.shadowColor='#000';ctx.shadowBlur=0;ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
  ctx.fillText(item.name,x+7,y+17,Math.max(0,w-14));
  if(h>=43&&w>=78){
    ctx.font='700 9px Arial, sans-serif';
    ctx.fillStyle='rgba(255,255,255,.78)';
    const sub=item.kind==='group'?item.functions.length+' FUNCTIONS · '+fmtBytes(item.size):item.address+' · '+fmtBytes(item.size);
    ctx.fillText(sub,x+7,y+32,Math.max(0,w-14));
  }
  ctx.restore();
}
function render(){
  if(!state.data)return;
  const d=resize(),items=currentItems();
  state.rects=[];
  layout(items,0,0,d.width,d.height,state.rects);
  ctx.clearRect(0,0,d.width,d.height);

  const hasHover=!!state.hovered;
  for(const r of state.rects){
    const{item,x,y,w,h}=r;
    const hovered=item===state.hovered;
    const selected=item===state.selected;
    ctx.save();

    if(hasHover&&!hovered)ctx.globalAlpha=.34;
    if(hovered){
      ctx.shadowColor='#fff7a3';
      ctx.shadowBlur=18;
    }else if(selected){
      ctx.shadowColor='#ffffff';
      ctx.shadowBlur=8;
    }

    const inset=hovered?2:1;
    ctx.fillStyle=fillFor(r);
    ctx.fillRect(x+inset,y+inset,Math.max(0,w-inset*2),Math.max(0,h-inset*2));

    ctx.lineWidth=hovered?3:selected?2:1;
    ctx.strokeStyle=hovered?'#fff7a3':selected?'#ffffff':'rgba(0,0,0,.70)';
    ctx.strokeRect(x+1.5,y+1.5,Math.max(0,w-3),Math.max(0,h-3));

    if(hovered&&w>10&&h>10){
      ctx.strokeStyle='rgba(255,213,28,.92)';
      ctx.lineWidth=1;
      ctx.strokeRect(x+4.5,y+4.5,Math.max(0,w-9),Math.max(0,h-9));
    }
    ctx.restore();
    drawLabel(r);
  }
  back.hidden=!state.drill;
  path.textContent=state.drill
    ?'FUN_WIN.EXE / PROBABLE UNITS / '+state.drill
    :'FUN_WIN.EXE / '+(state.view==='units'?'PROBABLE UNITS':'ALL FUNCTIONS');
}
function locate(e){
  const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;
  return state.rects.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null;
}
function tooltipHtml(i){
  if(i.kind==='group'){
    const avg=i.functions.length?i.functions.reduce((s,f)=>s+statusPct(f),0)/i.functions.length:0;
    return '<div class="tooltip-inner"><div class="tooltip-title">'+esc(i.name)+'</div>'+
      '<div class="tooltip-row"><span>FUNCTIONS</span><b>'+i.functions.length+'</b></div>'+
      '<div class="tooltip-row"><span>SIZE</span><b>'+fmtBytes(i.size)+'</b></div>'+
      '<div class="tooltip-row"><span>AVG MATCH</span><b>'+fmtPct(avg)+'</b></div>'+
      '<div class="tooltip-meter"><i style="width:'+Math.max(0,Math.min(100,avg))+'%"></i></div></div>';
  }
  const pct=statusPct(i);
  return '<div class="tooltip-inner"><div class="tooltip-title">'+esc(i.symbol)+'</div>'+
    '<div class="tooltip-row"><span>ADDRESS</span><b>'+esc(i.address)+'</b></div>'+
    '<div class="tooltip-row"><span>SIZE</span><b>'+fmtBytes(i.size)+'</b></div>'+
    '<div class="tooltip-row"><span>STATUS</span><b>'+esc(STATUS[i.status]?.label||i.status)+'</b></div>'+
    '<div class="tooltip-row"><span>INSTRUCTION MATCH</span><b>'+fmtPct(i.instruction_match_pct)+'</b></div>'+
    '<div class="tooltip-row"><span>LINKED MATCH</span><b>'+fmtPct(i.reccmp_match_pct)+'</b></div>'+
    '<div class="tooltip-meter"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div></div>';
}
function placeTooltip(e){
  const stage=canvas.parentElement.getBoundingClientRect();
  const box=tooltip.getBoundingClientRect();
  let left=e.clientX-stage.left+18;
  let top=e.clientY-stage.top+18;
  if(left+box.width>stage.width-8)left=e.clientX-stage.left-box.width-18;
  if(top+box.height>stage.height-8)top=e.clientY-stage.top-box.height-18;
  tooltip.style.left=Math.max(8,left)+'px';
  tooltip.style.top=Math.max(8,top)+'px';
}
function showTooltip(r,e){
  if(!r){tooltip.hidden=true;hoverReadout.textContent='MOVE OVER A BLOCK';return}
  tooltip.innerHTML=tooltipHtml(r.item);
  tooltip.hidden=false;
  placeTooltip(e);
  const i=r.item;
  hoverReadout.textContent=i.kind==='group'
    ?i.name+' · '+i.functions.length+' FUNCTIONS'
    :i.address+' · '+i.symbol;
}
function showDetail(i){
  state.selected=i;
  if(i.kind==='group'){
    detail.innerHTML='<div class="inspector-number">'+String(Math.min(99,i.functions.length)).padStart(2,'0')+'</div><div><h2>'+esc(i.name)+'</h2><p>'+i.functions.length+' functions · '+fmtBytes(i.size)+' · click the block to enter.</p></div>';
    return;
  }
  const pct=statusPct(i);
  detail.innerHTML='<div class="inspector-number">'+Math.round(pct)+'</div><div><h2>'+esc(i.symbol)+'</h2><p>'+esc(i.address)+' · '+fmtBytes(i.size)+' · '+esc(STATUS[i.status]?.label||i.status)+'</p><div class="detail-grid">'+
    '<div><span>PROBABLE UNIT</span><strong>'+esc(i.compilation_unit||'UNASSIGNED')+'</strong></div>'+
    '<div><span>CLASS</span><strong>'+esc(i.function_class||'—')+'</strong></div>'+
    '<div><span>INSTRUCTION MATCH</span><strong>'+fmtPct(i.instruction_match_pct)+'</strong></div>'+
    '<div><span>LINKED MATCH</span><strong>'+fmtPct(i.reccmp_match_pct)+'</strong></div>'+
    '<div><span>RAW MATCH</span><strong>'+fmtPct(i.raw_match_pct)+'</strong></div>'+
    '<div><span>STATUS</span><strong>'+esc(STATUS[i.status]?.label||i.status)+'</strong></div>'+
    '</div></div>';
}
canvas.addEventListener('pointermove',e=>{
  const r=locate(e),i=r?.item||null;
  if(i!==state.hovered){state.hovered=i;render()}
  showTooltip(r,e);
});
canvas.addEventListener('pointerleave',()=>{
  state.hovered=null;tooltip.hidden=true;hoverReadout.textContent='MOVE OVER A BLOCK';render();
});
canvas.addEventListener('click',e=>{
  const r=locate(e);if(!r)return;
  const i=r.item;
  showDetail(i);
  if(i.kind==='group'){state.drill=i.name;state.hovered=null;tooltip.hidden=true;render()}
  else render();
});
back.addEventListener('click',()=>{state.drill=null;state.selected=null;render()});
buttons.forEach(b=>b.addEventListener('click',()=>{
  state.view=b.dataset.view;state.drill=null;state.selected=null;state.hovered=null;tooltip.hidden=true;
  buttons.forEach(x=>x.classList.toggle('active',x===b));render();
}));
addEventListener('resize',render);

fetch('data/progress.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(data=>{
  state.data=data;
  const c=data.summary.status_counts;
  const total=Math.max(1,data.summary.functions);
  const exact=c.binary_exact||0;
  const exactPct=100*exact/total;
  stats.innerHTML=
    '<div class="stat"><strong>'+data.summary.functions.toLocaleString('en-US')+'</strong><span>FUNCTIONS</span></div>'+
    '<div class="stat"><strong>'+fmtBytes(data.summary.bytes)+'</strong><span>TRACKED CODE</span></div>'+
    '<div class="stat"><strong>'+exact+'</strong><span>BINARY EXACT</span></div>'+
    '<div class="stat"><strong>'+exactPct.toFixed(1)+'%</strong><span>EXACT FUNCTIONS</span></div>'+
    '<div class="stat"><strong>'+(data.summary.explicit_compilation_units||0)+'</strong><span>PROBABLE UNITS</span></div>';
  render();
}).catch(err=>{
  detail.innerHTML='<div class="inspector-number">!</div><div><h2>DATA ERROR</h2><p>'+esc(err.message)+'</p></div>';
});
})();
