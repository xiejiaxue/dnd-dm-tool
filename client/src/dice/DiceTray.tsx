import { CROWN_PATH } from './crown';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ConvexHullCollider, CuboidCollider, Physics, RigidBody, useAfterPhysicsStep, CoefficientCombineRule, type RapierRigidBody } from '@react-three/rapier';
import { CanvasTexture, EdgesGeometry, Euler, OrthographicCamera, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { detectResult, isTabletopLanding, labelRotation, makeDieGeometry, type DieGeometry } from './geometry';
import { randomUnit, type PhysicalDie } from './rules';
import { DICE_MOTION as motion, dieScale, spaceBounds, throwLaunches, type SpaceBounds } from './tray';

const definitions=new Map<number,DieGeometry>();
function definition(sides:PhysicalDie['sides']):DieGeometry {let value=definitions.get(sides);if(!value){value=makeDieGeometry(sides);definitions.set(sides,value);}return value;}
const textures=new Map<string,CanvasTexture>();
function numberTexture(text:string,highlight:boolean):CanvasTexture{
  const id=`${text}:${highlight}`;const cached=textures.get(id);if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,256,256);ctx.fillStyle='#fffdf8';ctx.font=`${highlight?750:650} ${text.length>1?136:166}px Helvetica, Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';if(text==='crown'){ctx.save();ctx.scale(2.56,2.56);ctx.fill(new Path2D(CROWN_PATH));ctx.restore();}else{ctx.fillText(text,128,132);}
  if(text==='6'||text==='9'){ctx.fillRect(91,214,74,7);}
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;textures.set(id,texture);return texture;
}
function FaceLabel({text,position,rotation,size,highlight}:{text:string;position:Vector3;rotation:Quaternion;size:number;highlight:boolean}){
  return <mesh position={position} quaternion={rotation} renderOrder={2}><planeGeometry args={[size,size]}/><meshBasicMaterial map={numberTexture(text,highlight)} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} toneMapped={false}/></mesh>;
}
function DieMesh({die,result}:{die:PhysicalDie;result?:number}){
  const shape=definition(die.sides);
  const edges=useMemo(()=>new EdgesGeometry(shape.geometry,15),[shape]);useEffect(()=>()=>edges.dispose(),[edges]);
  return <group>
    <mesh geometry={shape.geometry} castShadow receiveShadow><meshStandardMaterial color="#ba3526" roughness={.72} metalness={0} flatShading/></mesh>
    <lineSegments geometry={edges}><lineBasicMaterial color="#75241c" transparent opacity={.28}/></lineSegments>
    {shape.faces.flatMap((face,index)=>{
      if(die.sides===4)return face.vertices.map((vertex,i)=>{
        const value=shape.vertices.findIndex(v=>v.distanceTo(vertex)<1e-4)+1;
        const position=vertex.clone().lerp(face.center,.53).addScaledVector(face.normal,.009);
        return <FaceLabel key={`${index}-${i}`} text={String(value)} position={position} rotation={labelRotation(face.normal,vertex.clone().sub(face.center))} size={.28} highlight={result===value}/>;
      });
      const text=die.sides===20&&face.value===20?'crown':die.percentile==='tens'?String(face.value%10*10).padStart(2,'0'):die.percentile==='units'?String(face.value%10):String(face.value);
      const size=die.sides===6?.82:die.sides===8?.64:die.sides===10?.53:die.sides===12?.58:.48;
      return <FaceLabel key={index} text={text} position={face.center.clone().addScaledVector(face.normal,.01)} rotation={labelRotation(face.normal)} size={size} highlight={result===face.value}/>;
    })}
  </group>;
}
function CameraFit({bounds}:{bounds:SpaceBounds}) {
  const {camera,size,invalidate}=useThree();
  useEffect(()=>{
    const c=camera as OrthographicCamera;
    c.zoom=Math.min(size.width/(bounds.halfWidth*2+1),size.height/(bounds.halfDepth*2+1.8));
    c.lookAt(0,0,0);c.updateProjectionMatrix();invalidate();
  },[camera,size,bounds,invalidate]);
  return null;
}
function SpaceSurface({bounds}:{bounds:SpaceBounds}) {
  const points=useMemo(()=>new Float32Array([
    -bounds.halfWidth,.012,-bounds.halfDepth,
    bounds.halfWidth,.012,-bounds.halfDepth,
    bounds.halfWidth,.012,bounds.halfDepth,
    -bounds.halfWidth,.012,bounds.halfDepth,
  ]),[bounds]);
  return <>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.006,0]} receiveShadow>
      <planeGeometry args={[100,100]}/><meshStandardMaterial color="#e5e3da" roughness={1}/>
    </mesh>
    <lineLoop><bufferGeometry><bufferAttribute attach="attributes-position" args={[points,3]}/></bufferGeometry><lineBasicMaterial color="#999d92" transparent opacity={.65}/></lineLoop>
  </>;
}
function RestingPreview() {
  const shape=definition(20),face=shape.faces[0];
  const rotation=new Quaternion().setFromUnitVectors(face.normal,new Vector3(0,1,0));
  return <group position={[0,face.normal.dot(face.center)+.006,0]} quaternion={rotation}><DieMesh die={{id:'preview',sides:20,logicalIndex:0}}/></group>;
}
function ContextEvents({onError}:{onError:(message:string)=>void}) {
  const {gl}=useThree();
  useEffect(()=>{
    const canvas=gl.domElement;
    const lost=(event:Event)=>{event.preventDefault();onError('图形上下文已中断，请切换简洁模式或刷新');};
    canvas.addEventListener('webglcontextlost',lost);
    return()=>canvas.removeEventListener('webglcontextlost',lost);
  },[gl,onError]);
  return null;
}
interface SimulationProps {dice:PhysicalDie[];results:Record<string,number>;complete:boolean;onComplete:(values:Record<string,number>)=>void;onError:(message:string)=>void;onReady:()=>void}
function Simulation({dice,results,complete,onComplete,onError,onReady,bounds}:SimulationProps&{bounds:SpaceBounds}){
  const size=dieScale(dice.length);
  const colliderPoints=useMemo(()=>new Map(dice.map(die=>[die.sides,new Float32Array(Array.from(definition(die.sides).points,value=>value*size))])),[dice,size]);
  const bodies=useRef(new Map<string,RapierRigidBody>()),elapsed=useRef(0),quiet=useRef(0),finished=useRef(false);
  const invalidQuiet=useRef(new Map<string,number>());
  const launches=useMemo(()=>{const hand=throwLaunches(dice.length,bounds,randomUnit);return dice.map((die,index)=>{
    const u=randomUnit(),v=randomUnit(),w=randomUnit();
    const quaternion=new Quaternion(Math.sqrt(1-u)*Math.sin(2*Math.PI*v),Math.sqrt(1-u)*Math.cos(2*Math.PI*v),Math.sqrt(u)*Math.sin(2*Math.PI*w),Math.sqrt(u)*Math.cos(2*Math.PI*w));
    const euler=new Euler().setFromQuaternion(quaternion);
    const {position:[x,height,z],velocity,spin}=hand[index];
    // Lift the die so its lowest rotated vertex sits at the release height.
    const support = -Math.min(...definition(die.sides).vertices.map(vertex=>vertex.clone().multiplyScalar(size).applyQuaternion(quaternion).y));
    return {die,position:[x,height+support,z] as [number,number,number],rotation:[euler.x,euler.y,euler.z] as [number,number,number],velocity,spin};
  });},[dice,bounds,size]);
  useEffect(()=>{onReady();},[onReady]);
  useAfterPhysicsStep(()=>{
    const delta=motion.timeStep;
    if(!dice.length||complete||finished.current||bodies.current.size!==dice.length)return;
    elapsed.current+=delta;
    const values:Record<string,number>={};let settled=elapsed.current>motion.minRollTime;
    for(const die of dice){const body=bodies.current.get(die.id)!;const velocity=body.linvel(),spin=body.angvel();const result=detectResult(definition(die.sides),body.rotation());
      const still=body.isSleeping()||(Math.hypot(velocity.x,velocity.y,velocity.z)<motion.linearThreshold&&Math.hypot(spin.x,spin.y,spin.z)<motion.angularThreshold);
      const readable=result.alignment>=.96&&isTabletopLanding(definition(die.sides),body.rotation(),body.translation().y,size);
      if(!still||!readable){settled=false;}
      const invalidTime=still&&!readable?(invalidQuiet.current.get(die.id)??0)+delta:0;
      invalidQuiet.current.set(die.id,invalidTime);
      if(invalidTime>=motion.cockedQuietTime){finished.current=true;onError('骰子倾斜或叠压，请重新掷骰');return;}
      values[die.id]=result.value;
    }
    quiet.current=settled?quiet.current+delta:0;
    if(quiet.current>motion.quietTime){finished.current=true;bodies.current.forEach(body=>body.sleep());onComplete(values);return;}
    if(elapsed.current>motion.timeout){finished.current=true;onError('有骰子未停稳或发生叠压，请重新投掷');}
  });
  return <>
    <RigidBody type="fixed" colliders={false} friction={motion.floorFriction} restitution={motion.floorRestitution}>
      <CuboidCollider args={[bounds.halfWidth+.3,.3,bounds.halfDepth+.3]} position={[0,-.3,0]}/>
      <CuboidCollider args={[.16,7.2,bounds.halfDepth+.32]} position={[-bounds.halfWidth-.16,6.6,0]} friction={motion.railFriction} restitution={motion.railRestitution}/>
      <CuboidCollider args={[.16,7.2,bounds.halfDepth+.32]} position={[bounds.halfWidth+.16,6.6,0]} friction={motion.railFriction} restitution={motion.railRestitution}/>
      <CuboidCollider args={[bounds.halfWidth+.32,7.2,.16]} position={[0,6.6,-bounds.halfDepth-.16]} friction={motion.railFriction} restitution={motion.railRestitution}/>
      <CuboidCollider args={[bounds.halfWidth+.32,7.2,.16]} position={[0,6.6,bounds.halfDepth+.16]} friction={motion.railFriction} restitution={motion.railRestitution}/>
    </RigidBody>
    {launches.map(({die,position,rotation,velocity,spin})=><RigidBody key={die.id} ref={body=>{if(body)bodies.current.set(die.id,body);else bodies.current.delete(die.id);}} position={position} rotation={rotation} linearVelocity={velocity} angularVelocity={spin} colliders={false} linearDamping={motion.linearDamping} angularDamping={motion.angularDamping} friction={motion.friction} restitution={motion.restitution} ccd canSleep>
      <ConvexHullCollider args={[colliderPoints.get(die.sides)!]} density={motion.density} restitutionCombineRule={CoefficientCombineRule.Min}/><group scale={size}><DieMesh die={die} result={results[die.id]}/></group>
    </RigidBody>)}
  </>;
}
class CanvasBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(){this.props.onError();}
  render(){return this.state.failed?<div className="dice-canvas-fallback">3D 骰盘不可用，可切换简洁模式</div>:this.props.children;}
}
function DiceSpace(props:SimulationProps) {
  const {size}=useThree();
  // Keep the physical frame fixed during a throw or after a result; resizing only changes the camera.
  const [bounds,setBounds]=useState(()=>spaceBounds(size.width,size.height));
  useEffect(()=>{if(!props.dice.length)setBounds(spaceBounds(size.width,size.height));},[props.dice.length,size.width,size.height]);
  return <>
    <CameraFit bounds={bounds}/><SpaceSurface bounds={bounds}/>
    {!props.dice.length&&<RestingPreview/>}
    <Suspense fallback={null}><Physics gravity={[0,motion.gravity,0]} timeStep={motion.timeStep} numSolverIterations={8} paused={props.complete||!props.dice.length}><Simulation {...props} bounds={bounds}/></Physics></Suspense>
  </>;
}
export default function DiceTray({rollId,...props}:SimulationProps&{rollId:string}){
  return <CanvasBoundary onError={()=>props.onError('3D 骰盘加载失败，可切换简洁模式')}><Canvas frameloop={props.dice.length&&!props.complete?'always':'demand'} orthographic camera={{position:[0,18,3],near:.1,far:100,zoom:40}} shadows dpr={[1,1.5]} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.setClearColor('#eeede6');}} fallback={<div className="dice-canvas-fallback">此设备不支持 WebGL，请切换简洁模式</div>}>
    <ContextEvents onError={props.onError}/>
    <ambientLight intensity={.85}/>
    <directionalLight position={[3,12,5]} intensity={1.8} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-bias={-.0005}/>
    <directionalLight position={[-6,6,-3]} intensity={.35}/>
    <DiceSpace key={rollId} {...props}/>
  </Canvas></CanvasBoundary>;
}
