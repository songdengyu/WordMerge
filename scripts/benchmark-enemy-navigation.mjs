import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
// Isolated CPU benchmark, not browser FPS. Five roaming boars reconsider a fixed
// player in an outdoor/cabin/lodge scenario. Resources are removed to isolate
// wall topology. Four identical decisions include the cold cache first sample.
// Run: node scripts/benchmark-enemy-navigation.mjs [optional-report.json]
const server=await createServer({server:{middlewareMode:true}});
try {
 const {dataFixture,worldFixture}=await server.ssrLoadModule('/src/game/testFixtures.ts');
 const {advanceSurvival}=await server.ssrLoadModule('/src/game/survival.ts');
 const {blueprintById}=await server.ssrLoadModule('/src/game/buildingConfig.ts');
 const {createBuildingParts}=await server.ssrLoadModule('/src/game/buildingSegments.ts');
 const {REGIONS,REGION_EXTENSIONS}=await server.ssrLoadModule('/src/game/progressionConfig.ts');
 const {WorldMap}=await server.ssrLoadModule('/src/game/world.ts');
 const {SmoothPathSearch}=await server.ssrLoadModule('/src/game/smoothNavigation.ts');
 const {ENEMIES}=await server.ssrLoadModule('/src/game/survivalConfig.ts');
 const reports=[];
 for(const [name,all,indoors,kind] of [['camp-outdoor',false,false,'cabin'],['camp-indoor',false,true,'cabin'],['expanded-indoor',true,true,'lodge']]) {
  const data=dataFixture(), bp=blueprintById(kind), parts=createBuildingParts(bp);
  for(const config of bp.parts) { Object.assign(parts[config.id],{built:true,hp:config.hp,xpGranted:true}); if(parts[config.id].segments) for(const id in parts[config.id].segments) parts[config.id].segments[id]=config.hp; }
  data.construction.buildings=[{id:'b1',blueprintId:kind,origin:{x:7,y:10},rotation:0,parts}];
  const map=worldFixture();
  const world=new WorldMap(map.config, all?REGIONS.map(r=>r.id):[],REGION_EXTENSIONS,[...map.config.objects,...REGION_EXTENSIONS.flatMap(r=>r.objects)].map(o=>o.id));
  const player=indoors?{x:8,y:11}:{x:8,y:7};
  data.survival.spawnRemaining=9999; data.survival.decisionRemaining=0;
  data.survival.enemies=[[7,5],[12,8],[4,8],[12,14],[6,11]].map(([x,y],i)=>({id:`e${i+1}`,kind:'boar',hp:ENEMIES.boar.hp,cell:{x,y},route:[],progress:0,target:null,cooldown:0,roaming:true}));
  let searches=0; const original=SmoothPathSearch.prototype.advance;
  SmoothPathSearch.prototype.advance=function(...args){searches++;return original.apply(this,args)};
  const timings=[];
  for(let i=0;i<4;i++){ const start=performance.now(); advanceSurvival(data.survival,data.production,data.construction,world,player,720,.05,false,player);timings.push(performance.now()-start); }
  SmoothPathSearch.prototype.advance=original;
  reports.push({name,searchesPerDecision:searches/4,ms:timings,averageMs:timings.reduce((a,b)=>a+b)/timings.length});
 }
 console.log(JSON.stringify(reports,null,2));
 if (process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(reports,null,2));
}finally{await server.close()}

