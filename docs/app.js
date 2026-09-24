(() => {
'use strict';
const STATUS={
  unknown:{label:'Unqualified',color:'#353b47',score:0},
  named:{label:'Named',color:'#b98620',score:1},
  source:{label:'C reconstructed',color:'#177fbd',score:2},
  codegen_exact:{label:'Codegen exact',color:'#0b9ca4',score:3},
  binary_exact:{label:'Binary exact',color:'#0aa86f',score:4}
};
const state={data:null,view:'functions',drill:null,filter:'',rects:[],hovered:null};
const canvas=document.querySelector('#treemap'),ctx=canvas.getContext('2d');
const tooltip=document.querySelector('#tooltip'),detail=document.querySelector('#detail');
const path=document.querySelector('#path'),empty=document.querySelector('#empty');
const back=document.querySelector('#back'),filter=document.querySelector('#filter'),stats=document.querySelector('#stats');
const buttons=[...document.querySelectorAll('[data-view]')];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes=v=>{const n=Number(v)||0;if(n>=1048576)return(n/1048576).toFixed(2)+' MB';if(n>=1024)return(n/1024).toFixed(1)+' kB';return n+' B'};
const fmtPct=v=>v==null?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
function parseSize(t){const m=t.match(/^(\d+(?:\.\d+)?)(kb|mb|b)?$/i);if(!m)return null;const n=Number(m[1]),u=(m[2]||'b').toLowerCase();return n*(u==='mb'?1048576:u==='kb'?1024:1)}
function match(fn,q){
  if(!q.trim())return true;
  const hay=[fn.symbol,fn.address,fn.function_class,fn.compilation_unit,fn.status].filter(Boolean).join(' ').toLowerCase();
  for(const raw of q.trim().split(/\s+/)){
    const t=raw.toLowerCase();
    if(t.startsWith('class:')){if((fn.function_class||'').toLowerCase()!==t.slice(6))return false}
    else if(t==='unit:none'){if(fn.compilation_unit)return false}
    else if(t.startsWith('status:')){const w=t.slice(7);if(w==='exact'){if(!fn.status.includes('exact'))return false}else if(!fn.status.includes(w))return false}
    else if(/^[<>].*%$/.test(t)){const op=t[0],lim=Number(t.slice(1,-1)),v=fn.instruction_match_pct??fn.reccmp_match_pct??fn.raw_match_pct;if(v==null||(op==='<'?!(v<lim):!(v>lim)))return false}
    else if(/^[<>]/.test(t)){const lim=parseSize(t.slice(1));if(lim==null||(t[0]==='<'?!(fn.size<lim):!(fn.size>lim)))return false}
    else if(!hay.includes(t))return false;
  } return true
}
function functions(){return state.data.functions.filter(f=>match(f,state.filter))}
function aggregate(items){
  const groups=new Map();
  for(const fn of items){const name=fn.compilation_unit||'Unassigned probable unit';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(fn)}
  return [...groups].map(([name,fs])=>{const size=fs.reduce((s,f)=>s+f.size,0);const weighted=fs.reduce((s,f)=>s+(STATUS[f.status]?.score||0)*f.size,0)/Math.max(1,size);const status=Object.keys(STATUS)[Math.max(0,Math.min(4,Math.round(weighted)))];return{kind:'group',name,size,functions:fs,status}}).sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name))
}
function items(){
  let fs=functions();
  if(state.drill){fs=fs.filter(f=>(f.compilation_unit||'Unassigned probable unit')===state.drill);return fs.map(f=>({...f,kind:'function',name:f.symbol}))}
  if(state.view==='units')return aggregate(fs);
  return fs.map(f=>({...f,kind:'function',name:f.symbol}))
}
function splitBalanced(arr){if(arr.length<2)return[arr,[]];const total=arr.reduce((s,i)=>s+Math.max(1,i.size),0);let sum=0,best=1,delta=Infinity;for(let i=1;i<arr.length;i++){sum+=Math.max(1,arr[i-1].size);const d=Math.abs(total/2-sum);if(d<delta){delta=d;best=i}}return[arr.slice(0,best),arr.slice(best)]}
function layout(arr,x,y,w,h,out){if(!arr.length||w<=0||h<=0)return;if(arr.length===1){out.push({item:arr[0],x,y,w,h});return}const[a,b]=splitBalanced(arr),sa=a.reduce((s,i)=>s+Math.max(1,i.size),0),sb=b.reduce((s,i)=>s+Math.max(1,i.size),0),r=sa/Math.max(1,sa+sb);if(w>=h){const wa=w*r;layout(a,x,y,wa,h,out);layout(b,x+wa,y,w-wa,h,out)}else{const ha=h*r;layout(a,x,y,w,ha,out);layout(b,x,y+ha,w,h-ha,out)}}
function resize(){const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(box.width*dpr)),h=Math.max(1,Math.round(box.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}ctx.setTransform(dpr,0,0,dpr,0,0);return{width:box.width,height:box.height}}
function label(r){const{item,x,y,w,h}=r;if(w<42||h<22)return;ctx.save();ctx.beginPath();ctx.rect(x+2,y+2,Math.max(0,w-4),Math.max(0,h-4));ctx.clip();ctx.fillStyle='#fff';ctx.font=(item.kind==='group'?600:500)+' 12px system-ui,sans-serif';ctx.fillText(item.name,x+7,y+18,Math.max(0,w-14));if(h>=42&&w>=70){ctx.fillStyle='rgba(255,255,255,.72)';ctx.font='10px system-ui,sans-serif';ctx.fillText(item.kind==='group'?item.functions.length+' functions · '+fmtBytes(item.size):item.address+' · '+fmtBytes(item.size),x+7,y+34,Math.max(0,w-14))}ctx.restore()}
function render(){if(!state.data)return;const d=resize(),arr=items();state.rects=[];layout(arr,0,0,d.width,d.height,state.rects);ctx.clearRect(0,0,d.width,d.height);for(const r of state.rects){const{item,x,y,w,h}=r;ctx.fillStyle=STATUS[item.status]?.color||STATUS.unknown.color;ctx.fillRect(x+1,y+1,Math.max(0,w-2),Math.max(0,h-2));ctx.strokeStyle=item===state.hovered?'#fff':'rgba(0,0,0,.32)';ctx.lineWidth=item===state.hovered?2:1;ctx.strokeRect(x+1.5,y+1.5,Math.max(0,w-3),Math.max(0,h-3));label(r)}empty.hidden=arr.length!==0;back.hidden=!state.drill;path.textContent=state.drill?'FUN_WIN.EXE › probable units › '+state.drill:'FUN_WIN.EXE › '+(state.view==='units'?'probable units':'all functions')}
function locate(e){const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;return state.rects.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null}
function tip(r,e){if(!r){tooltip.hidden=true;return}const i=r.item;tooltip.innerHTML=i.kind==='group'?'<strong>'+esc(i.name)+'</strong><br>'+i.functions.length+' functions · '+fmtBytes(i.size):'<strong>'+esc(i.symbol)+'</strong><br>'+esc(i.address)+' · '+fmtBytes(i.size)+'<br>'+esc(STATUS[i.status]?.label||i.status);const c=canvas.parentElement.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(e.clientX-c.left+12,c.width-280))+'px';tooltip.style.top=Math.max(8,Math.min(e.clientY-c.top+12,c.height-80))+'px';tooltip.hidden=false}
function show(i){if(i.kind==='group'){detail.innerHTML='<h2>'+esc(i.name)+'</h2><p>'+i.functions.length+' functions · '+fmtBytes(i.size)+'. Click the block to inspect its functions.</p>';return}detail.innerHTML='<h2>'+esc(i.symbol)+'</h2><p>'+esc(i.address)+' · '+fmtBytes(i.size)+' · '+esc(STATUS[i.status]?.label||i.status)+'</p><div class="detail-grid"><div><span>Probable original unit</span><strong>'+esc(i.compilation_unit||'Unassigned')+'</strong></div><div><span>Unit confidence</span><strong>'+esc(i.unit_confidence||'—')+'</strong></div><div><span>Function class</span><strong>'+esc(i.function_class||'—')+'</strong></div><div><span>Instruction match</span><strong>'+fmtPct(i.instruction_match_pct)+'</strong></div><div><span>Linked match</span><strong>'+fmtPct(i.reccmp_match_pct)+'</strong></div><div><span>Status</span><strong>'+esc(STATUS[i.status]?.label||i.status)+'</strong></div></div>'}
canvas.addEventListener('pointermove',e=>{const r=locate(e),i=r?.item||null;if(i!==state.hovered){state.hovered=i;render()}tip(r,e)});
canvas.addEventListener('pointerleave',()=>{state.hovered=null;tooltip.hidden=true;render()});
canvas.addEventListener('click',e=>{const r=locate(e);if(!r)return;const i=r.item;if(i.kind==='group'){state.drill=i.name;show(i);render()}else show(i)});
filter.addEventListener('input',()=>{state.filter=filter.value;render()});
back.addEventListener('click',()=>{state.drill=null;render()});
buttons.forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.drill=null;buttons.forEach(x=>x.classList.toggle('active',x===b));render()}));
addEventListener('resize',render);
fetch('data/progress.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(data=>{state.data=data;const c=data.summary.status_counts;stats.innerHTML='<div class="stat"><strong>'+data.summary.functions.toLocaleString('en-US')+'</strong><span>functions</span></div><div class="stat"><strong>'+fmtBytes(data.summary.bytes)+'</strong><span>tracked code</span></div><div class="stat"><strong>'+(c.binary_exact||0)+'</strong><span>binary exact</span></div><div class="stat"><strong>'+(c.codegen_exact||0)+'</strong><span>codegen exact</span></div><div class="stat"><strong>'+(data.summary.explicit_compilation_units||0)+'</strong><span>probable units</span></div>';render()}).catch(err=>{empty.hidden=false;empty.textContent='Unable to load progress data: '+err.message});
})();
