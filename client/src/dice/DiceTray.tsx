import { CROWN_PATH } from './crown';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ConvexHullCollider, CuboidCollider, Physics, RigidBody, useAfterPhysicsStep, CoefficientCombineRule, type RapierRigidBody } from '@react-three/rapier';
import { AdditiveBlending, BoxGeometry, CanvasTexture, DoubleSide, EdgesGeometry, Euler, Float32BufferAttribute, PerspectiveCamera, Quaternion, SRGBColorSpace, Shape, ShapeGeometry, Vector2, Vector3, type BufferGeometry, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type PointLight, type PointsMaterial } from 'three';
import { detectResult, isTabletopLanding, labelRotation, makeDieGeometry, type DieGeometry } from './geometry';
import { randomUnit, type PhysicalDie } from './rules';
import { DICE_MOTION as motion, GUARD_TOP, RAIL_HEIGHT, RAIL_THICKNESS, dieScale, spaceBounds, throwLaunches, trayOutline, wallSegments, type SpaceBounds } from './tray';
import type { TraySettings, TrayView } from './settings';
import { DICE_LOOKS, THEMES, type DiceLook } from './themes';

const definitions=new Map<number,DieGeometry>();
function definition(sides:PhysicalDie['sides']):DieGeometry {let value=definitions.get(sides);if(!value){value=makeDieGeometry(sides);definitions.set(sides,value);}return value;}
const textures=new Map<string,CanvasTexture>();
function numberTexture(text:string,highlight:boolean,look:DiceLook):CanvasTexture{
  const id=`${text}:${highlight}:${look.ink}:${look.serif}`;const cached=textures.get(id);if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const family=look.serif?'Georgia, "Times New Roman", serif':'Helvetica, Arial, sans-serif';
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,256,256);ctx.fillStyle=look.ink;ctx.font=`${highlight?750:650} ${text.length>1?136:166}px ${family}`;ctx.textAlign='center';ctx.textBaseline='middle';if(text==='crown'){ctx.save();ctx.scale(2.56,2.56);ctx.fill(new Path2D(CROWN_PATH));ctx.restore();}else{ctx.fillText(text,128,132);}
  if(text==='6'||text==='9'){ctx.fillRect(91,214,74,7);}
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;textures.set(id,texture);return texture;
}
function FaceLabel({text,position,rotation,size,highlight,look}:{text:string;position:Vector3;rotation:Quaternion;size:number;highlight:boolean;look:DiceLook}){
  return <mesh position={position} quaternion={rotation} renderOrder={2}><planeGeometry args={[size,size]}/><meshBasicMaterial map={numberTexture(text,highlight,look)} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} toneMapped={false}/></mesh>;
}
const COLLIDER_COLOR='#2fd47a';
// A d20 that lands on 20 pulses gold, then keeps a faint glow while the result is shown.
const CRIT_GOLD='#ffc44d',CRIT_TIME=2.4;
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Seconds since this component first rendered a frame; the canvas keeps rendering for `CRIT_TIME` after a 20 lands. */
function useCritClock(onFrame:(t:number)=>void){
  const start=useRef<number|null>(null);
  useFrame(({clock})=>{start.current??=clock.elapsedTime;onFrame(clock.elapsedTime-start.current);});
}
function CritGlow({material}:{material:RefObject<MeshStandardMaterial>}){
  const still=useMemo(reducedMotion,[]);
  useEffect(()=>{const value=material.current;if(!value)return;value.emissive.set(CRIT_GOLD);return()=>{value.emissiveIntensity=0;};},[material]);
  useCritClock(t=>{const value=material.current;if(value)value.emissiveIntensity=still||t>=CRIT_TIME?.22:.22+.78*Math.exp(-t*1.3)*(.65+.35*Math.cos(t*10));});
  return null;
}
/** Two gold rings across the felt, a flash of light and a spray of sparks around a d20 that rolled 20. */
function CritBurst({position:[x,,z]}:{position:[number,number,number]}){
  const rings=useRef<(Mesh|null)[]>([]),light=useRef<PointLight>(null),sparks=useRef<BufferGeometry>(null),sparkMaterial=useRef<PointsMaterial>(null);
  const seeds=useMemo(()=>Array.from({length:32},()=>({angle:Math.random()*Math.PI*2,speed:3+Math.random()*6,rise:9+Math.random()*9})),[]);
  const positions=useMemo(()=>new Float32Array(seeds.length*3),[seeds]);
  useCritClock(t=>{
    rings.current.forEach((ring,i)=>{if(!ring)return;const local=(t-i*.22)/1.1;ring.visible=local>0&&local<1;ring.scale.setScalar(1+Math.max(0,local)*5);(ring.material as MeshBasicMaterial).opacity=(1-local)*.85;});
    if(light.current)light.current.intensity=45*Math.exp(-t*2.2);
    seeds.forEach(({angle,speed,rise},i)=>{const r=speed*t;positions[i*3]=Math.cos(angle)*r;positions[i*3+1]=Math.max(.05,1+rise*t-14*t*t);positions[i*3+2]=Math.sin(angle)*r;});
    if(sparks.current)sparks.current.attributes.position.needsUpdate=true;
    if(sparkMaterial.current)sparkMaterial.current.opacity=Math.max(0,1-t/1.3);
  });
  return <group position={[x,0,z]}>
    <pointLight ref={light} position={[0,3,0]} color={CRIT_GOLD} intensity={0} distance={30}/>
    {[0,1].map(i=><mesh key={i} ref={ring=>{rings.current[i]=ring;}} rotation={[-Math.PI/2,0,0]} position={[0,.03,0]} visible={false}><ringGeometry args={[.9,1.05,64]}/><meshBasicMaterial color={CRIT_GOLD} transparent depthWrite={false} toneMapped={false} blending={AdditiveBlending}/></mesh>)}
    <points frustumCulled={false}><bufferGeometry ref={sparks}><bufferAttribute attach="attributes-position" args={[positions,3]}/></bufferGeometry><pointsMaterial ref={sparkMaterial} color={CRIT_GOLD} size={.32} transparent depthWrite={false} toneMapped={false} blending={AdditiveBlending}/></points>
  </group>;
}
function DieMesh({die,result,look,showCollider,critical=false}:{die:PhysicalDie;result?:number;look:DiceLook;showCollider:boolean;critical?:boolean}){
  const shape=definition(die.sides);
  const material=useRef<MeshStandardMaterial>(null);
  const edges=useMemo(()=>new EdgesGeometry(shape.geometry,15),[shape]);useEffect(()=>()=>edges.dispose(),[edges]);
  return <group>
    <mesh geometry={shape.geometry} castShadow receiveShadow><meshStandardMaterial ref={material} color={look.body} roughness={look.roughness} metalness={look.metalness} flatShading/></mesh>
    {critical&&<CritGlow material={material}/>}
    <lineSegments geometry={edges}>{showCollider?<lineBasicMaterial color={COLLIDER_COLOR} depthTest={false} transparent opacity={.9}/>:<lineBasicMaterial color={look.edge} transparent opacity={.28}/>}</lineSegments>
    {shape.faces.flatMap((face,index)=>{
      if(die.sides===4)return face.vertices.map((vertex,i)=>{
        const value=shape.vertices.findIndex(v=>v.distanceTo(vertex)<1e-4)+1;
        const position=vertex.clone().lerp(face.center,.53).addScaledVector(face.normal,.009);
        return <FaceLabel key={`${index}-${i}`} text={String(value)} position={position} rotation={labelRotation(face.normal,vertex.clone().sub(face.center))} size={.28} highlight={result===value} look={look}/>;
      });
      const text=die.sides===20&&face.value===20?'crown':die.percentile==='tens'?String(face.value%10*10).padStart(2,'0'):die.percentile==='units'?String(face.value%10):String(face.value);
      const size=die.sides===6?.82:die.sides===8?.64:die.sides===10?.53:die.sides===12?.58:.48;
      return <FaceLabel key={index} text={text} position={face.center.clone().addScaledVector(face.normal,.01)} rotation={labelRotation(face.normal)} size={size} highlight={result===face.value} look={look}/>;
    })}
  </group>;
}
// Polar angle from straight down and azimuth around the tray; azimuth 0 looks from the thrower's (+z) side.
const VIEW_ANGLES:Record<Exclude<TrayView,'free'>,{polar:number;azimuth:number}>={top:{polar:.06,azimuth:0},angled:{polar:.8,azimuth:0},low:{polar:1.02,azimuth:0}};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
/** Shortest camera distance at which the whole tray, rails included, stays inside the frame. */
function fitDistance(camera:PerspectiveCamera,direction:Vector3,corners:Vector3[]):number{
  let near=2,far=400;const point=new Vector3();
  for(let i=0;i<22;i++){
    const r=(near+far)/2;camera.position.copy(direction).multiplyScalar(r);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const fits=corners.every(corner=>{point.copy(corner).project(camera);return point.z<1&&Math.abs(point.x)<=.94&&Math.abs(point.y)<=.9;});
    if(fits)far=r;else near=r;
  }
  return far;
}
interface Orbit {polar:number;azimuth:number;zoom:number}
/** Camera angles outlive each throw's remounted scene, so a free view survives the next roll. */
interface OrbitState {target:Orbit;current:Orbit|null}
function CameraRig({bounds,railHeight,view,onViewChange,orbit}:{bounds:SpaceBounds;railHeight:number;view:TrayView;onViewChange:(view:TrayView)=>void;orbit:OrbitState}){
  const {camera,gl,invalidate}=useThree();
  const viewRef=useRef(view);viewRef.current=view;
  const changeView=useRef(onViewChange);changeView.current=onViewChange;
  useEffect(()=>{
    if(view!=='free'){
      // Return by the shortest way round, however far a free drag has spun the tray.
      const from=orbit.current?.azimuth??0,preset=VIEW_ANGLES[view];
      orbit.target={...preset,azimuth:from-Math.atan2(Math.sin(from),Math.cos(from))+preset.azimuth,zoom:1};
    }
    invalidate();
  },[view,orbit,invalidate]);
  const corners=useMemo(()=>{const w=bounds.halfWidth+RAIL_THICKNESS,d=bounds.halfDepth+RAIL_THICKNESS;return [0,railHeight].flatMap(y=>[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>new Vector3(x,y,z)));},[bounds,railHeight]);
  useEffect(()=>{invalidate();},[corners,invalidate]);
  useEffect(()=>{
    const canvas=gl.domElement;let drag:{id:number;x:number;y:number;moved:boolean}|null=null;
    const down=(event:PointerEvent)=>{if(event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};};
    const move=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      if(!drag.moved){drag.moved=true;canvas.setPointerCapture(event.pointerId);if(viewRef.current!=='free')changeView.current('free');}
      drag.x=event.clientX;drag.y=event.clientY;
      orbit.target={...orbit.target,azimuth:orbit.target.azimuth-dx*.008,polar:clamp(orbit.target.polar-dy*.006,.04,1.3)};invalidate();
    };
    const up=(event:PointerEvent)=>{if(drag?.id===event.pointerId){if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);drag=null;}};
    const wheel=(event:WheelEvent)=>{if(viewRef.current!=='free')return;event.preventDefault();orbit.target={...orbit.target,zoom:clamp(orbit.target.zoom*Math.exp(event.deltaY*.0012),.45,1.6)};invalidate();};
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('wheel',wheel,{passive:false});
    return()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('wheel',wheel);};
  },[gl,orbit,invalidate]);
  const fitted=useRef({key:'',distance:30});
  useFrame((_,delta)=>{
    const cam=camera as PerspectiveCamera,goal=orbit.target;
    const now=orbit.current??(orbit.current={...goal});
    const k=1-Math.exp(-Math.min(delta,.1)*9);
    now.polar+=(goal.polar-now.polar)*k;now.azimuth+=(goal.azimuth-now.azimuth)*k;now.zoom+=(goal.zoom-now.zoom)*k;
    const settled=Math.abs(goal.polar-now.polar)<1e-4&&Math.abs(goal.azimuth-now.azimuth)<1e-4&&Math.abs(goal.zoom-now.zoom)<1e-4;
    if(settled)Object.assign(now,goal);
    const direction=new Vector3(Math.sin(now.polar)*Math.sin(now.azimuth),Math.cos(now.polar),Math.sin(now.polar)*Math.cos(now.azimuth));
    const key=`${now.polar.toFixed(5)}:${now.azimuth.toFixed(5)}:${cam.aspect.toFixed(4)}:${corners.length}:${corners[1].x}:${corners[2].z}:${corners[4].y}`;
    if(fitted.current.key!==key)fitted.current={key,distance:fitDistance(cam,direction,corners)};
    cam.position.copy(direction).multiplyScalar(fitted.current.distance*now.zoom);cam.lookAt(0,0,0);cam.updateProjectionMatrix();
    if(!settled)invalidate();
  });
  return null;
}
function TraySurface({bounds,settings}:{bounds:SpaceBounds;settings:TraySettings}){
  const theme=THEMES[settings.theme],railHeight=RAIL_HEIGHT[settings.rail];
  const outline=useMemo(()=>trayOutline(bounds),[bounds]);
  const segments=useMemo(()=>wallSegments(bounds),[bounds]);
  const floorGeometry=useMemo(()=>{
    const shape=new Shape(outline.map(([x,z])=>new Vector2(x,-z)));
    const geometry=new ShapeGeometry(shape);const position=geometry.getAttribute('position');const uv:number[]=[];
    for(let i=0;i<position.count;i++)uv.push((position.getX(i)+bounds.halfWidth)/(2*bounds.halfWidth),(position.getY(i)+bounds.halfDepth)/(2*bounds.halfDepth));
    geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));return geometry;
  },[outline,bounds]);
  useEffect(()=>()=>floorGeometry.dispose(),[floorGeometry]);
  const floorTexture=useMemo(()=>theme.floor(bounds.halfWidth/bounds.halfDepth),[theme,bounds]);
  const tableTexture=useMemo(()=>{const texture=theme.table().clone();texture.repeat.set(theme.tableRepeat,theme.tableRepeat);texture.needsUpdate=true;return texture;},[theme]);
  useEffect(()=>()=>tableTexture.dispose(),[tableTexture]);
  const railTextures=useMemo(()=>segments.map(segment=>{const texture=theme.rail().clone();texture.repeat.set(Math.max(1,segment.length/5),1);texture.needsUpdate=true;return texture;}),[segments,theme]);
  useEffect(()=>()=>railTextures.forEach(texture=>texture.dispose()),[railTextures]);
  const loop=useMemo(()=>new Float32Array(outline.flatMap(([x,z])=>[x,.012,z])),[outline]);
  return <>
    <color attach="background" args={[theme.clear]}/>
    <ambientLight color={theme.ambient[0]} intensity={theme.ambient[1]}/>
    <directionalLight position={[3,14,6]} color={theme.key[0]} intensity={theme.key[1]} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-.0005}/>
    <directionalLight position={[-6,6,-3]} color={theme.fill[0]} intensity={theme.fill[1]}/>
    {theme.glow&&<pointLight position={[-bounds.halfWidth-1.5,6,-bounds.halfDepth-1.5]} color={theme.glow[0]} intensity={theme.glow[1]} distance={60}/>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,0]} receiveShadow><planeGeometry args={[120,120]}/><meshStandardMaterial map={tableTexture} roughness={.9}/></mesh>
    <mesh geometry={floorGeometry} rotation={[-Math.PI/2,0,0]} position={[0,.001,0]} receiveShadow><meshStandardMaterial map={floorTexture} roughness={theme.floorRoughness} side={DoubleSide}/></mesh>
    {theme.outline
      ?<lineLoop><bufferGeometry><bufferAttribute attach="attributes-position" args={[loop,3]}/></bufferGeometry><lineBasicMaterial color={theme.outline} transparent opacity={.65}/></lineLoop>
      :segments.map((segment,index)=><mesh key={index} position={[segment.x,railHeight/2,segment.z]} rotation={[0,segment.angle,0]} castShadow receiveShadow>
        <boxGeometry args={[segment.length,railHeight,RAIL_THICKNESS]}/><meshStandardMaterial map={railTextures[index]} roughness={theme.railRoughness} metalness={theme.railMetalness}/>
      </mesh>)}
    {settings.showColliders&&<ColliderOverlay bounds={bounds} railHeight={railHeight}/>}
  </>;
}
/** Draws the static colliders: the solid rail, the transparent guard above it and the floor edge. */
function ColliderOverlay({bounds,railHeight}:{bounds:SpaceBounds;railHeight:number}){
  const segments=useMemo(()=>wallSegments(bounds),[bounds]);
  const shapes=useMemo(()=>segments.map(segment=>({segment,rail:new EdgesGeometry(new BoxGeometry(segment.length,railHeight,RAIL_THICKNESS)),guard:new EdgesGeometry(new BoxGeometry(segment.length,GUARD_TOP-railHeight,RAIL_THICKNESS))})),[segments,railHeight]);
  useEffect(()=>()=>shapes.forEach(shape=>{shape.rail.dispose();shape.guard.dispose();}),[shapes]);
  return <>{shapes.map(({segment,rail,guard},index)=><group key={index} position={[segment.x,0,segment.z]} rotation={[0,segment.angle,0]}>
    <lineSegments geometry={rail} position={[0,railHeight/2,0]}><lineBasicMaterial color={COLLIDER_COLOR} depthTest={false} transparent opacity={.95}/></lineSegments>
    <lineSegments geometry={guard} position={[0,(GUARD_TOP+railHeight)/2,0]}><lineBasicMaterial color={COLLIDER_COLOR} depthTest={false} transparent opacity={.18}/></lineSegments>
  </group>)}</>;
}
function RestingPreview({look,showCollider}:{look:DiceLook;showCollider:boolean}) {
  const shape=definition(20),face=shape.faces[0];
  const rotation=new Quaternion().setFromUnitVectors(face.normal,new Vector3(0,1,0));
  return <group position={[0,face.normal.dot(face.center)+.006,0]} quaternion={rotation}><DieMesh die={{id:'preview',sides:20,logicalIndex:0}} look={look} showCollider={showCollider}/></group>;
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
interface SimulationProps {settings:TraySettings;dice:PhysicalDie[];results:Record<string,number>;complete:boolean;onComplete:(values:Record<string,number>)=>void;onError:(message:string)=>void;onReady:()=>void}
function Simulation({dice,results,complete,onComplete,onError,onReady,bounds,settings}:SimulationProps&{bounds:SpaceBounds}){
  const look=DICE_LOOKS[settings.dice];
  const walls=useMemo(()=>wallSegments(bounds),[bounds]);
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
      {walls.map((wall,index)=><CuboidCollider key={index} args={[wall.length/2,(GUARD_TOP+.6)/2,RAIL_THICKNESS/2]} position={[wall.x,(GUARD_TOP-.6)/2,wall.z]} rotation={[0,wall.angle,0]} friction={motion.railFriction} restitution={motion.railRestitution}/>)}
    </RigidBody>
    {launches.map(({die,position,rotation,velocity,spin})=><RigidBody key={die.id} ref={body=>{if(body)bodies.current.set(die.id,body);else bodies.current.delete(die.id);}} position={position} rotation={rotation} linearVelocity={velocity} angularVelocity={spin} colliders={false} linearDamping={motion.linearDamping} angularDamping={motion.angularDamping} friction={motion.friction} restitution={motion.restitution} ccd canSleep>
      <ConvexHullCollider args={[colliderPoints.get(die.sides)!]} density={motion.density} restitutionCombineRule={CoefficientCombineRule.Min}/><group scale={size}><DieMesh die={die} result={results[die.id]} look={look} showCollider={settings.showColliders} critical={complete&&die.sides===20&&results[die.id]===20}/></group>
    </RigidBody>)}
    {complete&&!reducedMotion()&&dice.filter(die=>die.sides===20&&results[die.id]===20).map(die=>{const at=bodies.current.get(die.id)?.translation();return at?<CritBurst key={die.id} position={[at.x,at.y,at.z]}/>:null;})}
  </>;
}
class CanvasBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(){this.props.onError();}
  render(){return this.state.failed?<div className="dice-canvas-fallback">3D 骰盘不可用，可切换简洁模式</div>:this.props.children;}
}
function DiceSpace({onViewChange,orbit,...props}:SimulationProps&{onViewChange:(view:TrayView)=>void;orbit:OrbitState}) {
  const {size}=useThree();const {settings}=props;
  // Keep the physical frame fixed during a throw or after a result; resizing only changes the camera.
  const [bounds,setBounds]=useState(()=>spaceBounds(size.width,size.height,settings.size,settings.shape,props.dice.length));
  useEffect(()=>{if(!props.dice.length)setBounds(spaceBounds(size.width,size.height,settings.size,settings.shape));},[props.dice.length,size.width,size.height,settings.size,settings.shape]);
  return <>
    <CameraRig bounds={bounds} railHeight={RAIL_HEIGHT[settings.rail]} view={settings.view} onViewChange={onViewChange} orbit={orbit}/><TraySurface bounds={bounds} settings={settings}/>
    {!props.dice.length&&<RestingPreview look={DICE_LOOKS[settings.dice]} showCollider={settings.showColliders}/>}
    <Suspense fallback={null}><Physics gravity={[0,motion.gravity,0]} timeStep={motion.timeStep} numSolverIterations={8} paused={props.complete||!props.dice.length}><Simulation {...props} bounds={bounds}/></Physics></Suspense>
  </>;
}
export default function DiceTray({rollId,...props}:SimulationProps&{rollId:string;onViewChange:(view:TrayView)=>void}){
  const orbit=useRef<OrbitState>({target:{...VIEW_ANGLES[props.settings.view==='free'?'angled':props.settings.view],zoom:1},current:null});
  // A settled roll renders on demand, except while a 20's flourish plays out.
  const critical=props.complete&&props.dice.some(die=>die.sides===20&&props.results[die.id]===20);
  const [celebrating,setCelebrating]=useState(false);
  useEffect(()=>{if(!critical)return;setCelebrating(true);const timer=setTimeout(()=>setCelebrating(false),CRIT_TIME*1000+300);return()=>{clearTimeout(timer);setCelebrating(false);};},[critical,rollId]);
  return <CanvasBoundary onError={()=>props.onError('3D 骰盘加载失败，可切换简洁模式')}><Canvas frameloop={(props.dice.length&&!props.complete)||celebrating?'always':'demand'} camera={{fov:30,near:.5,far:300,position:[0,24,16]}} shadows dpr={[1,1.5]} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} fallback={<div className="dice-canvas-fallback">此设备不支持 WebGL，请切换简洁模式</div>}>
    <ContextEvents onError={props.onError}/>
    <DiceSpace key={rollId} orbit={orbit.current} {...props}/>
  </Canvas></CanvasBoundary>;
}
