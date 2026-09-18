import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDistance, walkPath, samplePath, blocked, ease, BENCH } from './navigation.mjs';
test('portrait view needs a larger distance for landscape artwork',()=>assert.ok(fitDistance(3.6,1.8,45,.5)>fitDistance(3.6,1.8,45,1.8)));
test('walk route goes around rather than through the bench',()=>{
 const path=walkPath([0,1.65,8],[0,1.65,-1]);
 assert.ok(path.length>2);
 for(let i=1;i<path.length;i++)assert.equal(blocked(path[i-1],path[i],BENCH),false);
});
test('clear aisle retains a direct route',()=>assert.equal(walkPath([-4,1.65,8],[-4,1.65,-1]).length,2));
test('path samples start/end exactly and keep eye level',()=>{
 const a=[0,1.65,8],b=[2.4,1.65,-1],p=walkPath(a,b);
 assert.deepEqual(samplePath(p,0),a);assert.deepEqual(samplePath(p,1),b);
 for(let i=0;i<=100;i++)assert.ok(Math.abs(samplePath(p,i/100)[1]-1.65)<1e-10);
});
test('smooth travel has exact endpoints',()=>{assert.equal(ease(0),0);assert.equal(ease(1),1);});
