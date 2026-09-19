/** Metres; bench rectangle expanded by 30 cm to leave a walking margin. */
export const BENCH={minX:-1.65,maxX:1.95,minZ:.65,maxZ:2.20};
export const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
export function fitDistance(width,height,fov,aspect,padding=1.24){return Math.max(height,width/Math.max(.25,aspect))/(2*Math.tan(fov*Math.PI/360))*padding;}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
/** Whether the open segment crosses the expanded bench footprint. */
export function blocked(a,b,r=BENCH){
 let low=0,high=1;
 for(const [i,min,max] of [[0,r.minX,r.maxX],[2,r.minZ,r.maxZ]]){
  const d=b[i]-a[i];
  if(Math.abs(d)<1e-10){if(a[i]<=min||a[i]>=max)return false;continue;}
  let t0=(min-a[i])/d,t1=(max-a[i])/d;if(t0>t1)[t0,t1]=[t1,t0];
  low=Math.max(low,t0);high=Math.min(high,t1);if(high<=low)return false;
 }
 return high>Math.max(low,0)&&low<1;
}
/** Tiny visibility graph chooses the shortest clear aisle around the bench. */
export function walkPath(a,b){
 if(!blocked(a,b))return [a,b];
 const r=BENCH,m=.06;
 const nodes=[a,b,[r.minX-m,a[1],r.minZ-m],[r.minX-m,a[1],r.maxZ+m],[r.maxX+m,a[1],r.minZ-m],[r.maxX+m,a[1],r.maxZ+m]];
 const costs=nodes.map(()=>Infinity),prev=nodes.map(()=>-1),done=new Set();costs[0]=0;
 for(let j=0;j<nodes.length;j++){
  let k=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(k<0||costs[i]<costs[k]))k=i;
  if(k<0||!Number.isFinite(costs[k]))break;done.add(k);if(k===1)break;
  for(let i=0;i<nodes.length;i++)if(!done.has(i)&&!blocked(nodes[k],nodes[i])){
   const cost=costs[k]+distance(nodes[k],nodes[i]);if(cost<costs[i]){costs[i]=cost;prev[i]=k;}
  }
 }
 if(!Number.isFinite(costs[1]))throw new Error('Camera destination is inside an obstacle.');
 const result=[];for(let k=1;k>=0;k=prev[k])result.unshift(nodes[k]);return result;
}
export function samplePath(points,t){
 if(t<=0)return [...points[0]];if(t>=1)return [...points.at(-1)];
 const lengths=points.slice(1).map((p,i)=>distance(points[i],p));let left=lengths.reduce((a,b)=>a+b,0)*t;
 for(let i=0;i<lengths.length;i++){if(left<=lengths[i]){const u=left/Math.max(lengths[i],1e-10);return points[i].map((v,j)=>v+(points[i+1][j]-v)*u);}left-=lengths[i];}
 return [...points.at(-1)];
}
