export const DIE_SIDES = [4,6,8,10,12,20,100] as const;
export type DieSides = typeof DIE_SIDES[number];
export interface DiceTerm { count:number; sides:DieSides }
export interface DiceExpression { terms:DiceTerm[]; modifier:number; normalized:string; physicalCount:number }
export interface PhysicalDie { id:string; sides:Exclude<DieSides,100>; logicalIndex:number; percentile?:'tens'|'units' }
export interface DiceResult { sides:DieSides; value:number; components?:[number,number] }
export interface RollRecord { id:string; expression:string; results:DiceResult[]; modifier:number; total:number; createdAt:number; mode:'physics'|'simple' }
export const MAX_PHYSICAL_DICE=24;
export function parseDiceExpression(input:string):DiceExpression {
  const compact=input.toLowerCase().replace(/\s+/g,'');
  if(!compact||compact.length>120)throw new Error('请输入骰式，例如 2d6+3 或 d20+d4+5');
  const tokens=compact.match(/[+-]?[^+-]+/g);
  if(!tokens||tokens.join('')!==compact)throw new Error('骰式格式错误');
  const terms:DiceTerm[]=[];let modifier=0;let physicalCount=0;
  for(const token of tokens){
    const die=/^\+?(\d*)d(\d+)$/.exec(token);
    if(die){
      const count=die[1]?Number(die[1]):1,sides=Number(die[2]) as DieSides;
      if(!DIE_SIDES.includes(sides))throw new Error('支持 d4、d6、d8、d10、d12、d20 和 d100');
      if(!Number.isSafeInteger(count)||count<1||count>MAX_PHYSICAL_DICE)throw new Error('单组骰子数量须为 1–24');
      physicalCount+=count*(sides===100?2:1);terms.push({count,sides});
    }else if(/^[+-]?\d+$/.test(token)){
      const n=Number(token);if(!Number.isSafeInteger(n)||Math.abs(n)>9999)throw new Error('修正值须在 -9999 至 9999 之间');modifier+=n;
    }else throw new Error('骰式仅支持骰子相加和整数修正值，例如 d20+d4-2');
  }
  if(!terms.length)throw new Error('至少需要一颗骰子');
  if(physicalCount>MAX_PHYSICAL_DICE)throw new Error('每次最多 24 颗实体骰，d100 占用两颗');
  if(Math.abs(modifier)>9999)throw new Error('修正值须在 -9999 至 9999 之间');
  return {terms,modifier,physicalCount,normalized:terms.map(t=>`${t.count}d${t.sides}`).join('+')+(modifier?`${modifier>0?'+':''}${modifier}`:'')};
}
export function physicalDice(expression:DiceExpression):PhysicalDie[]{
  const dice:PhysicalDie[]=[];let logicalIndex=0;
  for(const term of expression.terms)for(let i=0;i<term.count;i++,logicalIndex++){
    if(term.sides===100){dice.push({id:`${logicalIndex}-tens`,sides:10,logicalIndex,percentile:'tens'},{id:`${logicalIndex}-units`,sides:10,logicalIndex,percentile:'units'});}
    else dice.push({id:String(logicalIndex),sides:term.sides,logicalIndex});
  }return dice;
}
export function percentileValue(tens:number,units:number):number {return (tens%10)*10+(units%10)||100;}
export function summarizeDice(expression:DiceExpression,values:Record<string,number>):DiceResult[]{
  const result:DiceResult[]=[];let index=0;
  for(const term of expression.terms)for(let i=0;i<term.count;i++,index++){
    if(term.sides===100){
      const tens=values[`${index}-tens`],units=values[`${index}-units`];
      if(!Number.isInteger(tens)||tens<1||tens>10||!Number.isInteger(units)||units<1||units>10)throw new Error('百分骰结果不完整');
      result.push({sides:100,value:percentileValue(tens,units),components:[(tens%10)*10,units%10]});
    }else{const value=values[String(index)];if(!Number.isInteger(value)||value<1||value>term.sides)throw new Error('骰子结果不完整');result.push({sides:term.sides,value});}
  }return result;
}
/** Raw 20s on d20s (not d100), the rolls that get the critical flourish. */
export function naturalTwenties(results:DiceResult[]):number{return results.filter(d=>d.sides===20&&d.value===20).length;}
export function randomUnit():number{return crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;}
export function randomDie(sides:number):number{
  const limit=4294967296-4294967296%sides;let value:number;
  do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);
  return value%sides+1;
}
export function simpleRoll(expression:DiceExpression):DiceResult[]{return summarizeDice(expression,Object.fromEntries(physicalDice(expression).map(d=>[d.id,randomDie(d.sides)])));}
