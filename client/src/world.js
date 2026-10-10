// The flight backdrop for the Flying Circus: one biome per show (a season moves from a dawn meadow to a night finale),
// parallax silhouettes, props along the ground (cows, windmills, trees...), the launch site with grandstand and crowd,
// wooden distance signposts, thermals and storm weather. Draws only; the physics live in sim.js.
import { clamp, hs, thermalSeg } from './sim.js';

const INK='#22283a', PAPER='#f3e7ce', RED='#d2402f', BRASS='#e9a93b', WOOD='#b7793f', WOOD2='#8a5428', CANVAS='#fbf5e8';

// sky top/bottom, sun (x,y as screen fractions, color; moon at night), far and near silhouette colors and shapes,
// ground, and which props grow there (weights)
const BIOMES=[
  {name:'meadow',sky:['#f6c597','#fde8c8'],sun:[.24,.33,'#fff1c9'],far:['#b5c98a','hills'],near:['#93b866','hills'],ground:'#86b25c',ground2:'#6f9a4b',
    props:{hay:3,cow:3,tree:2,windmill:1,fence:3,barn:1}},
  {name:'river',sky:['#8fcbe9','#dff1f7'],sun:[.8,.33,'#fff6d8'],far:['#9cc184','hills'],near:['#7aa95e','hills'],ground:'#78a957',ground2:'#5e8f43',
    props:{tree:4,cow:2,barn:2,fence:2,hay:1}},
  {name:'coast',sky:['#86c3db','#e6f3f2'],sun:[.72,.34,'#fff6d8'],far:['#3b9aa6','sea'],near:['#d9c48f','dunes'],ground:'#a8c26a',ground2:'#87a352',
    props:{grass:4,hut:2,lighthouse:1,fence:1}},
  {name:'canyon',sky:['#4fa6dc','#c6e6f4'],sun:[.5,.31,'#fffbe6'],far:['#d39a5c','mesa'],near:['#b8743f','mesa'],ground:'#d4a064',ground2:'#b9834b',
    props:{cactus:4,rock:3,skull:1}},
  {name:'orchard',sky:['#73b3dd','#f3dfb2'],sun:[.3,.34,'#ffe9b8'],far:['#a9bf62','hills'],near:['#8eae4f','hills'],ground:'#8fb04f',ground2:'#739236',
    props:{apple:5,barn:1,hay:2,fence:2}},
  {name:'mountains',sky:['#7aa4c9','#e1e9f0'],sun:[.75,.33,'#fff8e6'],far:['#8a9bb0','peaks'],near:['#6f8a6a','hills'],ground:'#7c9a63',ground2:'#62804c',
    props:{pine:6,rock:2,cabin:1}},
  {name:'city',sky:['#df774e','#f7c77c'],sun:[.82,.42,'#ffd9a0'],far:['#8a5f73','city'],near:['#4f5a73','city'],ground:'#6f8456',ground2:'#56693f',
    props:{lamp:3,billboard:1,tree:2,house:2}},
  {name:'night',sky:['#0c1a2c','#2a3a62'],sun:[.8,.31,'#f3ecd2',true],far:['#26365a','city'],near:['#1b2740','city'],ground:'#2a3d3a',ground2:'#1f2f2c',
    props:{lamp:4,house:2,tree:1,billboard:1}},
];
const biomeOf=stage=>BIOMES[Math.min(stage,BIOMES.length-1)];

const lerp=(a,b,t)=>a+(b-a)*t;
function mix(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')}

// a dot pattern laid over the whole scene for the printed-poster feel
let halftone=null;
function halftonePattern(ctx){
  if(halftone)return halftone;
  const c=document.createElement('canvas');c.width=c.height=6;const g=c.getContext('2d');
  g.fillStyle='rgba(34,40,58,.07)';g.beginPath();g.arc(3,3,1.1,0,7);g.fill();
  halftone=ctx.createPattern(c,'repeat');return halftone;
}

/* ---------- silhouettes (screen space, parallax) ---------- */
function silhouette(ctx,v,shape,color,base,height,par,seed){
  const {vw}=v, gy=v.Y(0), off=v.camX*v.sc*par;
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(-10,gy+2);
  const H=height;
  if(shape==='hills'||shape==='dunes'){
    for(let x=-10;x<=vw+20;x+=16){const u=(x+off)*(shape==='dunes'?.02:.008);ctx.lineTo(x,gy-base-Math.sin(u+seed)*H*.5-Math.sin(u*2.3+seed*2)*H*.25)}
  }else if(shape==='mesa'){
    // flat-topped buttes: blocky steps
    for(let x=-10;x<=vw+30;x+=8){const k=Math.floor((x+off)/90),h=hs(k*3.7+seed);const top=h>.45?H*(.6+h*.5):H*.15;ctx.lineTo(x,gy-base-top)}
  }else if(shape==='peaks'){
    for(let x=-10;x<=vw+40;x+=10){const u=(x+off)/70,k=Math.floor(u),f=u-k,h1=hs(k*1.9+seed),h2=hs((k+1)*1.9+seed);
      const tri=1-Math.abs(f-.5)*2;ctx.lineTo(x,gy-base-H*(.3+.7*lerp(h1,h2,f))*(.55+.45*tri))}
  }else if(shape==='city'){
    for(let x=-10;x<=vw+40;x+=6){const k=Math.floor((x+off)/26),h=hs(k*5.1+seed);ctx.lineTo(x,gy-base-H*(.25+h*.95)*(h>.92?1.35:1))}
  }else if(shape==='sea'){
    ctx.lineTo(-10,gy-base-H*.35);for(let x=-10;x<=vw+20;x+=12)ctx.lineTo(x,gy-base-H*.35+Math.sin((x+off)*.05+v.now/600)*2)
  }
  ctx.lineTo(vw+20,gy+2);ctx.closePath();ctx.fill();
  if(shape==='sea'){ // whitecaps
    ctx.strokeStyle='rgba(251,245,232,.6)';ctx.lineWidth=2;ctx.beginPath();
    for(let i=0;i<14;i++){const x=((hs(i*3.3)*vw*1.4-off*.6)%(vw+60)+vw+60)%(vw+60)-30,y=gy-base-H*.3+hs(i*7.1)*H*.25;ctx.moveTo(x,y);ctx.lineTo(x+8,y-2);ctx.lineTo(x+16,y)}
    ctx.stroke();
  }
}

/* ---------- props (world space, meters; y up from the ground) ---------- */
// each prop is drawn in local meters with y down and the ground at y=0; lw keeps the ink line constant on screen
function cow(g,lw,t,k){
  g.fillStyle=CANVAS;g.strokeStyle=INK;g.lineWidth=lw;
  for(const lx of [-.7,-.45,.45,.7]){g.beginPath();g.moveTo(lx,-.55);g.lineTo(lx,0);g.stroke()}
  g.beginPath();g.ellipse(0,-.85,1,.45,0,0,7);g.fill();g.stroke();
  g.fillStyle=INK;g.beginPath();g.ellipse(-.3,-.95,.25,.18,.4,0,7);g.fill();g.beginPath();g.ellipse(.35,-.75,.2,.13,-.3,0,7);g.fill();
  const nod=Math.sin(t*1.3+k)*.06;g.fillStyle=CANVAS;g.beginPath();g.ellipse(1.05,-1+nod,.35,.28,.3,0,7);g.fill();g.stroke();
  g.fillStyle='#e8a0a0';g.beginPath();g.ellipse(1.28,-.9+nod,.14,.11,0,0,7);g.fill();
}
function hay(g,lw){g.fillStyle='#e3c065';g.strokeStyle=INK;g.lineWidth=lw;g.beginPath();g.arc(0,-.7,.7,0,7);g.fill();g.stroke();
  g.strokeStyle='rgba(34,40,58,.45)';g.beginPath();g.arc(0,-.7,.42,0,5.2);g.moveTo(.18,-.7);g.arc(0,-.7,.18,0,4.5);g.stroke()}
function tree(g,lw,k,c1,c2){const h=4+hs(k)*3;g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=WOOD2;g.fillRect(-.25,-h*.45,.5,h*.45);g.strokeRect(-.25,-h*.45,.5,h*.45);
  g.fillStyle=c1||'#5e9a4a';g.beginPath();g.arc(0,-h*.62,h*.3,0,7);g.arc(-h*.2,-h*.5,h*.22,0,7);g.arc(h*.2,-h*.52,h*.22,0,7);g.fill();
  g.beginPath();g.arc(0,-h*.62,h*.3,Math.PI*1.05,Math.PI*1.95);g.stroke();
  if(c2){g.fillStyle=c2;for(let i=0;i<5;i++){g.beginPath();g.arc(Math.sin(k*9+i*2.1)*h*.25,-h*.55-Math.cos(k*5+i*1.7)*h*.18,.18,0,7);g.fill()}}}
function pine(g,lw,k){const h=6+hs(k)*5;g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=WOOD2;g.fillRect(-.2,-h*.2,.4,h*.2);
  g.fillStyle='#3f6e4a';for(let i=0;i<3;i++){const y0=-h*(.2+i*.25),w=h*(.28-i*.06);g.beginPath();g.moveTo(-w,y0);g.lineTo(0,y0-h*.38);g.lineTo(w,y0);g.closePath();g.fill();g.stroke()}}
function windmill(g,lw,t,k){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=WOOD;g.beginPath();g.moveTo(-1.6,0);g.lineTo(-.7,-9);g.lineTo(.7,-9);g.lineTo(1.6,0);g.closePath();g.fill();g.stroke();
  g.fillStyle=RED;g.beginPath();g.moveTo(-1.1,-9);g.lineTo(0,-10.6);g.lineTo(1.1,-9);g.closePath();g.fill();g.stroke();
  g.save();g.translate(0,-9.6);g.rotate(t*.8+k);g.fillStyle=CANVAS;for(let i=0;i<4;i++){g.rotate(Math.PI/2);g.fillRect(.3,-.45,4.4,.9);g.strokeRect(.3,-.45,4.4,.9)}
  g.fillStyle=BRASS;g.beginPath();g.arc(0,0,.45,0,7);g.fill();g.stroke();g.restore()}
function fence(g,lw){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=CANVAS;for(const x of [-2,0,2]){g.fillRect(x-.15,-1.3,.3,1.3);g.strokeRect(x-.15,-1.3,.3,1.3)}
  g.fillRect(-2.2,-1.1,4.4,.22);g.strokeRect(-2.2,-1.1,4.4,.22);g.fillRect(-2.2,-.6,4.4,.22);g.strokeRect(-2.2,-.6,4.4,.22)}
function barn(g,lw){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=RED;g.beginPath();g.moveTo(-4,0);g.lineTo(-4,-4.5);g.lineTo(-2.4,-6.6);g.lineTo(2.4,-6.6);g.lineTo(4,-4.5);g.lineTo(4,0);g.closePath();g.fill();g.stroke();
  g.strokeStyle=CANVAS;g.lineWidth=lw*1.4;g.strokeRect(-1.4,-3.4,2.8,3.4);g.beginPath();g.moveTo(-1.4,-3.4);g.lineTo(1.4,0);g.moveTo(1.4,-3.4);g.lineTo(-1.4,0);g.stroke();
  g.strokeStyle=INK;g.lineWidth=lw;g.strokeRect(-1.4,-3.4,2.8,3.4)}
function house(g,lw,k,night){const w=3+hs(k)*2,h=3+hs(k*2)*2;const cols=['#e6d4ae','#c9d6d9','#e8b9a0','#d6c58f'];g.strokeStyle=INK;g.lineWidth=lw;
  g.fillStyle=night?'#3a4a6a':cols[Math.floor(hs(k*3)*4)];g.fillRect(-w/2,-h,w,h);g.strokeRect(-w/2,-h,w,h);
  g.fillStyle=night?'#22304d':RED;g.beginPath();g.moveTo(-w/2-.4,-h);g.lineTo(0,-h-w*.45);g.lineTo(w/2+.4,-h);g.closePath();g.fill();g.stroke();
  g.fillStyle=night?'#ffd77a':'#8fcbe9';g.fillRect(-.5,-h*.7,1,1);g.strokeRect(-.5,-h*.7,1,1)}
function cactus(g,lw,k){const h=3+hs(k)*2.5;g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle='#5f9a54';const r=.45;
  const cap=(x,y0,y1)=>{g.beginPath();g.moveTo(x-r,y0);g.lineTo(x-r,y1+r);g.arc(x,y1+r,r,Math.PI,0);g.lineTo(x+r,y0);g.closePath();g.fill();g.stroke()};
  cap(0,0,-h);cap(-1.1,-h*.45,-h*.75);cap(1.1,-h*.35,-h*.62);g.fillRect(-1.1,-h*.5,1,.5);g.fillRect(.2,-h*.4,1,.5)}
function rock(g,lw,k){const s=.8+hs(k)*1.2;g.fillStyle='#a08a72';g.strokeStyle=INK;g.lineWidth=lw;g.beginPath();g.moveTo(-1.2*s,0);g.lineTo(-.9*s,-.9*s);g.lineTo(.1*s,-1.2*s);g.lineTo(1*s,-.6*s);g.lineTo(1.3*s,0);g.closePath();g.fill();g.stroke()}
function skull(g,lw){g.fillStyle=CANVAS;g.strokeStyle=INK;g.lineWidth=lw;g.beginPath();g.ellipse(0,-.45,.6,.4,0,0,7);g.fill();g.stroke();
  g.beginPath();g.moveTo(-.5,-.75);g.quadraticCurveTo(-1.3,-1.4,-1.5,-.9);g.moveTo(.5,-.75);g.quadraticCurveTo(1.3,-1.4,1.5,-.9);g.stroke()}
function grass(g,lw,k){g.strokeStyle='#5e8f43';g.lineWidth=lw*1.2;g.beginPath();for(let i=0;i<5;i++){const x=(i-2)*.25;g.moveTo(x,0);g.quadraticCurveTo(x+.2,-.6,x+(hs(k+i)-.5)*.8,-1.2-hs(k*i)*.6)}g.stroke()}
function hut(g,lw,k){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=hs(k)>.5?'#3b9aa6':'#e9a93b';g.fillRect(-1.2,-2.4,2.4,2.4);g.strokeRect(-1.2,-2.4,2.4,2.4);
  g.fillStyle=CANVAS;g.beginPath();g.moveTo(-1.6,-2.4);g.lineTo(0,-3.6);g.lineTo(1.6,-2.4);g.closePath();g.fill();g.stroke()}
function lighthouse(g,lw,t){g.strokeStyle=INK;g.lineWidth=lw;for(let i=0;i<5;i++){g.fillStyle=i%2?RED:CANVAS;const y0=-i*3.2,w0=2-i*.22,w1=2-(i+1)*.22;
  g.beginPath();g.moveTo(-w0,y0);g.lineTo(-w1,y0-3.2);g.lineTo(w1,y0-3.2);g.lineTo(w0,y0);g.closePath();g.fill();g.stroke()}
  g.fillStyle='#ffe08a';g.fillRect(-1,-18.4,2,2.4);g.strokeRect(-1,-18.4,2,2.4);g.fillStyle=RED;g.beginPath();g.moveTo(-1.4,-18.4);g.lineTo(0,-20);g.lineTo(1.4,-18.4);g.closePath();g.fill();g.stroke();
  const a=.25+.2*Math.sin(t*2);g.fillStyle=`rgba(255,224,138,${a})`;g.beginPath();g.moveTo(0,-17.2);g.lineTo(14,-19.5);g.lineTo(14,-15);g.closePath();g.fill()}
function lamp(g,lw,night){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle='#3b4152';g.fillRect(-.12,-4.2,.24,4.2);g.strokeRect(-.12,-4.2,.24,4.2);
  g.fillStyle=night?'#ffe08a':'#e6d4ae';g.beginPath();g.arc(0,-4.4,.4,0,7);g.fill();g.stroke();
  if(night){g.fillStyle='rgba(255,224,138,.18)';g.beginPath();g.moveTo(0,-4.4);g.lineTo(-1.8,0);g.lineTo(1.8,0);g.closePath();g.fill()}}
function billboard(g,lw,k){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=WOOD2;g.fillRect(-1.8,-3,.3,3);g.fillRect(1.5,-3,.3,3);
  g.fillStyle=PAPER;g.fillRect(-2.6,-5.6,5.2,2.8);g.strokeRect(-2.6,-5.6,5.2,2.8);g.fillStyle=k%2?RED:'#3b9aa6';g.fillRect(-2.2,-5.2,4.4,.7);g.fillStyle=BRASS;g.beginPath();g.arc(1.5,-3.8,.5,0,7);g.fill()}
function cabin(g,lw){g.strokeStyle=INK;g.lineWidth=lw;g.fillStyle=WOOD;g.fillRect(-2.2,-2.6,4.4,2.6);g.strokeRect(-2.2,-2.6,4.4,2.6);
  g.strokeStyle=WOOD2;for(let i=1;i<4;i++){g.beginPath();g.moveTo(-2.2,-i*.65);g.lineTo(2.2,-i*.65);g.stroke()}
  g.strokeStyle=INK;g.fillStyle='#5a3a24';g.beginPath();g.moveTo(-2.7,-2.6);g.lineTo(0,-4.4);g.lineTo(2.7,-2.6);g.closePath();g.fill();g.stroke()}
const PROP_SIZE={cow:2.6,hay:1.5,tree:7,apple:6,pine:11,windmill:15,fence:4.4,barn:8,house:6,cactus:5,rock:2,skull:3,grass:1.5,hut:3.6,lighthouse:20,lamp:4.8,billboard:5.6,cabin:5};

function drawProp(g,type,lw,t,k,night){
  switch(type){
    case 'cow':return cow(g,lw,t,k);case 'hay':return hay(g,lw);case 'tree':return tree(g,lw,k,night?'#2c4a3a':null);
    case 'apple':return tree(g,lw,k,'#6c9d3e','#d2402f');case 'pine':return pine(g,lw,k);case 'windmill':return windmill(g,lw,t,k);
    case 'fence':return fence(g,lw);case 'barn':return barn(g,lw);case 'house':return house(g,lw,k,night);case 'cactus':return cactus(g,lw,k);
    case 'rock':return rock(g,lw,k);case 'skull':return skull(g,lw);case 'grass':return grass(g,lw,k);case 'hut':return hut(g,lw,k);
    case 'lighthouse':return lighthouse(g,lw,t);case 'lamp':return lamp(g,lw,night);case 'billboard':return billboard(g,lw,k);case 'cabin':return cabin(g,lw);
  }
}
function pickProp(props,h){let s=0;for(const k in props)s+=props[k];let r=h*s;for(const k in props){r-=props[k];if(r<=0)return k}return null}

/* ---------- the launch site: grassy plateau, grandstand with crowd, bunting, wooden ramp ---------- */
function launchSite(ctx,v,b){
  const {X,Y,sc,now}=v, lw=Math.max(1,2.5), gy=Y(0);
  const x0=X(-400),x1=X(0),top=Y(20);
  if(x1<-40||x0>v.vw+40)return;
  // plateau with an earth face
  // an earth bluff: strata bands and a few stones, grass lip on top
  ctx.fillStyle=b.name==='night'?'#3a3230':'#b98a5a';ctx.fillRect(x0,top,x1-x0,gy-top);
  ctx.fillStyle=b.name==='night'?'rgba(0,0,0,.22)':'rgba(138,84,40,.45)';for(let i=0;i<5;i++){const yy=top+(gy-top)*(i+.6)/5.4;ctx.fillRect(x0,yy,x1-x0,Math.max(2,.45*sc))}
  ctx.fillStyle='rgba(34,40,58,.18)';for(let i=0;i<14;i++){const xx=X(-hs(i*3.1)*40),yy=top+(gy-top)*hs(i*5.3);if(xx>x0&&xx<x1){ctx.beginPath();ctx.ellipse(xx,yy,Math.max(2,.5*sc),Math.max(1.5,.3*sc),0,0,7);ctx.fill()}}
  ctx.fillStyle=b.ground;ctx.fillRect(x0,top-Math.max(2,.6*sc),x1-x0,Math.max(3,.8*sc));
  ctx.strokeStyle=INK;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x1,top);ctx.lineTo(x1,gy);ctx.stroke();
  // a painted banner hung on the bluff: the town welcomes the circus
  if(v.town&&sc>4){const bx0=X(-24),bx1=X(-3),by0=Y(15.5),by1=Y(8.5),wv=Math.sin(now/900)*sc*.15;
    ctx.fillStyle=PAPER;ctx.strokeStyle=INK;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(bx0,by0);ctx.quadraticCurveTo((bx0+bx1)/2,by0+sc*.6+wv,bx1,by0);ctx.lineTo(bx1,by1);ctx.quadraticCurveTo((bx0+bx1)/2,by1+sc*.6+wv,bx0,by1);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=RED;ctx.fillRect(bx0+lw,by0+sc*.35,bx1-bx0-lw*2,Math.max(2,sc*.35));ctx.fillRect(bx0+lw,by1-sc*.7,bx1-bx0-lw*2,Math.max(2,sc*.35));
    ctx.fillStyle=INK;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=`400 ${Math.round(sc*1.1)}px "Nunito", sans-serif`;ctx.fillText('Welcome to',(bx0+bx1)/2,by0+sc*1.9+wv*.5);
    ctx.font=`400 ${Math.round(sc*2.3)}px "Bowlby One", Impact, sans-serif`;ctx.fillStyle=RED;ctx.fillText(v.town,(bx0+bx1)/2,by0+sc*4.3+wv*.5)}
  const W=(fn,x,y,s)=>{ctx.save();ctx.translate(X(x),Y(y));ctx.scale(sc*s,sc*s);fn(lw/(sc*s));ctx.restore()};
  // grandstand: three wooden tiers with a striped awning, the crowd bobbing (more when hyped)
  W(l=>{
    const g=ctx;g.lineWidth=l;g.strokeStyle=INK;
    for(let i=0;i<3;i++){g.fillStyle=i%2?WOOD:'#c98d52';g.fillRect(-10+i*1.2,-1.4-i*1.4,20-i*2.4,1.4);g.strokeRect(-10+i*1.2,-1.4-i*1.4,20-i*2.4,1.4)}
    for(let i=0;i<3;i++){const n=14-i*2;for(let j=0;j<n;j++){const x=-9+i*1.2+(j+.5)*(18-i*2.4)/n,h=hs(j*7.7+i*3.1);
      const bob=Math.abs(Math.sin(now/180*(1+v.hype)+h*9))*(.15+v.hype*.55+v.cheer*.8);const y=-1.4-i*1.4-.55-bob;
      g.fillStyle=['#d2402f','#3b9aa6','#e9a93b','#7a4fa0','#fbf5e8','#4fa35b'][Math.floor(h*6)];g.fillRect(x-.32,y,.64,.6);
      g.fillStyle=['#f0c08a','#c98d62','#8a5a3c','#f6d3b0'][Math.floor(hs(h*40)*4)];g.beginPath();g.arc(x,y-.3,.3,0,7);g.fill();
      if(v.cheer>.2&&h>.5){g.strokeStyle=INK;g.beginPath();g.moveTo(x-.2,y);g.lineTo(x-.45,y-.8-bob);g.moveTo(x+.2,y);g.lineTo(x+.45,y-.8-bob);g.stroke()}}}
    g.strokeStyle=INK;g.fillStyle=WOOD2;g.fillRect(-10.2,-7.2,.4,7.2);g.fillRect(9.8,-7.2,.4,7.2);
    for(let i=0;i<10;i++){g.fillStyle=i%2?CANVAS:RED;g.beginPath();g.moveTo(-10.5+i*2.1,-7.4);g.lineTo(-8.4+i*2.1,-7.4);g.lineTo(-9.45+i*2.1,-6.3);g.closePath();g.fill();g.stroke()}
    g.fillStyle=RED;g.fillRect(-10.6,-8.2,21.2,.9);g.strokeRect(-10.6,-8.2,21.2,.9);
  },-17,20,1);
  // bunting from the stand to the ramp
  ctx.strokeStyle=INK;ctx.lineWidth=Math.max(1,lw*.6);ctx.beginPath();const bx0=X(-6.6),by=Y(28),bx1=X(-3),by1=Y(25.5);ctx.moveTo(bx0,by);ctx.quadraticCurveTo((bx0+bx1)/2,Y(25),bx1,by1);ctx.stroke();
  for(let i=1;i<9;i++){const t=i/9,x=lerp(bx0,bx1,t),y=lerp(by,by1,t)+Math.sin(t*Math.PI)*(Y(25)-by)*.9,s=Math.max(3,.6*sc);
    ctx.fillStyle=[RED,BRASS,'#3b9aa6',CANVAS][i%4];ctx.beginPath();ctx.moveTo(x-s*.6,y);ctx.lineTo(x+s*.6,y);ctx.lineTo(x,y+s*1.2+Math.sin(now/300+i)*s*.15);ctx.closePath();ctx.fill();ctx.lineWidth=Math.max(1,lw*.6);ctx.stroke()}
  // the wooden launch ramp with a coiled spring
  W(l=>{const g=ctx;g.lineWidth=l;g.strokeStyle=INK;g.fillStyle=WOOD;
    g.beginPath();g.moveTo(-5,0);g.lineTo(2,0);g.lineTo(2,-1);g.lineTo(-5,-.2);g.closePath();g.fill();g.stroke();
    g.fillStyle=WOOD2;g.fillRect(-4.6,-.1,.4,.1);g.beginPath();g.moveTo(-6,-.1);g.lineTo(1.6,-2.9);g.lineTo(2.2,-2.4);g.lineTo(-5.6,.3);g.closePath();g.fill();g.stroke();
    g.strokeStyle='#8a8f99';g.lineWidth=l*1.2;g.beginPath();for(let i=0;i<7;i++){const x=-4.2+i*.5;g.moveTo(x,-.3-i*.18);g.lineTo(x+.25,-1-i*.18)}g.stroke();
    g.strokeStyle=INK;g.lineWidth=l;g.fillStyle=RED;g.fillRect(.9,-4.4,.25,2);g.beginPath();g.moveTo(1.15,-4.4);g.lineTo(2.6,-4);g.lineTo(1.15,-3.6);g.closePath();g.fill();g.stroke();
  },-2,20,1);
}

/* ---------- wooden distance signposts and the BEST pennant ---------- */
function signposts(ctx,v,best){
  const {X,Y,sc,left,right}=v, gy=Y(0);
  const steps=[10,50,100,500,1000,5000,1e4,5e4,1e5,5e5,1e6,5e6,1e7];
  const sp=steps.find(s=>s*sc>=110)||steps[steps.length-1];
  ctx.font='400 11px "Bowlby One", Impact, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  for(let k=Math.max(1,Math.floor(left/sp));k<=Math.ceil(right/sp);k++){const d=k*sp,px=X(d);
    const label=d>=1000?(d/1000)+' km':d+' m',w=ctx.measureText(label).width+12;
    ctx.fillStyle=WOOD2;ctx.fillRect(px-1.5,gy-18,3,18);
    ctx.fillStyle=PAPER;ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px-w/2,gy-31);ctx.lineTo(px+w/2,gy-31);ctx.lineTo(px+w/2+6,gy-24);ctx.lineTo(px+w/2,gy-17);ctx.lineTo(px-w/2,gy-17);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=INK;ctx.fillText(label,px+2,gy-23.5)}
  if(best>0){const px=X(best);if(px>-30&&px<v.vw+30){ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,gy);ctx.lineTo(px,gy-48);ctx.stroke();
    ctx.fillStyle=RED;ctx.beginPath();ctx.moveTo(px,gy-48);ctx.lineTo(px+30,gy-41+Math.sin(v.now/250)*2);ctx.lineTo(px,gy-34);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=PAPER;ctx.font='400 9px "Bowlby One", Impact, sans-serif';ctx.fillText('BEST',px+12,gy-41)}}
}

/* ---------- clouds: flat poster clouds with a shade band ---------- */
function clouds(ctx,v,b,night){
  const {X,Y,sc,left,right,vw,vh}=v;
  if((right-left)/400>200)return;
  for(let k=Math.floor(left/400)-1;k<=Math.ceil(right/400)+1;k++){const h=hs(k*2.3);if(h>.6)continue;
    const cx=k*400+hs(k*4.4)*300,cy=150+hs(k*6.6)*900,w=30+hs(k*8.8)*40;const px=X(cx),py=Y(cy),pw=w*sc;
    if(pw<4||py<-pw||py>vh+pw||px<-pw*1.5||px>vw+pw*1.5)continue;
    const puff=(c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(px,py,pw*.5,pw*.17,0,0,7);ctx.ellipse(px-pw*.22,py-pw*.08,pw*.24,pw*.17,0,0,7);ctx.ellipse(px+pw*.12,py-pw*.13,pw*.26,pw*.2,0,0,7);ctx.ellipse(px+pw*.34,py-pw*.02,pw*.16,pw*.12,0,0,7);ctx.fill()};
    ctx.save();ctx.translate(0,pw*.05);puff(night?'rgba(20,30,52,.6)':'rgba(34,40,58,.12)');ctx.restore();
    puff(night?'#2e3f66':CANVAS);
  }
}

/* ---------- thermals: shimmering columns with a hawk riding them ---------- */
function thermals(ctx,v,st){
  const {X,Y,sc,left,right,now}=v, gy=Y(0);
  if((right-left)/120>300)return;
  for(let k=Math.floor(left/120)-1;k<=Math.ceil(right/120)+1;k++){const t=thermalSeg(k,st);if(!t)continue;const px=X(t.cx),w=22*sc;if(px<-w||px>v.vw+w)continue;
    const ty=Y(t.top);const gr=ctx.createLinearGradient(0,gy,0,ty);gr.addColorStop(0,'rgba(255,236,190,.36)');gr.addColorStop(1,'rgba(255,236,190,0)');
    ctx.fillStyle=gr;ctx.fillRect(px-w/2,ty,w,gy-ty);
    ctx.strokeStyle='rgba(251,245,232,.55)';ctx.lineWidth=2;const ph=(now/700)%1;
    for(let i=0;i<5;i++){const yy=lerp(gy,ty,((i/5+ph)%1));ctx.beginPath();for(let j=0;j<=8;j++){const x=px-w*.25+j*w*.0625,y=yy+Math.sin(j*1.3+now/300+i)*3;j?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}
    // a hawk circling near the top
    const a=now/1400+k,hx=px+Math.cos(a)*w*.6,hy=lerp(gy,ty,.75)+Math.sin(a)*w*.2,hsz=Math.max(4,.9*sc);
    ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(hx-hsz,hy-hsz*.3);ctx.quadraticCurveTo(hx-hsz*.4,hy-hsz*.7,hx,hy);ctx.quadraticCurveTo(hx+hsz*.4,hy-hsz*.7,hx+hsz,hy-hsz*.3);ctx.stroke();
  }
}

/* ---------- storms ---------- */
function stormFx(ctx,v,st,wx){
  const {vw,vh,now,Y}=v;
  if(st.ceiling){const cy=Y(st.ceiling);if(cy>-40){
    const g=ctx.createLinearGradient(0,cy-160,0,cy+30);g.addColorStop(0,'rgba(44,50,64,.95)');g.addColorStop(1,'rgba(64,72,88,0)');ctx.fillStyle=g;ctx.fillRect(0,0,vw,cy+30);
    ctx.fillStyle='#3a4152';ctx.beginPath();ctx.moveTo(0,0);for(let x=0;x<=vw+30;x+=26){const u=x+v.camX*v.sc*.3;ctx.lineTo(x,cy-6-Math.abs(Math.sin(u*.021))*20)}ctx.lineTo(vw,0);ctx.closePath();ctx.fill();
    ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
    if(Math.random()<.012){ctx.strokeStyle='#ffe08a';ctx.lineWidth=3;ctx.beginPath();let x=Math.random()*vw,y=cy;ctx.moveTo(x,y);for(let i=0;i<5;i++){x+=(Math.random()-.5)*40;y+=26;ctx.lineTo(x,y)}ctx.stroke()}}}
  if(wx==='headwind'||wx==='gusts'){
    // rain/wind streaks across the screen
    ctx.strokeStyle='rgba(251,245,232,.45)';ctx.lineWidth=2;
    for(let i=0;i<26;i++){const spd=wx==='headwind'?320+hs(i)*160:60,vy=wx==='gusts'?Math.sin(now/700+i)*140:40;
      const x=((hs(i*7.1)*(vw+120)-now/1000*spd)%(vw+120)+vw+120)%(vw+120)-60,y=((hs(i*3.7)*vh+now/1000*vy)%vh+vh)%vh;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(wx==='headwind'?30:6),y+(wx==='gusts'?-Math.sign(vy)*16:4));ctx.stroke()}
  }
}

/* ---------- the whole backdrop ---------- */
// v: {vw, vh, sc, X, Y, camX, camY, left, right, now, stage, wx, st, best, hype, cheer}
function drawWorld(ctx,v){
  const b=biomeOf(v.stage), night=b.name==='night', alt=v.camY;
  // sky: biome colors, darkening toward deep blue with altitude, storm-grey under weather fronts
  const a1=clamp(alt/5000,0,1), a2=clamp((alt-5000)/30000,0,1);
  let top=mix(mix(b.sky[0],'#1d4f9c',a1*(night?.2:1)),'#03050f',a2), bot=mix(mix(b.sky[1],'#6fa3d8',a1*(night?.2:1)),'#0a1230',a2);
  const grey=v.wx==='headwind'||v.wx==='gusts'||v.wx==='ceiling'?.42:v.wx==='thin'?.28:0;
  if(grey){top=mix(top,night?'#141c2c':'#5a6878',grey);bot=mix(bot,night?'#26324a':'#a9b4bf',grey)}
  const sky=ctx.createLinearGradient(0,0,0,v.vh);sky.addColorStop(0,top);sky.addColorStop(1,bot);ctx.fillStyle=sky;ctx.fillRect(0,0,v.vw,v.vh);
  // stars at night or high up
  const starA=night?Math.max(.8-a1*.2,.6):clamp((alt-4000)/20000,0,1);
  if(starA>0){ctx.fillStyle=`rgba(255,248,225,${starA})`;for(let i=0;i<120;i++){const sx=((hs(i*1.7)*v.vw*1.3-v.camX*v.sc*.0004)%v.vw+v.vw)%v.vw,sy=hs(i*3.3)*v.vh*.8;const s=hs(i)*1.8+.6;ctx.fillRect(sx,sy,s,s)}}
  // sun or moon: a flat disc with a soft halo
  if(!grey){const [fx,fy,col,moon]=b.sun,sx=v.vw*fx,sy=v.RES+v.vh*fy;
    const hg=ctx.createRadialGradient(sx,sy,6,sx,sy,110);hg.addColorStop(0,moon?'rgba(243,236,210,.35)':'rgba(255,236,190,.65)');hg.addColorStop(1,'rgba(255,236,190,0)');ctx.fillStyle=hg;ctx.fillRect(sx-110,sy-110,220,220);
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(sx,sy,moon?15:20,0,7);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
    if(moon){ctx.fillStyle='rgba(34,40,58,.18)';ctx.beginPath();ctx.arc(sx-4,sy-3,3,0,7);ctx.arc(sx+5,sy+4,2.2,0,7);ctx.fill()}}
  // night finale: searchlights sweeping from the city
  if(night){for(let i=0;i<3;i++){const ang=-Math.PI/2+Math.sin(v.now/1800+i*2.1)*.5,bx=v.vw*(.2+i*.3),by=v.Y(0);
    ctx.fillStyle='rgba(255,240,190,.08)';ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+Math.cos(ang-.06)*v.vh*1.4,by+Math.sin(ang-.06)*v.vh*1.4);ctx.lineTo(bx+Math.cos(ang+.06)*v.vh*1.4,by+Math.sin(ang+.06)*v.vh*1.4);ctx.closePath();ctx.fill()}}
  clouds(ctx,v,b,night);
  stormFx(ctx,v,v.st,v.wx);
  const gy=v.Y(0);
  if(gy<v.vh+260){
    silhouette(ctx,v,b.far[1],grey?mix(b.far[0],'#8a96a6',grey*.6):b.far[0],70,90,.05,1.3);
    silhouette(ctx,v,b.near[1],grey?mix(b.near[0],'#7a8696',grey*.5):b.near[0],34,50,.12,4.1);
    if(night){ // lit windows in the near skyline
      ctx.fillStyle='rgba(255,215,122,.8)';for(let i=0;i<40;i++){const x=((hs(i*5.7)*v.vw*1.5-v.camX*v.sc*.12)%(v.vw+40)+v.vw+40)%(v.vw+40)-20,y=gy-10-hs(i*2.9)*48;ctx.fillRect(x,y,3,4)}}
    // ground: two bands with grass tufts along the edge
    ctx.fillStyle=b.ground;ctx.fillRect(0,gy,v.vw,Math.max(0,v.vh-gy));
    ctx.fillStyle=b.ground2;ctx.fillRect(0,gy+Math.max(6,.8*v.sc),v.vw,Math.max(0,v.vh-gy));
    ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(v.vw,gy);ctx.stroke();
    if(v.sc>2){ctx.strokeStyle=b.ground2;ctx.lineWidth=2;ctx.beginPath();const sp=Math.max(10,1.4*v.sc),off=((v.camX*v.sc)%sp+sp)%sp;
      for(let x=-off;x<v.vw;x+=sp){ctx.moveTo(x,gy+1);ctx.lineTo(x+3,gy-4)}ctx.stroke()}
    // props along the ground, skipped when too small to see
    if(v.sc>1.1){const seg=30,lw=2.5;
      for(let k=Math.floor(v.left/seg)-1;k<=Math.ceil(v.right/seg)+1;k++){if(k<1)continue;const h=hs(k*7.3+v.stage*1.7);if(h>.55)continue;
        const type=pickProp(b.props,hs(k*3.9+v.stage));if(!type)continue;const size=PROP_SIZE[type]||3;if(size*v.sc<6)continue;
        const x=k*seg+hs(k*1.3)*18;const px=v.X(x);if(px<-size*v.sc*2||px>v.vw+size*v.sc*2)continue;
        ctx.save();ctx.translate(px,gy);ctx.scale(v.sc,v.sc);drawProp(ctx,type,lw/v.sc,v.now/1000,k,night);ctx.restore()}}
    launchSite(ctx,v,b);
    signposts(ctx,v,v.best);
  }
  thermals(ctx,v,v.st);
}
// the grain over everything (call last, before the HUD)
function drawGrain(ctx,vw,vh){ctx.fillStyle=halftonePattern(ctx);ctx.fillRect(0,0,vw,vh)}

export { BIOMES, biomeOf, drawWorld, drawGrain };
