import { loadCourse } from './src/data/courseLoader.ts';
import { simulateRound } from './src/systems/RoundSimulator.ts';
import v2PJ from './src/data/courses/v2/portjohnson.json' with { type: 'json' };
const course=loadCourse(v2PJ);
const tiger={id:'tiger',name:'Tiger',color:0,stats:{drivingPower:96,drivingAccuracy:92,approach:95,chipping:93,putting:95}};
const jd={id:'sunny',name:'JD',color:0,stats:{drivingPower:100,drivingAccuracy:62,approach:82,chipping:82,putting:82}};
function m(g){let s=0,n=400,dnf=0;for(let i=0;i<n;i++){const r=simulateRound(course,g,40000+i);s+=r.toPar;if(r.holes.some(h=>!h.holed))dnf++;}return[s/n,100*dnf/n];}
const [t,td]=m(tiger),[j,jd2]=m(jd);
console.log(`PJ post-elevation: Tiger ${t.toFixed(2)} (DNF ${td.toFixed(1)}%)  JD ${j.toFixed(2)} (DNF ${jd2.toFixed(1)}%)`);
