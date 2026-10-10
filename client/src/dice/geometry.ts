import { BoxGeometry, BufferGeometry, DodecahedronGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, OctahedronGeometry, Quaternion, TetrahedronGeometry, Vector3 } from 'three';
import type { PhysicalDie } from './rules';
export interface DieFace { normal:Vector3; center:Vector3; vertices:Vector3[]; value:number }
export interface DieGeometry { geometry:BufferGeometry; points:Float32Array; faces:DieFace[]; vertices:Vector3[]; sides:number }
const key=(v:Vector3)=>v.toArray().map(n=>n.toFixed(5)).join(',');
function ordered(vertices:Vector3[],normal:Vector3):Vector3[]{
  const center=vertices.reduce((sum,v)=>sum.add(v),new Vector3()).multiplyScalar(1/vertices.length);
  const x=vertices[0].clone().sub(center).normalize(),z=new Vector3().crossVectors(normal,x);
  return [...vertices].sort((a,b)=>{const av=a.clone().sub(center),bv=b.clone().sub(center);return Math.atan2(av.dot(z),av.dot(x))-Math.atan2(bv.dot(z),bv.dot(x));});
}
function facesFromGeometry(source:BufferGeometry):Vector3[][]{
  const geometry=source.index?source.toNonIndexed():source;
  const positions=geometry.getAttribute('position');
  const groups=new Map<string,{normal:Vector3;vertices:Map<string,Vector3>}>();
  for(let i=0;i<positions.count;i+=3){
    const a=new Vector3().fromBufferAttribute(positions,i),b=new Vector3().fromBufferAttribute(positions,i+1),c=new Vector3().fromBufferAttribute(positions,i+2);
    const normal=new Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    let group=[...groups.values()].find(candidate=>candidate.normal.dot(normal)>.99999);if(!group){group={normal,vertices:new Map()};groups.set(String(groups.size),group);}
    for(const v of [a,b,c])group.vertices.set(key(v),v);
  }
  const result=[...groups.values()].map(group=>ordered([...group.vertices.values()],group.normal));
  if(geometry!==source)geometry.dispose();source.dispose();return result;
}
function d10Polygons():Vector3[][]{
  // Polar dual of a regular pentagonal antiprism: ten congruent kite faces.
  const ring=Array.from({length:10},(_,i)=>{const upper=i<5,angle=(i%5)*Math.PI*2/5+(upper?0:Math.PI/5);return new Vector3(Math.cos(angle),upper?.5:-.5,Math.sin(angle));});
  const faces:number[][]=[Array.from({length:5},(_,i)=>i),Array.from({length:5},(_,i)=>i+5)];
  for(let i=0;i<5;i++){const next=(i+1)%5;faces.push([i,i+5,next],[i+5,next,next+5]);}
  const dual=faces.map(indices=>{
    const [a,b,c]=indices.map(i=>ring[i]);const normal=new Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    if(normal.dot(a)<0)normal.negate();return normal.multiplyScalar(1/normal.dot(a));
  });
  const scale=.94/Math.max(...dual.map(v=>v.length()));dual.forEach(v=>v.multiplyScalar(scale));
  return ring.map((v,i)=>ordered(faces.flatMap((face,index)=>face.includes(i)?[dual[index]]:[]),v.clone().normalize()));
}
export function makeDieGeometry(sides:PhysicalDie['sides']):DieGeometry{
  const polygons=sides===10?d10Polygons():facesFromGeometry(sides===4?new TetrahedronGeometry(.95):sides===6?new BoxGeometry(1.2,1.2,1.2):sides===8?new OctahedronGeometry(.95):sides===12?new DodecahedronGeometry(.92):new IcosahedronGeometry(.95));
  const vertices=[...new Map(polygons.flat().map(v=>[key(v),v])).values()];
  const faces:DieFace[]=polygons.map(polygon=>{
    const center=polygon.reduce((sum,v)=>sum.add(v),new Vector3()).multiplyScalar(1/polygon.length);
    const normal=new Vector3().crossVectors(polygon[1].clone().sub(polygon[0]),polygon[2].clone().sub(polygon[0])).normalize();
    if(normal.dot(center)<0){normal.negate();polygon.reverse();}
    return {normal,center,vertices:polygon,value:0};
  });
  if(sides===4)faces.forEach(face=>{face.value=vertices.findIndex(v=>!face.vertices.some(p=>p.distanceTo(v)<1e-4))+1;});
  else{let value=1;for(const face of faces){if(face.value)continue;face.value=value;const opposite=faces.find(other=>other!==face&&other.normal.dot(face.normal)<-.999);if(opposite)opposite.value=sides+1-value;value++;}}
  const positions:number[]=[];
  for(const face of faces)for(let i=1;i<face.vertices.length-1;i++)for(const v of [face.vertices[0],face.vertices[i],face.vertices[i+1]])positions.push(...v.toArray());
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  return {geometry,points:new Float32Array(vertices.flatMap(v=>v.toArray())),faces,vertices,sides};
}
export function detectResult(definition:DieGeometry,rotation:{x:number;y:number;z:number;w:number}):{value:number;alignment:number}{
  const q=new Quaternion(rotation.x,rotation.y,rotation.z,rotation.w);
  const candidates=definition.sides===4?definition.vertices.map((v,i)=>({direction:v.clone().normalize(),value:i+1})):definition.faces.map(f=>({direction:f.normal.clone(),value:f.value}));
  return candidates.map(c=>({value:c.value,alignment:c.direction.applyQuaternion(q).y})).sort((a,b)=>b.alignment-a.alignment)[0];
}
export function labelRotation(normal:Vector3,toward?:Vector3):Quaternion{
  const up=(toward??new Vector3(0,1,0)).clone().addScaledVector(normal,-(toward??new Vector3(0,1,0)).dot(normal));
  if(up.lengthSq()<.001)up.set(0,0,-1).addScaledVector(normal,normal.z);
  up.normalize();const right=new Vector3().crossVectors(up,normal).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right,up,normal));
}

/** A readable die must rest on the tabletop, not on another die. */
export function isTabletopLanding(shape: DieGeometry, rotation: {x:number;y:number;z:number;w:number}, centerY: number, scale = 1): boolean {
  const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const bottom = centerY + Math.min(...shape.vertices.map(vertex => vertex.clone().multiplyScalar(scale).applyQuaternion(quaternion).y));
  return Math.abs(bottom) < .12;
}
